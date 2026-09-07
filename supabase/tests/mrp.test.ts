import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Planificacion MRP (modulo 57, F8.5) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una sugerencia con la corrida o el producto de
 *     A usando su PROPIO tenant_id. Mismo patron que 0031-0073.
 *  3. Una corrida es inmutable desde el primer insert; una sugerencia
 *     pendiente es editable, resuelta es inmutable.
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
let corridaA: string

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
    values (${`mr-a-${RUN}`}, 'Fabrica MR A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`mr-b-${RUN}`}, 'Fabrica MR B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'mrp', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`MAD-${RUN}`}, 'Madera') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`TAB-${RUN}`}, 'Tabla') returning id`
  productoA = pa!.id
  productoB = pb!.id

  const [ra] = await sql`
    insert into public.mrp_runs (tenant_id, target_product_id, target_qty)
    values (${tenantA}, ${productoA}, 10) returning id`
  corridaA = ra!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.mrp_suggestions disable trigger no_editar_sugerencia_resuelta')
  await sql.unsafe('alter table public.mrp_runs disable trigger no_editar_corrida_mrp')
  await sql`delete from public.mrp_suggestions where tenant_id in ${sql(ts)}`
  await sql`delete from public.mrp_runs where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.mrp_suggestions enable trigger no_editar_sugerencia_resuelta')
  await sql.unsafe('alter table public.mrp_runs enable trigger no_editar_corrida_mrp')
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia corrida normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.mrp_runs`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la corrida de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.mrp_runs where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una sugerencia con la corrida o el producto de A usando su PROPIO tenant_id', async () => {
    const [corridaB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.mrp_runs (tenant_id, target_product_id, target_qty)
        values (${tenantB}, ${productoB}, 5) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.mrp_suggestions (run_id, tenant_id, product_id, action, qty_suggested)
          values (${corridaA}, ${tenantB}, ${productoB}, 'purchase', 10)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.mrp_suggestions (run_id, tenant_id, product_id, action, qty_suggested)
          values (${corridaB!.id}, ${tenantB}, ${productoA}, 'purchase', 10)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede crear una corrida apuntando al producto de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.mrp_runs (tenant_id, target_product_id, target_qty)
          values (${tenantB}, ${productoA}, 10)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Una corrida es inmutable; una sugerencia pendiente es editable, resuelta es inmutable', () => {
  let corrida: string
  let sugerencia: string

  it('la corrida nunca se puede editar', async () => {
    const [c] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.mrp_runs (tenant_id, target_product_id, target_qty)
        values (${tenantB}, ${productoB}, 8) returning id`,
    )
    corrida = c!.id
    await expect(
      as(userB, tenantB, (tx) => tx`update public.mrp_runs set notes = 'x' where id = ${corrida}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('una sugerencia pendiente SI se puede editar', async () => {
    const [s] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.mrp_suggestions (run_id, tenant_id, product_id, action, qty_suggested)
        values (${corrida}, ${tenantB}, ${productoB}, 'purchase', 20) returning id`,
    )
    sugerencia = s!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.mrp_suggestions set qty_suggested = 25 where id = ${sugerencia}`,
    )
    const [row] = await sql`select qty_suggested::text from public.mrp_suggestions where id = ${sugerencia}`
    expect(row!.qty_suggested).toBe('25.000')
  })

  it('al aceptarla o descartarla, ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.mrp_suggestions set status = 'accepted' where id = ${sugerencia}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.mrp_suggestions set qty_suggested = 1 where id = ${sugerencia}`),
    ).rejects.toThrow(/ya fue resuelta/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'mrp', true))

  it('sin el modulo, las corridas dan cero filas', async () => {
    await modulo(tenantB, 'mrp', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.mrp_runs`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una accion de sugerencia inventada se rechaza', async () => {
    await expect(
      sql`insert into public.mrp_suggestions (run_id, tenant_id, product_id, action, qty_suggested)
        values (${corridaA}, ${tenantA}, ${productoA}, 'fabricar', 10)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una cantidad sugerida de cero o negativa se rechaza', async () => {
    await expect(
      sql`insert into public.mrp_suggestions (run_id, tenant_id, product_id, action, qty_suggested)
        values (${corridaA}, ${tenantA}, ${productoA}, 'purchase', 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
