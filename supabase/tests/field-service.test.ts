import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Servicio en campo (modulo 74, F10) contra Postgres real.
 *
 * Lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colgar un paso de checklist ni un repuesto de una orden
 *     de A usando su PROPIO tenant_id. Mismo patron que 0031-0097.
 *  3. La regla del modulo: la orden NO se cierra con pasos obligatorios
 *     sin marcar ni sin firma. Se prueba contra el trigger, no contra la
 *     UI -el telefono del tecnico es un cliente remoto-.
 *  4. Un repuesto consumido no se reescribe.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let clienteA: string
let clienteB: string
let ordenA: string
let ordenB: string

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
    values (${`fs-a-${RUN}`}, 'Refrigeracion A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`fs-b-${RUN}`}, 'Refrigeracion B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'field-service', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ca] = await sql`insert into public.customers (tenant_id, name) values (${tenantA}, 'Colmado La Esquina') returning id`
  const [cb] = await sql`insert into public.customers (tenant_id, name) values (${tenantB}, 'Ferreteria Del Este') returning id`
  clienteA = ca!.id
  clienteB = cb!.id

  const [oa] = await sql`
    insert into public.service_orders (tenant_id, code, customer_id, description, status)
    values (${tenantA}, 'OS-A1', ${clienteA}, 'Mantenimiento de nevera', 'in_progress') returning id`
  const [ob] = await sql`
    insert into public.service_orders (tenant_id, code, customer_id, description, status)
    values (${tenantB}, 'OS-B1', ${clienteB}, 'Cambio de compresor', 'in_progress') returning id`
  ordenA = oa!.id
  ordenB = ob!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.service_parts where tenant_id in ${sql(ts)}`
  await sql`delete from public.service_checklist_items where tenant_id in ${sql(ts)}`
  await sql`delete from public.service_orders where tenant_id in ${sql(ts)}`
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia orden normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.service_orders`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve la orden de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.service_orders where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colgar un paso de la orden de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.service_checklist_items (tenant_id, order_id, label)
          values (${tenantB}, ${ordenA}, 'Paso colado')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colgar un repuesto de la orden de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.service_parts (tenant_id, order_id, description, qty, unit_cost)
          values (${tenantB}, ${ordenA}, 'Capacitor', 1, 500)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede usar un producto de A como repuesto', async () => {
    const [prodA] = await sql`
      insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`SKU-${RUN}`}, 'Capacitor 35uF') returning id`
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.service_parts (tenant_id, order_id, product_id, description, qty, unit_cost)
          values (${tenantB}, ${ordenB}, ${prodA!.id}, 'Capacitor', 1, 500)`,
      ),
    ).rejects.toThrow(/Ese producto no pertenece a esta cuenta/)
    await sql`delete from public.products where id = ${prodA!.id}`
  })
})

describe('Una orden no se cierra a medias', () => {
  it('con un paso obligatorio sin marcar, no cierra', async () => {
    const [paso] = await sql`
      insert into public.service_checklist_items (tenant_id, order_id, label, required)
      values (${tenantA}, ${ordenA}, 'Revisar presion del gas', true) returning id`

    await expect(
      sql`update public.service_orders set status = 'done', signed_by = 'Ana Rosario' where id = ${ordenA}`,
    ).rejects.toThrow(/pasos obligatorios/)

    await sql`update public.service_checklist_items set done = true where id = ${paso!.id}`
  })

  it('con el checklist completo pero sin firma, tampoco cierra', async () => {
    await expect(
      sql`update public.service_orders set status = 'done' where id = ${ordenA}`,
    ).rejects.toThrow(/sin la firma/)
  })

  it('una firma en blanco no cuenta como firma', async () => {
    await expect(
      sql`update public.service_orders set status = 'done', signed_by = '   ' where id = ${ordenA}`,
    ).rejects.toThrow(/sin la firma/)
  })

  it('un paso OPCIONAL sin marcar no bloquea el cierre', async () => {
    await sql`
      insert into public.service_checklist_items (tenant_id, order_id, label, required)
      values (${tenantA}, ${ordenA}, 'Tomar foto del equipo', false)`
    await sql`
      update public.service_orders set status = 'done', signed_by = 'Ana Rosario', signed_at = now()
      where id = ${ordenA}`
    const [o] = await sql<{ status: string }[]>`select status from public.service_orders where id = ${ordenA}`
    expect(o!.status).toBe('done')
  })
})

describe('Un repuesto consumido es un hecho historico', () => {
  it('el costo de repuestos se deriva de las lineas', async () => {
    await sql`
      insert into public.service_parts (tenant_id, order_id, description, qty, unit_cost)
      values (${tenantB}, ${ordenB}, 'Compresor 1/3 HP', 1, 8500),
             (${tenantB}, ${ordenB}, 'Gas R134a', 2, 750)`
    const [total] = await sql`
      select public.service_order_parts_cost(${tenantB}, ${ordenB})::text as costo`
    expect(Number(total!.costo)).toBe(10000)
  })

  it('un repuesto registrado no se edita', async () => {
    await expect(
      sql`update public.service_parts set unit_cost = 1 where order_id = ${ordenB}`,
    ).rejects.toThrow(/no se edita/)
  })

  it('cantidad cero se rechaza', async () => {
    await expect(
      sql`insert into public.service_parts (tenant_id, order_id, description, qty, unit_cost)
          values (${tenantB}, ${ordenB}, 'Nada', 0, 100)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'field-service', true))

  it('sin el modulo, las ordenes dan cero filas', async () => {
    await modulo(tenantB, 'field-service', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.service_orders`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('dos ordenes con el mismo codigo en el mismo cliente se rechaza', async () => {
    await expect(
      sql`insert into public.service_orders (tenant_id, code, customer_id, description)
          values (${tenantA}, 'OS-A1', ${clienteA}, 'Repetida')`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('un estado inventado se rechaza', async () => {
    await expect(
      sql`insert into public.service_orders (tenant_id, code, customer_id, description, status)
          values (${tenantA}, ${`OS-X-${RUN}`}, ${clienteA}, 'Rara', 'terminada')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
