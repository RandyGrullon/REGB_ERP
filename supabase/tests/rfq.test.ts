import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Cotizacion a proveedores / RFQ (modulo 44, F8) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una invitacion, una cotizacion o un proveedor
 *     adjudicado de A usando su PROPIO tenant_id. Mismo patron que
 *     0031-0063.
 *  3. Una cotizacion registrada no se edita ni se borra NUNCA; un RFQ
 *     resuelto (awarded/cancelled) tampoco.
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
let rfqA: string

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
    values (${`rf-a-${RUN}`}, 'Ferreteria RF A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`rf-b-${RUN}`}, 'Distribuidora RF B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'suppliers', 'active', true), (${t}, 'rfq', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [sa] = await sql`
    insert into public.suppliers (tenant_id, name) values (${tenantA}, 'Proveedor A') returning id`
  const [sb] = await sql`
    insert into public.suppliers (tenant_id, name) values (${tenantB}, 'Proveedor B') returning id`
  proveedorA = sa!.id
  proveedorB = sb!.id

  const [ra] = await sql`
    insert into public.rfqs (tenant_id, title) values (${tenantA}, 'RFQ de cemento') returning id`
  rfqA = ra!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.rfq_quotes disable trigger no_editar_cotizacion')
  await sql`delete from public.rfq_quotes where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.rfq_quotes enable trigger no_editar_cotizacion')
  await sql.unsafe('alter table public.rfqs disable trigger no_editar_rfq_resuelto')
  await sql`delete from public.rfq_invitations where tenant_id in ${sql(ts)}`
  await sql`delete from public.rfqs where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.rfqs enable trigger no_editar_rfq_resuelto')
  await sql`delete from public.suppliers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A invita a su propio proveedor normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.rfq_invitations (tenant_id, rfq_id, supplier_id) values (${tenantA}, ${rfqA}, ${proveedorA})`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.rfq_invitations`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve el RFQ de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.rfqs where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una invitacion con el RFQ de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.rfq_invitations (tenant_id, rfq_id, supplier_id)
          values (${tenantB}, ${rfqA}, ${proveedorB})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una invitacion con el proveedor de A usando su PROPIO tenant_id', async () => {
    const [rfqB] = await sql`
      insert into public.rfqs (tenant_id, title) values (${tenantB}, 'RFQ de B') returning id`
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.rfq_invitations (tenant_id, rfq_id, supplier_id)
          values (${tenantB}, ${rfqB!.id}, ${proveedorA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede adjudicar su RFQ al proveedor de A usando su PROPIO tenant_id', async () => {
    const [rfqB] = await sql`select id from public.rfqs where tenant_id = ${tenantB} limit 1`
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.rfqs set awarded_supplier_id = ${proveedorA} where id = ${rfqB!.id}`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Una cotizacion registrada es inmutable siempre, y un RFQ adjudicado tambien', () => {
  let rfqB: string
  let cotizacion: string

  it('se registra una cotizacion normalmente', async () => {
    const [r] = await sql`insert into public.rfqs (tenant_id, title) values (${tenantB}, 'RFQ para cerrar') returning id`
    rfqB = r!.id
    const [c] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.rfq_quotes (tenant_id, rfq_id, supplier_id, total_amount, lead_time_days)
        values (${tenantB}, ${rfqB}, ${proveedorB}, 5000, 7) returning id`,
    )
    cotizacion = c!.id
  })

  it('esa cotizacion nunca se puede editar', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.rfq_quotes set total_amount = 1 where id = ${cotizacion}`,
      ),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('tampoco se puede borrar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.rfq_quotes where id = ${cotizacion}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('se adjudica el RFQ normalmente', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        update public.rfqs set status = 'awarded', awarded_supplier_id = ${proveedorB}, awarded_at = now()
        where id = ${rfqB}`,
    )
    const [row] = await sql`select status from public.rfqs where id = ${rfqB}`
    expect(row!.status).toBe('awarded')
  })

  it('una vez adjudicado, el RFQ ya no se puede editar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.rfqs set title = 'otro' where id = ${rfqB}`),
    ).rejects.toThrow(/ya quedo resuelto/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'rfq', true))

  it('sin el modulo, los RFQ dan cero filas', async () => {
    await modulo(tenantB, 'rfq', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.rfqs`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un plazo de entrega negativo se rechaza', async () => {
    await expect(
      sql`
        insert into public.rfq_quotes (tenant_id, rfq_id, supplier_id, total_amount, lead_time_days)
        values (${tenantA}, ${rfqA}, ${proveedorA}, 1000, -1)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo proveedor no puede cotizar dos veces en el mismo RFQ', async () => {
    await sql`
      insert into public.rfq_quotes (tenant_id, rfq_id, supplier_id, total_amount, lead_time_days)
      values (${tenantA}, ${rfqA}, ${proveedorA}, 1000, 5)`
    await expect(
      sql`
        insert into public.rfq_quotes (tenant_id, rfq_id, supplier_id, total_amount, lead_time_days)
        values (${tenantA}, ${rfqA}, ${proveedorA}, 900, 3)`,
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })
})
