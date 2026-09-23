import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { ajustarInventario } from './actions'

/**
 * El "Ajuste manual" de /inventory, llamado DE VERDAD.
 *
 * Antes pedia "Producto (id)" y decia "Copia el id desde el catalogo": para
 * cargar la existencia inicial de un colmado habia que pegar 800 UUID. Ahora
 * el producto se escribe como lo conoce la gente: su codigo, su codigo de
 * barras (la pistola escribe eso) o su nombre.
 */

let c: ClientePrueba
let almacen = ''
const ids: Record<string, string> = {}

function ajuste(campos: Record<string, string>) {
  return ajustarInventario(
    c.fd({ warehouseId: almacen, qty: '1', reason: 'Existencia inicial', ...campos }),
  )
}

async function ultimoMovimiento() {
  const [m] = await db()<{ sku: string; tipo: string; qty: string; costo: string | null }[]>`
    select p.sku, m.movement_type as tipo, m.qty::text, m.unit_cost::text as costo
    from public.inventory_movements m join public.products p on p.id = m.product_id
    where m.tenant_id = ${c.tenantId}
    order by m.created_at desc limit 1`
  return m
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-ajuste',
    nombre: 'Colmado Ajuste SRL',
    modulos: ['products', 'inventory'],
    roles: { Almacen: { 'inventory.*': true, 'products.view': true } },
  })
  const [w] = await db()<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${c.tenantId}, 'Principal', 'PRIN', true) returning id`
  almacen = w!.id
  const ps = await db()<{ id: string; sku: string }[]>`
    insert into public.products (tenant_id, sku, name, price, cost, barcode)
    values (${c.tenantId}, 'ARZ-5', 'Arroz selecto 5 lb', 215, 178, '7460000000017'),
           (${c.tenantId}, 'ARZ-10', 'Arroz selecto 10 lb', 420, 350, null),
           (${c.tenantId}, 'ACE-1', 'Aceite 1 galon', 525, null, null),
           (${c.tenantId}, 'DES_1', 'Descuento 100% raro', 1, null, null)
    returning id, sku`
  for (const p of ps) ids[p.sku] = p.id
})

afterAll(async () => {
  await c.limpiar([
    'public.stock_levels',
    'public.inventory_movements',
    'public.products',
    'public.warehouses',
  ])
  await cerrarBase()
})

describe('el producto del ajuste se busca por codigo, codigo de barras o nombre', () => {
  it('por codigo (SKU), con su costo', async () => {
    expect(await ajuste({ producto: 'ARZ-5', qty: '10', unitCost: '180' })).toEqual({ ok: true })
    expect(await ultimoMovimiento()).toEqual({
      sku: 'ARZ-5',
      tipo: 'adjustment_in',
      qty: '10.000',
      costo: '180.0000',
    })
  })

  it('por codigo de barras, como lo escribe la pistola; sin costo hereda el del catalogo', async () => {
    expect(await ajuste({ producto: '7460000000017', qty: '5' })).toEqual({ ok: true })
    expect(await ultimoMovimiento()).toMatchObject({
      sku: 'ARZ-5',
      qty: '5.000',
      costo: '178.0000',
    })
  })

  it('por nombre completo, sin importar mayusculas', async () => {
    expect(await ajuste({ producto: 'aceite 1 GALON', qty: '3', unitCost: '95.50' })).toEqual({
      ok: true,
    })
    expect(await ultimoMovimiento()).toMatchObject({ sku: 'ACE-1', costo: '95.5000' })
  })

  it('por parte del nombre, si solo hay uno que coincide', async () => {
    expect(await ajuste({ producto: 'galon', qty: '1', unitCost: '95' })).toEqual({ ok: true })
    expect((await ultimoMovimiento())!.sku).toBe('ACE-1')
  })

  it('si coinciden varios, no adivina: dice cuales', async () => {
    const r = await ajuste({ producto: 'arroz selecto', qty: '1', unitCost: '1' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('Hay 2 productos')
      expect(r.error).toContain('ARZ-10')
      expect(r.error).toContain('ARZ-5')
    }
  })

  it('los comodines de SQL se buscan como texto: "100%" no coincide con todo', async () => {
    const r = await ajuste({ producto: '100%', qty: '1', unitCost: '1' })
    expect(r).toEqual({ ok: true })
    expect((await ultimoMovimiento())!.sku).toBe('DES_1')
  })

  it('si no existe, lo dice sin error de servidor', async () => {
    const r = await ajuste({ producto: 'teletransportador', qty: '1', unitCost: '1' })
    expect(r).toEqual({
      ok: false,
      error: expect.stringContaining('No encontramos ningun producto con "teletransportador"'),
    })
  })

  it('el id de siempre sigue sirviendo', async () => {
    expect(await ajuste({ productId: ids['ARZ-10']!, qty: '2', unitCost: '350' })).toEqual({
      ok: true,
    })
    expect((await ultimoMovimiento())!.sku).toBe('ARZ-10')
  })

  it('sin producto ni id, falta el dato', async () => {
    expect(await ajuste({})).toEqual({ ok: false, error: 'Elige el producto.' })
  })
})
