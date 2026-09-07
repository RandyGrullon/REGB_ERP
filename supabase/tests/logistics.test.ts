import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Logistica & Rutas (modulo 53, F8) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una ruta o una parada con referencias de A
 *     usando su PROPIO tenant_id. Mismo patron que 0031-0070.
 *  3. Una ruta resuelta (completed/cancelled) es inmutable; una
 *     parada resuelta (delivered/failed) tambien -pero pending SI se
 *     puede editar-.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let empleadoA: string
let empleadoB: string
let clienteA: string
let clienteB: string
let rutaA: string

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
    values (${`lg-a-${RUN}`}, 'Ferreteria LG A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`lg-b-${RUN}`}, 'Distribuidora LG B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'employees', 'active', true), (${t}, 'logistics', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ea] = await sql`
    insert into public.employees (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantA}, ${`E1-${RUN}`}, 'Maria', 'Rosario', current_date - 400, 'Chofer', 25000)
    returning id`
  const [eb] = await sql`
    insert into public.employees (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantB}, ${`E1-${RUN}`}, 'Juan', 'Perez', current_date - 400, 'Chofer', 22000)
    returning id`
  empleadoA = ea!.id
  empleadoB = eb!.id

  const [ca] = await sql`
    insert into public.customers (tenant_id, name) values (${tenantA}, 'Cliente A') returning id`
  const [cb] = await sql`
    insert into public.customers (tenant_id, name) values (${tenantB}, 'Cliente B') returning id`
  clienteA = ca!.id
  clienteB = cb!.id

  const [ra] = await sql`
    insert into public.delivery_routes (tenant_id, driver_id) values (${tenantA}, ${empleadoA}) returning id`
  rutaA = ra!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.route_stops disable trigger no_editar_parada_resuelta')
  await sql.unsafe('alter table public.delivery_routes disable trigger no_editar_ruta_resuelta')
  await sql`delete from public.route_stops where tenant_id in ${sql(ts)}`
  await sql`delete from public.delivery_routes where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.route_stops enable trigger no_editar_parada_resuelta')
  await sql.unsafe('alter table public.delivery_routes enable trigger no_editar_ruta_resuelta')
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia ruta normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.delivery_routes`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la ruta de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.delivery_routes where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una ruta con el conductor de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`insert into public.delivery_routes (tenant_id, driver_id) values (${tenantB}, ${empleadoA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una parada con la ruta o el cliente de A usando su PROPIO tenant_id', async () => {
    const [rutaB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.delivery_routes (tenant_id, driver_id) values (${tenantB}, ${empleadoB}) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.route_stops (route_id, tenant_id, sequence, address, customer_id)
          values (${rutaA}, ${tenantB}, 1, 'x', ${clienteB})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.route_stops (route_id, tenant_id, sequence, address, customer_id)
          values (${rutaB!.id}, ${tenantB}, 1, 'x', ${clienteA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Una ruta resuelta y una parada resuelta son inmutables; pending SI se edita', () => {
  let ruta: string
  let parada: string

  it('se planifica una ruta con una parada pendiente, editable', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.delivery_routes (tenant_id, driver_id) values (${tenantB}, ${empleadoB}) returning id`,
    )
    ruta = r!.id
    const [p] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.route_stops (route_id, tenant_id, sequence, address)
        values (${ruta}, ${tenantB}, 1, 'Calle Falsa 123') returning id`,
    )
    parada = p!.id

    await as(
      userB,
      tenantB,
      (tx) => tx`update public.route_stops set address = 'Calle Real 456' where id = ${parada}`,
    )
    const [row] = await sql`select address from public.route_stops where id = ${parada}`
    expect(row!.address).toBe('Calle Real 456')
  })

  it('al marcarla entregada, la parada ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        update public.route_stops set status = 'delivered', recipient_name = 'Juan', delivered_at = now()
        where id = ${parada}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.route_stops set address = 'otra' where id = ${parada}`),
    ).rejects.toThrow(/ya quedo resuelta/)
  })

  it('se completa la ruta, y ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.delivery_routes set status = 'completed', completed_at = now() where id = ${ruta}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.delivery_routes set notes = 'x' where id = ${ruta}`),
    ).rejects.toThrow(/ya quedo resuelta/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'logistics', true))

  it('sin el modulo, las rutas dan cero filas', async () => {
    await modulo(tenantB, 'logistics', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.delivery_routes`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un estado de ruta inventado se rechaza', async () => {
    await expect(
      sql`insert into public.delivery_routes (tenant_id, status) values (${tenantA}, 'en_camino')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('dos paradas no pueden compartir la misma secuencia en la misma ruta', async () => {
    await sql`insert into public.route_stops (route_id, tenant_id, sequence, address) values (${rutaA}, ${tenantA}, 5, 'x')`
    await expect(
      sql`insert into public.route_stops (route_id, tenant_id, sequence, address) values (${rutaA}, ${tenantA}, 5, 'y')`,
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })
})
