import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Proveedores (modulo 42, F8) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. El bug real encontrado antes de construir este modulo: un tenant
 *     con SOLO `ap` activo -sin `purchase-orders`- ahora SI ve la
 *     ficha del proveedor, no solo la factura con el nombre en null.
 *  2. Aislamiento normal entre clientes en las tres tablas nuevas.
 *  3. B no puede colar un documento, una cuenta bancaria o una
 *     evaluacion con el proveedor de A usando su PROPIO tenant_id.
 *  4. Una evaluacion registrada no se edita ni se borra NUNCA.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let proveedorA: string
let proveedorB: string

const claims = (userId: string, tenantId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { tenant_id: tenantId, is_provider: false } })

async function as<T>(
  userId: string,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenantId)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

async function modulo(tenant: string, id: string, encendido: boolean) {
  await sql`
    update regb.tenant_modules set enabled = ${encendido}
    where tenant_id = ${tenant} and module_id = ${id}`
}

async function activar(tenant: string, id: string) {
  await sql`
    insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
    values (${tenant}, ${id}, 'active', true)
    on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`sp-a-${RUN}`}, 'Ferreteria SP A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`sp-b-${RUN}`}, 'Distribuidora SP B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  await activar(tenantA, 'suppliers')
  await activar(tenantB, 'suppliers')

  const [sa] = await sql`
    insert into public.suppliers (tenant_id, name, tax_id) values (${tenantA}, 'Proveedor A', '101-11111-1') returning id`
  const [sb] = await sql`
    insert into public.suppliers (tenant_id, name, tax_id) values (${tenantB}, 'Proveedor B', '101-22222-2') returning id`
  proveedorA = sa!.id
  proveedorB = sb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.supplier_evaluations disable trigger no_editar_evaluacion_proveedor')
  await sql`delete from public.supplier_evaluations where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.supplier_evaluations enable trigger no_editar_evaluacion_proveedor')
  await sql`delete from public.supplier_documents where tenant_id in ${sql(ts)}`
  await sql`delete from public.supplier_bank_accounts where tenant_id in ${sql(ts)}`
  await sql`delete from public.suppliers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenant_modules where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('El bug real: la ficha basica se comparte entre tres modulos', () => {
  it('con SOLO ap activo -sin purchase-orders-, la ficha del proveedor SI se ve', async () => {
    const [c] = await sql`
      insert into regb.tenants (slug, legal_name, tier, status)
      values (${`sp-ap-only-${RUN}`}, 'Solo AP SRL', 'pyme', 'active') returning id`
    const tenantC = c!.id
    await activar(tenantC, 'ap')
    const [sc] = await sql`
      insert into public.suppliers (tenant_id, name) values (${tenantC}, 'Proveedor de C') returning id`

    const filas = await as(
      crypto.randomUUID(),
      tenantC,
      (tx) => tx<{ name: string }[]>`select name from public.suppliers where id = ${sc!.id}`,
    )
    expect(filas).toHaveLength(1)
    expect(filas[0]!.name).toBe('Proveedor de C')

    await sql`delete from public.suppliers where tenant_id = ${tenantC}`
    await sql`delete from regb.tenant_modules where tenant_id = ${tenantC}`
    await sql`delete from regb.tenants where id = ${tenantC}`
  })

  it('sin ninguno de los tres modulos activo, la ficha NO se ve', async () => {
    const [d] = await sql`
      insert into regb.tenants (slug, legal_name, tier, status)
      values (${`sp-none-${RUN}`}, 'Ninguno SRL', 'pyme', 'active') returning id`
    const tenantD = d!.id
    const [sd] = await sql`
      insert into public.suppliers (tenant_id, name) values (${tenantD}, 'Proveedor de D') returning id`

    const filas = await as(
      crypto.randomUUID(),
      tenantD,
      (tx) => tx<{ name: string }[]>`select name from public.suppliers where id = ${sd!.id}`,
    )
    expect(filas).toHaveLength(0)

    await sql`delete from public.suppliers where tenant_id = ${tenantD}`
    await sql`delete from regb.tenants where id = ${tenantD}`
  })
})

describe('Aislamiento entre clientes en las tablas nuevas', () => {
  it('A registra su propio documento normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.supplier_documents (tenant_id, supplier_id, doc_type)
        values (${tenantA}, ${proveedorA}, 'rnc_certificate')`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.supplier_documents`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve el documento de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.supplier_documents where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un documento con el proveedor de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.supplier_documents (tenant_id, supplier_id, doc_type)
          values (${tenantB}, ${proveedorA}, 'insurance')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una cuenta bancaria con el proveedor de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.supplier_bank_accounts (tenant_id, supplier_id, bank_name, account_number)
          values (${tenantB}, ${proveedorA}, 'Banco X', '123456')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una evaluacion con el proveedor de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.supplier_evaluations (tenant_id, supplier_id, score)
          values (${tenantB}, ${proveedorA}, 4)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Una evaluacion registrada es inmutable siempre', () => {
  let evaluacion: string

  it('se registra normalmente', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.supplier_evaluations (tenant_id, supplier_id, score, comments)
        values (${tenantB}, ${proveedorB}, 5, 'entrega puntual') returning id`,
    )
    evaluacion = r!.id
  })

  it('no se puede editar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.supplier_evaluations set score = 1 where id = ${evaluacion}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('tampoco se puede borrar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.supplier_evaluations where id = ${evaluacion}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'suppliers', true))

  it('sin ninguno de los tres modulos, los documentos dan cero filas', async () => {
    await modulo(tenantB, 'suppliers', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.supplier_documents`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un tipo de documento inventado se rechaza', async () => {
    await expect(
      sql`
        insert into public.supplier_documents (tenant_id, supplier_id, doc_type)
        values (${tenantA}, ${proveedorA}, 'diploma_de_cocina')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una calificacion fuera de 1-5 se rechaza', async () => {
    await expect(
      sql`
        insert into public.supplier_evaluations (tenant_id, supplier_id, score)
        values (${tenantA}, ${proveedorA}, 6)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un estado de homologacion inventado se rechaza', async () => {
    await expect(
      sql`update public.suppliers set qualification_status = 'muy_bueno' where id = ${proveedorA}`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
