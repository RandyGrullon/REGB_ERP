import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Recepciones (modulo 46, F8) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una recepcion, una linea o una devolucion con
 *     referencias de A usando su PROPIO tenant_id. Mismo patron que
 *     0031-0064.
 *  3. Una recepcion (encabezado y lineas) es inmutable desde el primer
 *     insert; una devolucion es inmutable solo una vez resuelta
 *     (sent/cancelled) -pending sigue editable-.
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
let proveedorA: string
let proveedorB: string
let productoA: string
let productoB: string
let ordenA: string
let lineaOrdenA: string
let ordenB: string
let lineaOrdenB: string

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
    values (${`rc-a-${RUN}`}, 'Ferreteria RC A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`rc-b-${RUN}`}, 'Distribuidora RC B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'purchase-orders', 'active', true), (${t}, 'receipts', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [wa] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantA}, 'Central A') returning id`
  const [wb] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantB}, 'Central B') returning id`
  almacenA = wa!.id
  almacenB = wb!.id

  const [sa] = await sql`insert into public.suppliers (tenant_id, name) values (${tenantA}, 'Proveedor A') returning id`
  const [sb] = await sql`insert into public.suppliers (tenant_id, name) values (${tenantB}, 'Proveedor B') returning id`
  proveedorA = sa!.id
  proveedorB = sb!.id

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`SKU-A-${RUN}`}, 'Cemento') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`SKU-B-${RUN}`}, 'Varilla') returning id`
  productoA = pa!.id
  productoB = pb!.id

  const [oa] = await sql`
    insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id, status)
    values (${tenantA}, ${`OC-A-${RUN}`}, ${proveedorA}, ${almacenA}, 'confirmed') returning id`
  ordenA = oa!.id
  const [la] = await sql`
    insert into public.purchase_order_lines (order_id, tenant_id, product_id, qty_ordered, unit_cost)
    values (${ordenA}, ${tenantA}, ${productoA}, 100, 50) returning id`
  lineaOrdenA = la!.id

  const [ob] = await sql`
    insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id, status)
    values (${tenantB}, ${`OC-B-${RUN}`}, ${proveedorB}, ${almacenB}, 'confirmed') returning id`
  ordenB = ob!.id
  const [lb] = await sql`
    insert into public.purchase_order_lines (order_id, tenant_id, product_id, qty_ordered, unit_cost)
    values (${ordenB}, ${tenantB}, ${productoB}, 50, 80) returning id`
  lineaOrdenB = lb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.supplier_returns disable trigger no_editar_devolucion_resuelta')
  await sql`delete from public.supplier_returns where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.supplier_returns enable trigger no_editar_devolucion_resuelta')
  await sql.unsafe('alter table public.goods_receipt_lines disable trigger no_editar_linea_recepcion')
  await sql.unsafe('alter table public.goods_receipts disable trigger no_editar_recepcion')
  await sql`delete from public.goods_receipt_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.goods_receipts where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.goods_receipt_lines enable trigger no_editar_linea_recepcion')
  await sql.unsafe('alter table public.goods_receipts enable trigger no_editar_recepcion')
  await sql`delete from public.inventory_movements where tenant_id in ${sql(ts)}`
  await sql`delete from public.purchase_order_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.purchase_orders where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.suppliers where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A registra su propia recepcion normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.goods_receipts (tenant_id, purchase_order_id, warehouse_id, supplier_id)
        values (${tenantA}, ${ordenA}, ${almacenA}, ${proveedorA})`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.goods_receipts`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la recepcion de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.goods_receipts where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una recepcion con la orden de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.goods_receipts (tenant_id, purchase_order_id, warehouse_id, supplier_id)
          values (${tenantB}, ${ordenA}, ${almacenB}, ${proveedorB})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una recepcion con el almacen de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.goods_receipts (tenant_id, purchase_order_id, warehouse_id, supplier_id)
          values (${tenantB}, ${ordenB}, ${almacenA}, ${proveedorB})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una recepcion con el proveedor de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.goods_receipts (tenant_id, purchase_order_id, warehouse_id, supplier_id)
          values (${tenantB}, ${ordenB}, ${almacenB}, ${proveedorA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una linea con la linea de orden o el producto de A usando su PROPIO tenant_id', async () => {
    const [recepcionB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.goods_receipts (tenant_id, purchase_order_id, warehouse_id, supplier_id)
        values (${tenantB}, ${ordenB}, ${almacenB}, ${proveedorB}) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.goods_receipt_lines
            (receipt_id, tenant_id, purchase_order_line_id, product_id,
             qty_expected, qty_received, qty_accepted, qty_rejected, unit_cost)
          values (${recepcionB!.id}, ${tenantB}, ${lineaOrdenA}, ${productoB}, 10, 10, 10, 0, 50)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.goods_receipt_lines
            (receipt_id, tenant_id, purchase_order_line_id, product_id,
             qty_expected, qty_received, qty_accepted, qty_rejected, unit_cost)
          values (${recepcionB!.id}, ${tenantB}, ${lineaOrdenB}, ${productoA}, 10, 10, 10, 0, 80)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Una recepcion es inmutable siempre; una devolucion solo una vez resuelta', () => {
  let recepcion: string
  let lineaRecepcion: string
  let devolucion: string

  it('se registra la recepcion con su linea normalmente', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.goods_receipts (tenant_id, purchase_order_id, warehouse_id, supplier_id)
        values (${tenantB}, ${ordenB}, ${almacenB}, ${proveedorB}) returning id`,
    )
    recepcion = r!.id
    const [l] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.goods_receipt_lines
          (receipt_id, tenant_id, purchase_order_line_id, product_id,
           qty_expected, qty_received, qty_accepted, qty_rejected, unit_cost)
        values (${recepcion}, ${tenantB}, ${lineaOrdenB}, ${productoB}, 50, 45, 40, 5, 80)
        returning id`,
    )
    lineaRecepcion = l!.id
    expect(lineaRecepcion).toBeDefined()
  })

  it('esa recepcion nunca se puede editar ni borrar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.goods_receipts set notes = 'x' where id = ${recepcion}`),
    ).rejects.toThrow(/no se edita ni se borra/)
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.goods_receipts where id = ${recepcion}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('su linea tampoco se puede editar ni borrar', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.goods_receipt_lines set qty_accepted = 0 where id = ${lineaRecepcion}`,
      ),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('se registra una devolucion pendiente por lo rechazado, y SI se puede editar mientras este pending', async () => {
    const [d] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.supplier_returns (tenant_id, goods_receipt_line_id, supplier_id, qty, reason)
        values (${tenantB}, ${lineaRecepcion}, ${proveedorB}, 5, 'Sacos rotos') returning id`,
    )
    devolucion = d!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.supplier_returns set reason = 'Sacos rotos y humedos' where id = ${devolucion}`,
    )
    const [row] = await sql`select reason from public.supplier_returns where id = ${devolucion}`
    expect(row!.reason).toBe('Sacos rotos y humedos')
  })

  it('B no puede colar una devolucion con la linea de recepcion o el proveedor de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.supplier_returns (tenant_id, goods_receipt_line_id, supplier_id, qty, reason)
          values (${tenantB}, ${lineaRecepcion}, ${proveedorA}, 1, 'x')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('se marca enviada, y ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.supplier_returns set status = 'sent', sent_at = now() where id = ${devolucion}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.supplier_returns set reason = 'otro' where id = ${devolucion}`),
    ).rejects.toThrow(/ya quedo resuelta/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'receipts', true))

  it('sin el modulo, las recepciones dan cero filas', async () => {
    await modulo(tenantB, 'receipts', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.goods_receipts`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('aceptado + rechazado que no suma lo recibido se rechaza', async () => {
    await expect(
      sql`
        insert into public.goods_receipts (tenant_id, purchase_order_id, warehouse_id, supplier_id)
        values (${tenantA}, ${ordenA}, ${almacenA}, ${proveedorA})`,
    ).resolves.toBeDefined()
    const [r] = await sql`select id from public.goods_receipts where tenant_id = ${tenantA} order by created_at desc limit 1`
    await expect(
      sql`
        insert into public.goods_receipt_lines
          (receipt_id, tenant_id, purchase_order_line_id, product_id,
           qty_expected, qty_received, qty_accepted, qty_rejected, unit_cost)
        values (${r!.id}, ${tenantA}, ${lineaOrdenA}, ${productoA}, 10, 10, 8, 1, 50)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un monto de devolucion de cero o negativo se rechaza', async () => {
    const [r] = await sql`
      insert into public.goods_receipts (tenant_id, purchase_order_id, warehouse_id, supplier_id)
      values (${tenantA}, ${ordenA}, ${almacenA}, ${proveedorA}) returning id`
    const [l] = await sql`
      insert into public.goods_receipt_lines
        (receipt_id, tenant_id, purchase_order_line_id, product_id,
         qty_expected, qty_received, qty_accepted, qty_rejected, unit_cost)
      values (${r!.id}, ${tenantA}, ${lineaOrdenA}, ${productoA}, 10, 10, 10, 0, 50) returning id`
    await expect(
      sql`
        insert into public.supplier_returns (tenant_id, goods_receipt_line_id, supplier_id, qty, reason)
        values (${tenantA}, ${l!.id}, ${proveedorA}, 0, 'x')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un estado de devolucion inventado se rechaza', async () => {
    const [r] = await sql`select id from public.goods_receipt_lines where tenant_id = ${tenantA} limit 1`
    await expect(
      sql`
        insert into public.supplier_returns (tenant_id, goods_receipt_line_id, supplier_id, qty, reason, status)
        values (${tenantA}, ${r!.id}, ${proveedorA}, 1, 'x', 'en_camino')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
