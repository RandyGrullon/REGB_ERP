import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Ordenes de produccion (modulo 56, F8.5) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una orden, una linea o un reporte con
 *     referencias de A usando su PROPIO tenant_id. Mismo patron que
 *     0031-0072.
 *  3. Una orden en `draft` es editable en su receta; fuera de `draft`
 *     esa receta es inmutable, aunque status/qty_completed SI avanzan.
 *     Lineas y reportes son inmutables desde el primer insert.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let almacenA: string
let almacenB: string
let productoA: string
let componenteA: string
let bomA: string
let productoB: string
let componenteB: string
let bomB: string
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
    values (${`mf-a-${RUN}`}, 'Fabrica MF A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`mf-b-${RUN}`}, 'Fabrica MF B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'bom', 'active', true),
             (${t}, 'manufacturing', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [wa] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantA}, 'Central A') returning id`
  const [wb] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantB}, 'Central B') returning id`
  almacenA = wa!.id
  almacenB = wb!.id

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`SILLA-${RUN}`}, 'Silla') returning id`
  const [ca] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`MADERA-${RUN}`}, 'Madera') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`MESA-${RUN}`}, 'Mesa') returning id`
  const [cb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`TABLA-${RUN}`}, 'Tabla') returning id`
  productoA = pa!.id
  componenteA = ca!.id
  productoB = pb!.id
  componenteB = cb!.id

  const [ba] = await sql`
    insert into public.bill_of_materials (tenant_id, product_id, version, status)
    values (${tenantA}, ${productoA}, 1, 'active') returning id`
  const [bb] = await sql`
    insert into public.bill_of_materials (tenant_id, product_id, version, status)
    values (${tenantB}, ${productoB}, 1, 'active') returning id`
  bomA = ba!.id
  bomB = bb!.id

  const [oa] = await sql`
    insert into public.production_orders (tenant_id, bom_id, warehouse_id, qty_planned)
    values (${tenantA}, ${bomA}, ${almacenA}, 10) returning id`
  ordenA = oa!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.production_order_lines disable trigger no_editar_linea_produccion')
  await sql.unsafe('alter table public.production_reports disable trigger no_editar_reporte')
  await sql.unsafe('alter table public.production_orders disable trigger no_editar_orden_produccion_resuelta')
  await sql`delete from public.production_order_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.production_reports where tenant_id in ${sql(ts)}`
  await sql`delete from public.production_orders where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.production_order_lines enable trigger no_editar_linea_produccion')
  await sql.unsafe('alter table public.production_reports enable trigger no_editar_reporte')
  await sql.unsafe('alter table public.production_orders enable trigger no_editar_orden_produccion_resuelta')
  await sql.unsafe('alter table public.bill_of_materials disable trigger no_editar_bom_no_borrador')
  await sql`delete from public.bill_of_materials where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.bill_of_materials enable trigger no_editar_bom_no_borrador')
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia orden normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.production_orders`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la orden de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.production_orders where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una orden con el BOM o el almacen de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.production_orders (tenant_id, bom_id, warehouse_id, qty_planned)
          values (${tenantB}, ${bomA}, ${almacenB}, 5)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.production_orders (tenant_id, bom_id, warehouse_id, qty_planned)
          values (${tenantB}, ${bomB}, ${almacenA}, 5)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una linea con la orden o el componente de A usando su PROPIO tenant_id', async () => {
    const [ordenB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.production_orders (tenant_id, bom_id, warehouse_id, qty_planned)
        values (${tenantB}, ${bomB}, ${almacenB}, 5) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.production_order_lines (order_id, tenant_id, component_product_id, qty_required, qty_consumed)
          values (${ordenA}, ${tenantB}, ${componenteB}, 1, 1)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.production_order_lines (order_id, tenant_id, component_product_id, qty_required, qty_consumed)
          values (${ordenB!.id}, ${tenantB}, ${componenteA}, 1, 1)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un reporte con la orden de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.production_reports (order_id, tenant_id, qty_completed_delta)
          values (${ordenA}, ${tenantB}, 1)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('En draft la receta es editable; fuera de draft es inmutable pero el progreso avanza', () => {
  let orden: string

  it('en draft, qty_planned y notas son editables', async () => {
    const [o] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.production_orders (tenant_id, bom_id, warehouse_id, qty_planned)
        values (${tenantB}, ${bomB}, ${almacenB}, 10) returning id`,
    )
    orden = o!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.production_orders set qty_planned = 20, notes = 'ajustado' where id = ${orden}`,
    )
    const [row] = await sql`select qty_planned::text from public.production_orders where id = ${orden}`
    expect(row!.qty_planned).toBe('20.000')
  })

  it('al liberar, la receta ya no se puede cambiar pero el estado SI avanza', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.production_orders set status = 'released', released_at = now() where id = ${orden}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.production_orders set qty_planned = 99 where id = ${orden}`),
    ).rejects.toThrow(/su receta no se puede cambiar/)

    await as(
      userB,
      tenantB,
      (tx) => tx`update public.production_orders set status = 'in_progress', qty_completed = 5 where id = ${orden}`,
    )
    const [row] = await sql`select status, qty_completed::text from public.production_orders where id = ${orden}`
    expect(row!.status).toBe('in_progress')
    expect(row!.qty_completed).toBe('5.000')
  })

  it('una linea de produccion nunca se puede editar', async () => {
    const [l] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.production_order_lines (order_id, tenant_id, component_product_id, qty_required, qty_consumed)
        values (${orden}, ${tenantB}, ${componenteB}, 20, 20) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.production_order_lines set qty_consumed = 25 where id = ${l!.id}`,
      ),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('un reporte de avance nunca se puede editar', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.production_reports (order_id, tenant_id, qty_completed_delta)
        values (${orden}, ${tenantB}, 5) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.production_reports set qty_completed_delta = 10 where id = ${r!.id}`,
      ),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('completada, la orden ya no se puede borrar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.production_orders set status = 'completed', completed_at = now() where id = ${orden}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.production_orders where id = ${orden}`),
    ).rejects.toThrow(/no esta en borrador y no se borra/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'manufacturing', true))

  it('sin el modulo, las ordenes dan cero filas', async () => {
    await modulo(tenantB, 'manufacturing', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.production_orders`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una cantidad planificada de cero o negativa se rechaza', async () => {
    await expect(
      sql`insert into public.production_orders (tenant_id, bom_id, warehouse_id, qty_planned)
        values (${tenantA}, ${bomA}, ${almacenA}, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un reporte sin nada completado ni mermado se rechaza', async () => {
    await expect(
      sql`insert into public.production_reports (order_id, tenant_id, qty_completed_delta, qty_scrapped_delta)
        values (${ordenA}, ${tenantA}, 0, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
