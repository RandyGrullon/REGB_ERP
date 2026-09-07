import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Codigos de barra & RFID (modulo 52, F8) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un escaneo con el producto de A usando su
 *     PROPIO tenant_id. Mismo patron que 0031-0068.
 *  3. Un escaneo es inmutable desde el primer insert -es un hecho
 *     historico, igual que audit.log-.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let productoA: string
let productoB: string

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

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`bc-a-${RUN}`}, 'Ferreteria BC A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`bc-b-${RUN}`}, 'Distribuidora BC B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'barcode', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`SKU-A-${RUN}`}, 'Cemento') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`SKU-B-${RUN}`}, 'Varilla') returning id`
  productoA = pa!.id
  productoB = pb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.barcode_scans disable trigger no_editar_escaneo')
  await sql`delete from public.barcode_scans where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.barcode_scans enable trigger no_editar_escaneo')
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A registra su propio escaneo normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.barcode_scans (tenant_id, product_id, scanned_code, scanned_by)
        values (${tenantA}, ${productoA}, '4006381333931', ${userA})`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.barcode_scans`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve el escaneo de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.barcode_scans where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un escaneo con el producto de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.barcode_scans (tenant_id, product_id, scanned_code)
          values (${tenantB}, ${productoA}, '4006381333931')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Un escaneo es inmutable desde el primer insert', () => {
  let escaneo: string

  it('se registra normalmente', async () => {
    const [e] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.barcode_scans (tenant_id, product_id, scanned_code)
        values (${tenantB}, ${productoB}, '4006381333931') returning id`,
    )
    escaneo = e!.id
    expect(escaneo).toBeDefined()
  })

  it('nunca se puede editar', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.barcode_scans set scanned_code = '0000000000000' where id = ${escaneo}`,
      ),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('tampoco se puede borrar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.barcode_scans where id = ${escaneo}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'barcode', true))

  it('sin el modulo, los escaneos dan cero filas', async () => {
    await modulo(tenantB, 'barcode', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.barcode_scans`,
    )
    expect(filas).toHaveLength(0)
  })
})
