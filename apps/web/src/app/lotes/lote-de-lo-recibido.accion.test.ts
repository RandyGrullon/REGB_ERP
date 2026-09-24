import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { registrarLote } from './actions'

/**
 * Ponerle lote a lo que ya llego (cliente misterioso, 23 sep).
 *
 * Recepciones no pide lote. Registrar despues el lote de esos galones era
 * un ajuste de ENTRADA: 15 recibidos + 15 "del lote" = 30 en el sistema y
 * 15 en el estante. Ahora el formulario pregunta de donde sale: si ya esta
 * en el almacen, solo se le pone numero de lote, sin tocar la existencia,
 * y nunca a mas de lo que hay sin lote.
 */

let c: ClientePrueba
let almacen: string
let pintura: string

async function existencia(): Promise<number> {
  const [s] = await db()<{ qty: string }[]>`
    select qty_on_hand::text as qty from public.stock_levels
    where tenant_id = ${c.tenantId} and warehouse_id = ${almacen} and product_id = ${pintura}`
  return Number(s?.qty ?? 0)
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-lotes',
    nombre: 'Pinturas con Lote SRL',
    modulos: ['products', 'inventory', 'lots-serials'],
    roles: { Owner: { '*': true } },
  })
  const sql = db()
  const [w] = await sql<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name, is_default)
    values (${c.tenantId}, 'Santiago', true) returning id`
  almacen = w!.id
  const [p] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, unit, price, tax_rate)
    values (${c.tenantId}, 'PIN-300', 'Pintura blanca', 'galon', 890, 0.18) returning id`
  pintura = p!.id
  // Lo que dejo una recepcion: 15 galones, sin lote.
  await sql`
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost)
    values (${c.tenantId}, ${almacen}, ${pintura}, 'receipt', 15, 600)`
})

afterAll(async () => {
  const sql = db()
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`
    for (const t of [
      'lot_stock',
      'product_lots',
      'inventory_movements',
      'stock_levels',
      'products',
      'warehouses',
    ]) {
      await tx.unsafe(`delete from public.${t} where tenant_id = $1`, [c.tenantId])
    }
  })
  await c.limpiar()
  await cerrarBase()
})

describe('lote de lo que ya esta en el almacen', () => {
  it('ponerle lote a lo recibido no suma existencia', async () => {
    const r = await registrarLote(
      c.fd({
        productId: pintura,
        warehouseId: almacen,
        lotNumber: 'PIN-2026-B',
        expiryDate: '2027-06-30',
        qty: '10',
        origen: 'existente',
      }),
    )
    expect(r).toEqual({ ok: true })
    expect(await existencia()).toBe(15)
  })

  it('no se le pone lote a mas de lo que hay sin lote', async () => {
    const r = await registrarLote(
      c.fd({
        productId: pintura,
        warehouseId: almacen,
        lotNumber: 'PIN-2026-C',
        qty: '6',
        origen: 'existente',
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/solo le puedes poner lote a 5/)
    expect(await existencia()).toBe(15)
  })

  it('un lote que ENTRA ahora si suma, y pide su costo', async () => {
    const sinCosto = await registrarLote(
      c.fd({
        productId: pintura,
        warehouseId: almacen,
        lotNumber: 'PIN-2026-D',
        qty: '4',
        origen: 'entrada',
      }),
    )
    expect(sinCosto.ok).toBe(false)
    expect(
      await registrarLote(
        c.fd({
          productId: pintura,
          warehouseId: almacen,
          lotNumber: 'PIN-2026-D',
          qty: '4',
          unitCost: '620',
          origen: 'entrada',
        }),
      ),
    ).toEqual({ ok: true })
    expect(await existencia()).toBe(19)
  })
})
