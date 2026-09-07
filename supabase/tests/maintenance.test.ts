import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Mantenimiento / CMMS (modulo 59, F8.5) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una orden con el equipo de A, ni una parte con
 *     la orden o el producto de A, usando su PROPIO tenant_id. Mismo
 *     patron que 0031-0075.
 *  3. Una orden resuelta (completed/cancelled) se congela. Una parte
 *     es inmutable desde el primer insert.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let equipoA: string
let equipoB: string
let productoA: string
let productoB: string
let ordenA: string

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
    values (${`mt-a-${RUN}`}, 'Planta MT A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`mt-b-${RUN}`}, 'Planta MT B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'maintenance', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ea] = await sql`
    insert into public.equipment (tenant_id, code, name) values (${tenantA}, ${`EQ-A-${RUN}`}, 'Compresor A') returning id`
  const [eb] = await sql`
    insert into public.equipment (tenant_id, code, name) values (${tenantB}, ${`EQ-B-${RUN}`}, 'Compresor B') returning id`
  equipoA = ea!.id
  equipoB = eb!.id

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`REP-A-${RUN}`}, 'Filtro A') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`REP-B-${RUN}`}, 'Filtro B') returning id`
  productoA = pa!.id
  productoB = pb!.id

  const [oa] = await sql`
    insert into public.work_orders (tenant_id, equipment_id, type, description)
    values (${tenantA}, ${equipoA}, 'corrective', 'Fuga de aire') returning id`
  ordenA = oa!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.work_order_parts disable trigger no_editar_parte')
  await sql.unsafe('alter table public.work_orders disable trigger no_editar_orden_resuelta')
  await sql`delete from public.work_order_parts where tenant_id in ${sql(ts)}`
  await sql`delete from public.work_orders where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.work_order_parts enable trigger no_editar_parte')
  await sql.unsafe('alter table public.work_orders enable trigger no_editar_orden_resuelta')
  await sql`delete from public.equipment where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio equipo normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.equipment`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve el equipo de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.equipment where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una orden con el equipo de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.work_orders (tenant_id, equipment_id, type, description)
          values (${tenantB}, ${equipoA}, 'corrective', 'x')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una parte con la orden o el producto de A usando su PROPIO tenant_id', async () => {
    const [ordenB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.work_orders (tenant_id, equipment_id, type, description)
        values (${tenantB}, ${equipoB}, 'corrective', 'y') returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.work_order_parts (work_order_id, tenant_id, product_id, qty_used)
          values (${ordenA}, ${tenantB}, ${productoB}, 1)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.work_order_parts (work_order_id, tenant_id, product_id, qty_used)
          values (${ordenB!.id}, ${tenantB}, ${productoA}, 1)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Una orden resuelta se congela; una parte es inmutable desde el insert', () => {
  let orden: string

  it('open a in_progress y editar la descripcion: ambos funcionan mientras no este resuelta', async () => {
    const [o] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.work_orders (tenant_id, equipment_id, type, description)
        values (${tenantB}, ${equipoB}, 'preventive', 'Cambio de filtro') returning id`,
    )
    orden = o!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.work_orders set status = 'in_progress', description = 'Cambio de filtro urgente' where id = ${orden}`,
    )
    const [row] = await sql`select status, description from public.work_orders where id = ${orden}`
    expect(row!.status).toBe('in_progress')
    expect(row!.description).toBe('Cambio de filtro urgente')
  })

  it('una parte se registra normalmente pero nunca se puede editar', async () => {
    const [p] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.work_order_parts (work_order_id, tenant_id, product_id, qty_used)
        values (${orden}, ${tenantB}, ${productoB}, 2) returning id`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.work_order_parts set qty_used = 5 where id = ${p!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('completada, la orden ya no se puede editar ni borrar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.work_orders set status = 'completed', completed_at = now() where id = ${orden}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.work_orders set notes = 'x' where id = ${orden}`),
    ).rejects.toThrow(/ya se resolvio y no se edita/)
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.work_orders where id = ${orden}`),
    ).rejects.toThrow(/ya se resolvio y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'maintenance', true))

  it('sin el modulo, los equipos dan cero filas', async () => {
    await modulo(tenantB, 'maintenance', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.equipment`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un tipo de orden inventado se rechaza', async () => {
    await expect(
      sql`insert into public.work_orders (tenant_id, equipment_id, type, description)
        values (${tenantA}, ${equipoA}, 'invalido', 'x')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una cantidad de parte de cero o negativa se rechaza', async () => {
    await expect(
      sql`insert into public.work_order_parts (work_order_id, tenant_id, product_id, qty_used)
        values (${ordenA}, ${tenantA}, ${productoA}, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo codigo de equipo no se repite para el mismo cliente', async () => {
    await expect(
      sql`insert into public.equipment (tenant_id, code, name) values (${tenantA}, ${`EQ-A-${RUN}`}, 'Otro')`,
    ).rejects.toThrow(/duplicate key/)
  })
})
