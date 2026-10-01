import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { correrMrp } from './actions'

/**
 * Correr la planificación de materiales (revisión del área de operación,
 * 30 sep). Al pasar los mensajes a español llano, el texto que devolvía la
 * transacción dejó de coincidir con el que se comparaba después, y un
 * producto sin receta "planificaba" en silencio: la acción respondía
 * `ok` sin crear nada. Estas pruebas fijan que el error llegue.
 */

let c: ClientePrueba
let mesa: string
let tabla: string
let silla: string

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-mrp',
    nombre: 'Muebles del Yaque SRL',
    modulos: ['products', 'inventory', 'bom', 'manufacturing', 'mrp'],
    roles: { Planificador: { 'mrp.*': true } },
  })
  const sql = db()
  const productos = await sql<{ id: string; sku: string }[]>`
    insert into public.products (tenant_id, sku, name, unit, tracks_stock)
    values (${c.tenantId}, 'MESA-01', 'Mesa de comedor', 'unidad', true),
           (${c.tenantId}, 'TAB-01', 'Tabla de caoba', 'unidad', true),
           (${c.tenantId}, 'SIL-01', 'Silla sin receta', 'unidad', true)
    returning id, sku`
  mesa = productos.find((p) => p.sku === 'MESA-01')!.id
  tabla = productos.find((p) => p.sku === 'TAB-01')!.id
  silla = productos.find((p) => p.sku === 'SIL-01')!.id
  const [bom] = await sql<{ id: string }[]>`
    insert into public.bill_of_materials (tenant_id, product_id, version, output_qty, status)
    values (${c.tenantId}, ${mesa}, 1, 1, 'active') returning id`
  await sql`
    insert into public.bom_lines (bom_id, tenant_id, component_product_id, quantity_per_unit)
    values (${bom!.id}, ${c.tenantId}, ${tabla}, 4)`
})

afterAll(async () => {
  // Una corrida registrada no se borra (la base lo impide): en modo
  // réplica para limpiar el cliente de prueba.
  await db().begin(async (tx) => {
    await tx`set local session_replication_role = replica`
    for (const t of ['mrp_suggestions', 'mrp_runs', 'bom_lines', 'bill_of_materials', 'products']) {
      await tx.unsafe(`delete from public.${t} where tenant_id = $1`, [c.tenantId])
    }
  })
  await c.limpiar()
  await cerrarBase()
})

describe('correr la planificación', () => {
  it('un producto sin receta activa devuelve el error y no deja corrida', async () => {
    const r = await correrMrp(c.fd({ productId: silla, targetQty: '5' }))
    expect(r).toEqual({ ok: false, error: expect.stringContaining('no tiene una receta activa') })
    const [n] = await db()<{ n: number }[]>`
      select count(*)::int as n from public.mrp_runs
      where tenant_id = ${c.tenantId} and target_product_id = ${silla}`
    expect(n!.n).toBe(0)
  })

  it('con receta, sugiere comprar lo que falta', async () => {
    expect(await correrMrp(c.fd({ productId: mesa, targetQty: '3' }))).toEqual({ ok: true })
    const s = await db()<{ product_id: string; action: string; qty: string }[]>`
      select s.product_id, s.action, s.qty_suggested::text as qty
      from public.mrp_suggestions s
      join public.mrp_runs r on r.id = s.run_id
      where r.tenant_id = ${c.tenantId} and r.target_product_id = ${mesa}`
    expect(s).toHaveLength(1)
    expect(s[0]!.product_id).toBe(tabla)
    expect(s[0]!.action).toBe('purchase')
    expect(Number(s[0]!.qty)).toBe(12)
  })

  it('una cantidad en cero no corre', async () => {
    expect(await correrMrp(c.fd({ productId: mesa, targetQty: '0' }))).toEqual({
      ok: false,
      error: 'La cantidad debe ser mayor que cero.',
    })
  })
})
