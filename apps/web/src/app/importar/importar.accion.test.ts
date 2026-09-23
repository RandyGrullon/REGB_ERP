import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { deshacerImportacion, importarProductos } from './actions'

/**
 * importarProductos() y deshacerImportacion() llamadas DE VERDAD.
 *
 * Fija las dos deudas que corrompian datos sin avisar:
 *  - "1,234" entraba como RD$1.23 (y "1.234,56" de un Excel en espanol
 *    partia la fila en dos columnas).
 *  - un SKU que ya existia se contaba como "entro" aunque el
 *    `on conflict do nothing` lo descartara.
 * Y que deshacer sigue borrando SOLO lo que el lote creo.
 */

let c: ClientePrueba

const CSV_RD = [
  'codigo,nombre,precio,costo',
  'INV-1,Inversor 1500W,"1,234",980.50',
  'EXIST-1,Nombre que no debe pisar,5.00,',
  'BAT-1,Bateria 100Ah,"RD$ 2,500.00",',
  'GRA-1,Grasa,gratis,',
  'INV-1,Inversor repetido,10.00,',
].join('\r\n')

// Lo que exporta Excel en espanol: punto y coma, coma decimal, SIN comillas.
const CSV_EXCEL_ES = [
  'codigo;nombre;precio;costo',
  'USADO-1;Tubo PVC 1/2;1.234,56;980,00',
  'PEND-1;Codo PVC;1.500;',
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

async function productos() {
  return db()<
    { sku: string; name: string; price: string; cost: string | null; lote: string | null }[]
  >`
    select sku, name, price::text, cost::text, import_batch_id::text as lote
    from public.products where tenant_id = ${c.tenantId} order by sku`
}

async function lote(fileName: string, n = 0) {
  const rs = await db()<
    {
      id: string
      total_rows: number
      inserted: number
      rejected: number
      errors: { row: number; column: string; message: string; kind?: string }[]
      undone_at: string | null
    }[]
  >`
    select id, total_rows, inserted, rejected, errors, undone_at::text
    from public.import_batches
    where tenant_id = ${c.tenantId} and file_name = ${fileName}
    order by created_at`
  return rs[n]!
}

async function eventos(tipo: string) {
  return db()<{ payload: Record<string, unknown> }[]>`
    select payload from public.event_outbox
    where tenant_id = ${c.tenantId} and type = ${tipo} order by id`
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-imp',
    nombre: 'Ferreteria Accion Importa SRL',
    modulos: ['products', 'imports'],
    roles: {
      Importador: { 'imports.*': true, 'products.*': true },
      SoloImportar: { 'imports.*': true, 'products.view': true },
    },
  })
  await db()`
    insert into public.products (tenant_id, sku, name, price, cost)
    values (${c.tenantId}, 'EXIST-1', 'Original', 999.00, 800.00)`
})

afterAll(async () => {
  // Un escaneo registrado no se borra por diseño (0069). Se apaga el
  // trigger solo en esta transaccion, como en consolidacion.accion.test.ts.
  await db().begin(async (tx) => {
    await tx.unsafe('set local session_replication_role = replica')
    await tx`delete from public.barcode_scans where tenant_id = ${c.tenantId}`
  })
  await c.limpiar(['public.products', 'public.import_batches'])
  await cerrarBase()
})

describe('importar un CSV de RD con 1,234 y SKU repetidos', () => {
  it('guarda 1,234 como 1234.00 y no toca el SKU que ya existia', async () => {
    await importarProductos(conArchivo(CSV_RD, 'ferreteria-sept.csv'))
    expect(aviso()).toEqual({
      tipo: 'ok',
      texto:
        'Importamos 2 productos nuevos. 1 ya existia y lo dejamos como estaba. 2 filas rechazadas: mira el detalle abajo.',
    })

    const l = await lote('ferreteria-sept.csv')
    expect(await productos()).toEqual([
      { sku: 'BAT-1', name: 'Bateria 100Ah', price: '2500.00', cost: null, lote: l.id },
      { sku: 'EXIST-1', name: 'Original', price: '999.00', cost: '800.00', lote: null },
      { sku: 'INV-1', name: 'Inversor 1500W', price: '1234.00', cost: '980.50', lote: l.id },
    ])
  })

  it('el lote cuenta nuevos, ya existentes y rechazados por separado', async () => {
    const l = await lote('ferreteria-sept.csv')
    expect(l.total_rows).toBe(5)
    expect(l.inserted).toBe(2)
    expect(l.rejected).toBe(2)
    const omitidas = l.errors.filter((e) => e.kind === 'skipped')
    const rechazadas = l.errors.filter((e) => e.kind !== 'skipped')
    expect(omitidas).toEqual([
      {
        row: 3,
        column: 'sku',
        message: 'El codigo "EXIST-1" ya existia: lo dejamos como estaba.',
        kind: 'skipped',
      },
    ])
    expect(rechazadas.map((e) => [e.row, e.column])).toEqual([
      [5, 'price'],
      [6, 'sku'],
    ])
    // Cada fila del archivo cae en exactamente un monton.
    expect(l.inserted + omitidas.length + l.rejected).toBe(l.total_rows)
  })

  it('emite imports.batch.completed con los tres numeros', async () => {
    const l = await lote('ferreteria-sept.csv')
    expect(await eventos('imports.batch.completed')).toEqual([
      {
        payload: {
          batchId: l.id,
          target: 'products',
          fileName: 'ferreteria-sept.csv',
          totalRows: 5,
          inserted: 2,
          skipped: 1,
          rejected: 2,
        },
      },
    ])
  })

  it('subir el mismo archivo otra vez no dice que entro nada', async () => {
    await importarProductos(conArchivo(CSV_RD, 'ferreteria-sept.csv'))
    expect(aviso()).toEqual({
      tipo: 'error',
      texto:
        'No entro ningun producto nuevo. 3 ya existian y los dejamos como estaban. 2 filas rechazadas: mira el detalle abajo.',
    })
    const l2 = await lote('ferreteria-sept.csv', 1)
    expect(l2.inserted).toBe(0)
    expect(l2.errors.filter((e) => e.kind === 'skipped')).toHaveLength(3)
    expect(l2.rejected).toBe(2)
    expect(await productos()).toHaveLength(3)
  })
})

describe('importar el CSV de un Excel en espanol', () => {
  it('lee 1.234,56 y 1.500 sin partir la fila', async () => {
    await importarProductos(conArchivo(CSV_EXCEL_ES, 'excel-es.csv'))
    expect(aviso()).toEqual({ tipo: 'ok', texto: 'Importamos 2 productos nuevos.' })
    const ps = (await productos()).filter((p) => p.sku === 'USADO-1' || p.sku === 'PEND-1')
    expect(ps.map((p) => [p.sku, p.name, p.price, p.cost])).toEqual([
      ['PEND-1', 'Codo PVC', '1500.00', null],
      ['USADO-1', 'Tubo PVC 1/2', '1234.56', '980.00'],
    ])
  })
})

describe('deshacer sigue siendo exacto', () => {
  it('deshacer un lote donde todo ya existia no borra nada ajeno', async () => {
    const l2 = await lote('ferreteria-sept.csv', 1)
    await deshacerImportacion(c.fd({ batchId: l2.id }))
    expect(aviso()).toEqual({
      tipo: 'ok',
      texto: 'Deshicimos la importacion: borramos 0 productos.',
    })
    // INV-1 y BAT-1 son del PRIMER lote; EXIST-1 no es de ninguno.
    expect((await productos()).map((p) => p.sku)).toEqual([
      'BAT-1',
      'EXIST-1',
      'INV-1',
      'PEND-1',
      'USADO-1',
    ])
  })

  it('deshacer el primer lote borra sus 2 productos y deja el que ya existia', async () => {
    const l = await lote('ferreteria-sept.csv')
    await deshacerImportacion(c.fd({ batchId: l.id }))
    expect(aviso()).toEqual({
      tipo: 'ok',
      texto: 'Deshicimos la importacion: borramos 2 productos.',
    })
    const ps = await productos()
    expect(ps.map((p) => p.sku)).toEqual(['EXIST-1', 'PEND-1', 'USADO-1'])
    expect(ps[0]).toEqual({
      sku: 'EXIST-1',
      name: 'Original',
      price: '999.00',
      cost: '800.00',
      lote: null,
    })
    expect((await lote('ferreteria-sept.csv')).undone_at).not.toBeNull()
  })

  it('emite imports.batch.undone una vez por lote, y un segundo deshacer se niega', async () => {
    const l = await lote('ferreteria-sept.csv')
    await deshacerImportacion(c.fd({ batchId: l.id }))
    expect(aviso()).toEqual({ tipo: 'error', texto: 'Esa importacion ya estaba deshecha.' })

    const l2 = await lote('ferreteria-sept.csv', 1)
    expect(await eventos('imports.batch.undone')).toEqual([
      { payload: { batchId: l2.id, deleted: 0 } },
      { payload: { batchId: l.id, deleted: 2 } },
    ])
  })

  it('si un producto del lote ya se uso, se niega entero y lo dice', async () => {
    const [u] = await db()<{ id: string }[]>`
      select id from public.products where tenant_id = ${c.tenantId} and sku = 'USADO-1'`
    await db()`
      insert into public.barcode_scans (tenant_id, product_id, scanned_code)
      values (${c.tenantId}, ${u!.id}, '7460000000017')`

    const l3 = await lote('excel-es.csv')
    await deshacerImportacion(c.fd({ batchId: l3.id }))
    const a = aviso()
    expect(a.tipo).toBe('error')
    expect(a.texto).toMatch(/ya se usaron/)
    // Todo o nada: PEND-1, que no se uso, tampoco se borro.
    expect((await productos()).map((p) => p.sku)).toEqual(['EXIST-1', 'PEND-1', 'USADO-1'])
    expect((await lote('excel-es.csv')).undone_at).toBeNull()
    expect(await eventos('imports.batch.undone')).toHaveLength(2)
  })

  it('un id que no es de un lote se niega sin error de servidor', async () => {
    await deshacerImportacion(c.fd({ batchId: 'no-es-un-uuid' }))
    expect(aviso()).toEqual({ tipo: 'error', texto: 'Esa importacion no existe.' })
  })
})

describe('el permiso del destino manda', () => {
  it('sin products.create no se importa ni queda lote', async () => {
    await importarProductos(conArchivo(CSV_RD, 'sin-permiso.csv', 'SoloImportar'))
    expect(aviso().tipo).toBe('error')
    const [n] = await db()<{ c: string }[]>`
      select count(*)::text as c from public.import_batches
      where tenant_id = ${c.tenantId} and file_name = 'sin-permiso.csv'`
    expect(n!.c).toBe('0')
  })
})
