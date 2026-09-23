import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { deshacerExistencias, deshacerImportacion, importarExistencias } from './actions'

/**
 * Existencias iniciales por CSV, llamadas DE VERDAD.
 *
 * Antes: "Ajuste manual" pegando el UUID del producto, uno por uno. Ahora
 * un archivo con codigo, almacen, cantidad y costo, con la misma
 * disciplina del CSV de productos: cada fila nueva / ya tenia / rechazada
 * con motivo, numeros con la regla de imports, y deshacer exacto -con el
 * movimiento contrario, porque el kardex no se borra-.
 */

let c: ClientePrueba
const ids: Record<string, string> = {}

const CSV = [
  'codigo,almacen,cantidad,costo',
  'INV-1,,10,"1,000.00"', // 2: al predeterminado, 10 a 1,000
  'INV-1,STI,4,', //          3: Santiago por codigo, costo del catalogo (900)
  '7460000000031,Santiago,20,45.50', // 4: por codigo de barras
  'BAT-1,,3,', //             5: sin costo y sin costo en catalogo
  'SRV-1,,1,10', //           6: no lleva existencias
  'NOPE-1,,1,10', //          7: no existe
  'INV-1,Bodega Fantasma,1,10', // 8: almacen que no existe
  'EXIST-1,,7,120', //        9: ya tenia existencia: se deja
  'INV-1,PRIN,2,10', //       10: el mismo almacen que la linea 2
  'GRA-1,,1.500,10', //       11: 1.500 es ambiguo en un archivo de RD
].join('\r\n')

function conArchivo(texto: string, nombre: string, rol?: string): FormData {
  const fd = c.fd({}, rol)
  fd.set('archivo', new File([texto], nombre, { type: 'text/csv' }))
  return fd
}

function aviso(): { tipo: string; texto: string } {
  const g = tarro.get(COOKIE_AVISO)
  tarro.delete(COOKIE_AVISO)
  return g ? JSON.parse(g.value) : { tipo: 'ninguno', texto: '' }
}

async function lote(fileName: string, n = 0) {
  const rs = await db()<
    {
      id: string
      target: string
      total_rows: number
      inserted: number
      rejected: number
      errors: { row: number; column: string; message: string; kind?: string }[]
      undone_at: string | null
    }[]
  >`
    select id, target, total_rows, inserted, rejected, errors, undone_at::text
    from public.import_batches
    where tenant_id = ${c.tenantId} and file_name = ${fileName} order by created_at`
  return rs[n]!
}

async function existencias() {
  return db()<{ sku: string; almacen: string; qty: string; avg: string }[]>`
    select p.sku, w.code as almacen, sl.qty_on_hand::text as qty, sl.avg_cost::text as avg
    from public.stock_levels sl
    join public.products p on p.id = sl.product_id
    join public.warehouses w on w.id = sl.warehouse_id
    where sl.tenant_id = ${c.tenantId}
    order by p.sku, w.code`
}

async function movimientosDelLote(batchId: string) {
  return db()<{ tipo: string; ref: string; qty: string; costo: string | null }[]>`
    select movement_type as tipo, reference_type as ref, qty::text, unit_cost::text as costo
    from public.inventory_movements
    where tenant_id = ${c.tenantId} and reference_id = ${batchId}
    order by created_at, inventory_movements.qty desc`
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-exis',
    nombre: 'Electronica Existencias SRL',
    modulos: ['products', 'imports', 'inventory'],
    roles: {
      // products.* para poder llamar tambien al deshacer de PRODUCTOS y
      // comprobar que no toca un lote de existencias.
      Cargador: { 'imports.*': true, 'inventory.*': true, 'products.*': true },
      SinAjuste: { 'imports.*': true, 'inventory.view': true },
      Limitado: { 'imports.*': true, 'inventory.adjust': true },
    },
  })
  await db()`
    update public.roles set scope = '{"max_amount": 5000}'::jsonb
    where tenant_id = ${c.tenantId} and name = 'Limitado'`

  const ws = await db()<{ id: string; code: string }[]>`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${c.tenantId}, 'Almacen Principal', 'PRIN', true),
           (${c.tenantId}, 'Santiago', 'STI', false)
    returning id, code`
  for (const w of ws) ids[w.code] = w.id

  const ps = await db()<{ id: string; sku: string }[]>`
    insert into public.products (tenant_id, sku, name, price, cost, barcode, tracks_stock)
    values (${c.tenantId}, 'INV-1', 'Inversor 1500W', 1500, 900, null, true),
           (${c.tenantId}, 'BAT-1', 'Bateria 100Ah', 800, null, null, true),
           (${c.tenantId}, 'CAB-1', 'Cable HDMI', 150, 50, '7460000000031', true),
           (${c.tenantId}, 'SRV-1', 'Instalacion', 500, null, null, false),
           (${c.tenantId}, 'EXIST-1', 'Regleta', 300, 100, null, true)
    returning id, sku`
  for (const p of ps) ids[p.sku] = p.id

  // EXIST-1 ya tiene 5 en el principal: la carga inicial no la pisa.
  await db()`
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, reason)
    values (${c.tenantId}, ${ids.PRIN!}, ${ids['EXIST-1']!}, 'adjustment_in', 5, 100, 'previo')`
})

afterAll(async () => {
  // El kardex es append-only por RLS; como dueño de la base se limpia.
  await c.limpiar([
    'public.stock_levels',
    'public.inventory_movements',
    'public.products',
    'public.warehouses',
    'public.import_batches',
  ])
  await cerrarBase()
})

describe('importar existencias iniciales', () => {
  it('carga 3 lineas, deja la que ya tenia existencia y rechaza 6 con su motivo', async () => {
    await importarExistencias(conArchivo(CSV, 'existencias-sept.csv'))
    expect(aviso()).toEqual({
      tipo: 'ok',
      texto:
        'Cargamos 3 existencias iniciales. 1 ya tenia existencia en ese almacen y la dejamos como estaba. 6 filas rechazadas: mira el detalle abajo.',
    })

    const l = await lote('existencias-sept.csv')
    expect(l.target).toBe('stock')
    expect(l.total_rows).toBe(10)
    expect(l.inserted).toBe(3)
    expect(l.rejected).toBe(6)
    const omitidas = l.errors.filter((e) => e.kind === 'skipped')
    const rechazadas = l.errors.filter((e) => e.kind !== 'skipped')
    expect(omitidas.map((e) => e.row)).toEqual([9])
    expect(omitidas[0]!.message).toContain('ya tiene 5')
    expect(
      rechazadas.map((e) => [e.row, e.column]).sort((a, b) => Number(a[0]) - Number(b[0])),
    ).toEqual([
      [5, 'unitCost'],
      [6, 'sku'],
      [7, 'sku'],
      [8, 'warehouse'],
      [10, 'warehouse'],
      [11, 'qty'],
    ])
    const porLinea = new Map(rechazadas.map((e) => [e.row, e.message]))
    expect(porLinea.get(5)).toContain('sin costo')
    expect(porLinea.get(6)).toContain('no lleva control de existencias')
    expect(porLinea.get(7)).toContain('"NOPE-1" no existe')
    expect(porLinea.get(8)).toContain('"Bodega Fantasma"')
    expect(porLinea.get(10)).toContain('linea 2')
    expect(porLinea.get(11)).toContain('ambiguo')
    expect(l.inserted + omitidas.length + l.rejected).toBe(l.total_rows)
  })

  it('cada linea es un adjustment_in CON costo que alimenta el costo promedio', async () => {
    const l = await lote('existencias-sept.csv')
    expect(await movimientosDelLote(l.id)).toEqual([
      { tipo: 'adjustment_in', ref: 'import_batch', qty: '20.000', costo: '45.5000' },
      { tipo: 'adjustment_in', ref: 'import_batch', qty: '10.000', costo: '1000.0000' },
      { tipo: 'adjustment_in', ref: 'import_batch', qty: '4.000', costo: '900.0000' },
    ])
    expect(await existencias()).toEqual([
      { sku: 'CAB-1', almacen: 'STI', qty: '20.000', avg: '45.5000' },
      { sku: 'EXIST-1', almacen: 'PRIN', qty: '5.000', avg: '100.0000' },
      { sku: 'INV-1', almacen: 'PRIN', qty: '10.000', avg: '1000.0000' },
      { sku: 'INV-1', almacen: 'STI', qty: '4.000', avg: '900.0000' },
    ])
  })

  it('emite imports.batch.completed con target stock y los tres numeros', async () => {
    const l = await lote('existencias-sept.csv')
    const [e] = await db()<{ payload: Record<string, unknown> }[]>`
      select payload from public.event_outbox
      where tenant_id = ${c.tenantId} and type = 'imports.batch.completed'
        and payload ->> 'batchId' = ${l.id}`
    expect(e!.payload).toEqual({
      batchId: l.id,
      target: 'stock',
      fileName: 'existencias-sept.csv',
      totalRows: 10,
      inserted: 3,
      skipped: 1,
      rejected: 6,
    })
  })
})

describe('deshacer una carga de existencias', () => {
  it('el deshacer de productos no toca un lote de existencias', async () => {
    const l = await lote('existencias-sept.csv')
    await deshacerImportacion(c.fd({ batchId: l.id }))
    expect(aviso()).toEqual({
      tipo: 'error',
      texto: 'Esa importacion es de existencias: se deshace con su propio boton.',
    })
    expect((await lote('existencias-sept.csv')).undone_at).toBeNull()
  })

  it('inserta el movimiento contrario de cada linea y todo vuelve a cero', async () => {
    const l = await lote('existencias-sept.csv')
    await deshacerExistencias(c.fd({ batchId: l.id }))
    expect(aviso()).toEqual({
      tipo: 'ok',
      texto:
        'Deshicimos la carga: 3 existencias volvieron a cero con su movimiento contrario. El kardex conserva los dos.',
    })
    expect(await existencias()).toEqual([
      { sku: 'CAB-1', almacen: 'STI', qty: '0.000', avg: '45.5000' },
      { sku: 'EXIST-1', almacen: 'PRIN', qty: '5.000', avg: '100.0000' },
      { sku: 'INV-1', almacen: 'PRIN', qty: '0.000', avg: '1000.0000' },
      { sku: 'INV-1', almacen: 'STI', qty: '0.000', avg: '900.0000' },
    ])
    const movs = await movimientosDelLote(l.id)
    expect(movs.filter((m) => m.ref === 'import_batch_undo').map((m) => [m.tipo, m.qty])).toEqual([
      ['adjustment_out', '-4.000'],
      ['adjustment_out', '-10.000'],
      ['adjustment_out', '-20.000'],
    ])
    expect((await lote('existencias-sept.csv')).undone_at).not.toBeNull()

    const [e] = await db()<{ payload: Record<string, unknown> }[]>`
      select payload from public.event_outbox
      where tenant_id = ${c.tenantId} and type = 'imports.batch.undone'
        and payload ->> 'batchId' = ${l.id}`
    expect(e!.payload).toEqual({ batchId: l.id, target: 'stock', reversed: 3 })
  })

  it('un segundo deshacer se niega', async () => {
    const l = await lote('existencias-sept.csv')
    await deshacerExistencias(c.fd({ batchId: l.id }))
    expect(aviso()).toEqual({ tipo: 'error', texto: 'Esa importacion ya estaba deshecha.' })
  })

  it('tras deshacer se puede volver a cargar; si luego se vendio, deshacer se niega entero', async () => {
    await importarExistencias(
      conArchivo('codigo,almacen,cantidad,costo\nINV-1,,6,950\nCAB-1,STI,2,40', 'segunda.csv'),
    )
    expect(aviso().tipo).toBe('ok')
    const l = await lote('segunda.csv')
    expect(l.inserted).toBe(2)

    // Una venta de INV-1 despues de la carga.
    await db()`
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, movement_type, qty, reason)
      values (${c.tenantId}, ${ids.PRIN!}, ${ids['INV-1']!}, 'sale', -1, 'venta')`

    await deshacerExistencias(c.fd({ batchId: l.id }))
    const a = aviso()
    expect(a.tipo).toBe('error')
    expect(a.texto).toContain('ya se movieron')
    // Todo o nada: CAB-1, que no se movio, tampoco se revirtio.
    expect((await lote('segunda.csv')).undone_at).toBeNull()
    expect((await movimientosDelLote(l.id)).filter((m) => m.ref === 'import_batch_undo')).toEqual(
      [],
    )
  })
})

describe('permisos y limites', () => {
  it('sin inventory.adjust no se carga ni queda lote', async () => {
    await importarExistencias(
      conArchivo('codigo,cantidad,costo\nINV-1,1,10', 'sin-ajuste.csv', 'SinAjuste'),
    )
    expect(aviso().tipo).toBe('error')
    const [n] = await db()<{ n: number }[]>`
      select count(*)::int as n from public.import_batches
      where tenant_id = ${c.tenantId} and file_name = 'sin-ajuste.csv'`
    expect(n!.n).toBe(0)
  })

  it('una fila por encima del max_amount del rol se rechaza; las demas entran', async () => {
    await importarExistencias(
      conArchivo(
        'codigo,almacen,cantidad,costo\nBAT-1,STI,10,1000\nCAB-1,PRIN,10,40',
        'limitado.csv',
        'Limitado',
      ),
    )
    expect(aviso().tipo).toBe('ok')
    const l = await lote('limitado.csv')
    expect(l.inserted).toBe(1)
    expect(l.rejected).toBe(1)
    expect(l.errors[0]).toMatchObject({ row: 2, column: 'qty' })
    expect(l.errors[0]!.message).toContain('limite')
  })

  it('sin ningun almacen activo lo dice y no deja lote', async () => {
    await db()`update public.warehouses set is_active = false where tenant_id = ${c.tenantId}`
    try {
      await importarExistencias(conArchivo('codigo,cantidad,costo\nINV-1,1,10', 'sin-almacen.csv'))
      expect(aviso()).toEqual({
        tipo: 'error',
        texto:
          'Todavia no hay ningun almacen activo. Crea uno en Existencias > Almacenes y vuelve a subir el archivo.',
      })
    } finally {
      await db()`update public.warehouses set is_active = true where tenant_id = ${c.tenantId}`
    }
  })
})
