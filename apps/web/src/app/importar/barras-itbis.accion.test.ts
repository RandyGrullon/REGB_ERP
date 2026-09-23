import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { deshacerImportacion, importarProductos } from './actions'

/**
 * El CSV de productos con codigo de barras, tasa de ITBIS y exento,
 * llamado DE VERDAD contra la base.
 *
 * Lo que fija:
 *  - el codigo de barras y la tasa llegan a `products` (antes no habia
 *    columnas y cada exento se editaba a mano);
 *  - sin tasa en la fila manda la tasa por defecto del cliente (0118);
 *  - un codigo de barras que ya tiene OTRO producto se rechaza en su fila
 *    -antes el indice unico habria tumbado la importacion entera-, y el
 *    conteo nuevos + ya existian + rechazadas sigue cuadrando;
 *  - deshacer sigue siendo exacto.
 */

let c: ClientePrueba

const CSV = [
  'codigo,nombre,precio,codigo de barras,itbis,exento',
  'ARZ-5,Arroz selecto 5 lb,215.00,7460000000017,,si',
  'ACE-1,Aceite 1 gal,525.00,7460000000024,18%,',
  'YOG-1,Yogurt,65.00,,16%,no',
  'PAN-1,Pan sobao,10.00,,,',
  'CHO-1,Chocolate,"1,250.00",7460000000099,,',
  'MAL-1,Malta,50.00,,12%,',
  'EXIST-1,Nombre que no pisa,5.00,7460000000055,,',
].join('\r\n')

function conArchivo(texto: string, nombre: string): FormData {
  const fd = c.fd()
  fd.set('archivo', new File([texto], nombre, { type: 'text/csv' }))
  return fd
}

function aviso(): { tipo: string; texto: string } {
  const g = tarro.get(COOKIE_AVISO)
  tarro.delete(COOKIE_AVISO)
  return g ? JSON.parse(g.value) : { tipo: 'ninguno', texto: '' }
}

async function productos() {
  return db()<{ sku: string; barcode: string | null; tax_rate: string; lote: string | null }[]>`
    select sku, barcode, tax_rate::text, import_batch_id::text as lote
    from public.products where tenant_id = ${c.tenantId} order by sku`
}

async function lote(fileName: string) {
  const [l] = await db()<
    {
      id: string
      total_rows: number
      inserted: number
      rejected: number
      errors: { row: number; column: string; message: string; kind?: string }[]
    }[]
  >`
    select id, total_rows, inserted, rejected, errors
    from public.import_batches where tenant_id = ${c.tenantId} and file_name = ${fileName}`
  return l!
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-barras',
    nombre: 'Colmado Barras e ITBIS SRL',
    modulos: ['products', 'imports'],
    roles: { Importador: { 'imports.*': true, 'products.*': true } },
  })
  // Un producto vivo que ya usa el codigo 7460000000099: CHO-1 no puede
  // quitarselo. Y EXIST-1, que ya existe con su propio codigo.
  await db()`
    insert into public.products (tenant_id, sku, name, price, barcode)
    values (${c.tenantId}, 'VIE-1', 'Producto viejo', 10, '7460000000099'),
           (${c.tenantId}, 'EXIST-1', 'Original', 999, '7460000000055')`
})

afterAll(async () => {
  await c.limpiar(['public.products', 'public.import_batches'])
  await cerrarBase()
})

describe('codigo de barras y tasa de ITBIS desde el CSV', () => {
  it('guarda codigo, exento, 18%, 16% y la tasa por defecto donde no dice', async () => {
    await importarProductos(conArchivo(CSV, 'colmado-barras.csv'))
    expect(aviso()).toEqual({
      tipo: 'ok',
      texto:
        'Importamos 4 productos nuevos. 1 ya existia y lo dejamos como estaba. 2 filas rechazadas: mira el detalle abajo.',
    })

    const l = await lote('colmado-barras.csv')
    const ps = await productos()
    expect(ps.map((p) => [p.sku, p.barcode, p.tax_rate])).toEqual([
      ['ACE-1', '7460000000024', '0.1800'],
      ['ARZ-5', '7460000000017', '0.0000'],
      ['EXIST-1', '7460000000055', '0.1800'],
      ['PAN-1', null, '0.1800'],
      ['VIE-1', '7460000000099', '0.1800'],
      ['YOG-1', null, '0.1600'],
    ])
    expect(ps.filter((p) => p.lote === l.id).map((p) => p.sku)).toEqual([
      'ACE-1',
      'ARZ-5',
      'PAN-1',
      'YOG-1',
    ])
  })

  it('el codigo de barras ajeno y la tasa invalida se rechazan en su fila, con motivo', async () => {
    const l = await lote('colmado-barras.csv')
    const rechazadas = l.errors.filter((e) => e.kind !== 'skipped')
    expect(rechazadas.map((e) => [e.row, e.column])).toEqual([
      [7, 'taxRate'],
      [6, 'barcode'],
    ])
    expect(rechazadas[1]!.message).toBe(
      'El codigo de barras "7460000000099" ya lo tiene el producto VIE-1: un codigo de barras identifica un solo producto.',
    )
    // Cada fila en un solo monton, y el lote cuenta las rechazadas por la
    // base junto con las rechazadas por la lectura.
    const omitidas = l.errors.filter((e) => e.kind === 'skipped')
    expect(l.total_rows).toBe(7)
    expect(l.inserted).toBe(4)
    expect(l.rejected).toBe(2)
    expect(omitidas).toHaveLength(1)
    expect(l.inserted + omitidas.length + l.rejected).toBe(l.total_rows)
  })

  it('el evento lleva los mismos tres numeros', async () => {
    const l = await lote('colmado-barras.csv')
    const [e] = await db()<{ payload: Record<string, unknown> }[]>`
      select payload from public.event_outbox
      where tenant_id = ${c.tenantId} and type = 'imports.batch.completed'
        and payload ->> 'batchId' = ${l.id}`
    expect(e!.payload).toMatchObject({ inserted: 4, skipped: 1, rejected: 2 })
  })

  it('deshacer borra los 4 y el codigo de barras queda libre otra vez', async () => {
    const l = await lote('colmado-barras.csv')
    await deshacerImportacion(c.fd({ batchId: l.id }))
    expect(aviso()).toEqual({
      tipo: 'ok',
      texto: 'Deshicimos la importacion: borramos 4 productos.',
    })
    expect((await productos()).map((p) => p.sku)).toEqual(['EXIST-1', 'VIE-1'])

    await importarProductos(
      conArchivo('codigo,nombre,codigo de barras\nARZ-5,Arroz,7460000000017', 'otra-vez.csv'),
    )
    expect(aviso().tipo).toBe('ok')
    const [arroz] = (await productos()).filter((p) => p.sku === 'ARZ-5')
    expect(arroz!.barcode).toBe('7460000000017')
  })
})

describe('la tasa por defecto del cliente manda cuando la fila no dice', () => {
  it('con ITBIS-16 por defecto en Impuestos, un producto sin tasa nace al 16%', async () => {
    await c.modulo('taxes', true)
    await db()`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${c.tenantId}, 'taxes', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
    await db()`
      insert into public.tax_rates (tenant_id, code, name, kind, rate, is_default, effective_from)
      values (${c.tenantId}, 'ITBIS16', 'ITBIS reducido', 'itbis', 0.16, true, current_date - 1)`

    await importarProductos(
      conArchivo('codigo,nombre,itbis\nLEC-1,Leche,\nREF-1,Refresco,18%', 'tasa-cliente.csv'),
    )
    expect(aviso().tipo).toBe('ok')
    const ps = (await productos()).filter((p) => p.sku === 'LEC-1' || p.sku === 'REF-1')
    expect(ps.map((p) => [p.sku, p.tax_rate])).toEqual([
      ['LEC-1', '0.1600'],
      ['REF-1', '0.1800'],
    ])
  })
})
