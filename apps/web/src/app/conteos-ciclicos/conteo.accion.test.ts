import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { aprobarConteo, enviarConteo, iniciarConteo, registrarLineaConteo } from './actions'

/**
 * Conteo ciclico ciego de punta a punta (cliente misterioso, 23 sep).
 *
 * Lo que se arreglo: iniciar un conteo en un almacen sin existencias
 * insertaba el conteo ANTES de mirar si habia algo que contar, y el
 * `return` del medio no deshace nada: quedaba un conteo "Contando" sin
 * productos, que nadie podia enviar ni cerrar.
 */

let c: ClientePrueba
let lleno: string
let vacio: string
let cemento: string

async function conteos(almacen: string): Promise<number> {
  const [n] = await db()<{ n: number }[]>`
    select count(*)::int as n from public.cycle_counts
    where tenant_id = ${c.tenantId} and warehouse_id = ${almacen}`
  return n!.n
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-conteo',
    nombre: 'Conteos a Ciegas SRL',
    modulos: ['products', 'inventory', 'stock-counts'],
    roles: {
      Owner: { '*': true },
      Almacenista: { 'stock-counts.count': true, 'stock-counts.view': true },
    },
  })
  const sql = db()
  const [a] = await sql<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name, is_default)
    values (${c.tenantId}, 'Santo Domingo', true) returning id`
  const [b] = await sql<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name) values (${c.tenantId}, 'Santiago') returning id`
  lleno = a!.id
  vacio = b!.id
  const [p] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, unit, price, tax_rate)
    values (${c.tenantId}, 'CEM-100', 'Cemento gris', 'saco', 465, 0.18) returning id`
  cemento = p!.id
  await sql`
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost)
    values (${c.tenantId}, ${lleno}, ${cemento}, 'adjustment_in', 38, 400)`
})

afterAll(async () => {
  const sql = db()
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`
    for (const t of [
      'cycle_count_lines',
      'cycle_counts',
      'count_schedules',
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

describe('iniciar', () => {
  it('un almacen sin existencias no deja un conteo vacio colgado', async () => {
    const r = await iniciarConteo(c.fd({ warehouseId: vacio }))
    expect(r).toEqual({ ok: false, error: 'Ese almacen no tiene existencias para contar.' })
    expect(await conteos(vacio)).toBe(0)
  })
})

describe('contar a ciegas y aprobar', () => {
  it('el almacenista cuenta, el dueño aprueba, y el ajuste es la diferencia', async () => {
    expect(await iniciarConteo(c.fd({ warehouseId: lleno }))).toEqual({ ok: true })
    const [conteo] = await db()<{ id: string }[]>`
      select id from public.cycle_counts where tenant_id = ${c.tenantId} and warehouse_id = ${lleno}`
    const [linea] = await db()<{ id: string }[]>`
      select id from public.cycle_count_lines where count_id = ${conteo!.id}`

    expect(
      await registrarLineaConteo(
        c.fd({ countId: conteo!.id, lineId: linea!.id, counted: '37' }, 'Almacenista'),
      ),
    ).toEqual({ ok: true })
    expect(await enviarConteo(c.fd({ countId: conteo!.id }, 'Almacenista'))).toEqual({ ok: true })
    // El almacenista no aprueba lo que el mismo conto.
    expect((await aprobarConteo(c.fd({ countId: conteo!.id }, 'Almacenista'))).ok).toBe(false)
    expect(await aprobarConteo(c.fd({ countId: conteo!.id }, 'Owner'))).toEqual({ ok: true })

    const [s] = await db()<{ qty: string; avg: string }[]>`
      select qty_on_hand::text as qty, avg_cost::text as avg from public.stock_levels
      where tenant_id = ${c.tenantId} and warehouse_id = ${lleno} and product_id = ${cemento}`
    expect({ qty: Number(s!.qty), avg: Number(s!.avg) }).toEqual({ qty: 37, avg: 400 })
  })
})
