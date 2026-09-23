import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import {
  MODULOS_CREDITO,
  almacen,
  cliente,
  limpiarCredito,
  pedido,
  producto,
  secuencia,
} from '@/test/venta-a-credito'
import { emitirNotaDeCredito, facturarPedido } from './actions'
import { cerrarLiquidacion } from '../impuestos/liquidacion/actions'

/**
 * La nota de credito B04 llega a la DGII (0130 sobre la 0129).
 *
 * Una B04 que no sale en el 607 deja declaradas ventas que se devolvieron,
 * y un IT-1 que no la resta cobra ITBIS de mercancia que volvio al
 * almacen. Las dos cosas pasaban: la nota restaba del saldo del cliente y
 * de nada mas.
 *
 * Periodo fijo (marzo 2025) para no depender del dia en que corra: la
 * factura y la nota se emiten por las acciones y despues se fechan ahi.
 */

const PERIODO = '202503'

let c: ClientePrueba
let facturaId: string
let ncfFactura: string

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-b04',
    nombre: 'Tienda B04 SRL',
    modulos: [...MODULOS_CREDITO, 'taxes'],
    roles: { Dueno: { '*': true } },
  })
  const wh = await almacen(c.tenantId)
  const prod = await producto(c.tenantId, wh, { sku: 'NEV-1', precio: 1000, existencia: 50 })
  await secuencia(c.tenantId, 'B02')
  await secuencia(c.tenantId, 'B04')

  const cli = await cliente(c.tenantId, { nombre: 'Cliente que Devuelve' })
  const ped = await pedido(c.tenantId, {
    customerId: cli,
    warehouseId: wh,
    productId: prod,
    cantidad: 5,
    precio: 1000,
    estado: 'delivered',
  })
  expect(await facturarPedido(c.fd({ orderId: ped, ncfType: 'B02' }, 'Dueno'))).toEqual({ ok: true })
  const [f] = await db()<{ id: string; ncf: string; line: string }[]>`
    select i.id, i.ncf, (select id from public.customer_invoice_lines where invoice_id = i.id) as line
    from public.customer_invoices i where i.source_id = ${ped}`
  facturaId = f!.id
  ncfFactura = f!.ncf

  expect(
    await emitirNotaDeCredito(
      c.fd(
        { invoiceId: facturaId, kind: 'return', reason: 'Devolvio 2 neveras', [`qty_${f!.line}`]: '2' },
        'Dueno',
      ),
    ),
  ).toEqual({ ok: true })

  await db()`update public.customer_invoices
             set issue_date = '2025-03-10', due_date = '2025-04-09' where id = ${facturaId}`
  await db()`update public.customer_credit_notes set issue_date = '2025-03-20'
             where invoice_id = ${facturaId}`
})

afterAll(async () => {
  await db()`delete from public.tax_filings where tenant_id = ${c.tenantId}`
  await limpiarCredito(c.limpiar)
  await cerrarBase()
})

describe('La B04 en el 607 y en el IT-1', () => {
  it('la nota de credito se fecha en Santo Domingo por defecto', async () => {
    const [d] = await db()<{ d: string }[]>`
      select column_default as d from information_schema.columns
      where table_schema = 'public' and table_name = 'customer_credit_notes'
        and column_name = 'issue_date'`
    expect(d!.d).toMatch(/hoy_fiscal/)
  })

  it('el 607 del periodo trae la B04 con el NCF de la factura que modifica', async () => {
    const filas = await db()<
      {
        ncf: string
        ncf_type: string
        ncf_modificado: string | null
        monto_facturado: string
        itbis_facturado: string
        origen: string
      }[]
    >`
      select ncf, ncf_type, ncf_modificado, monto_facturado::text, itbis_facturado::text, origen
      from public.dgii_607
      where tenant_id = ${c.tenantId} and periodo = ${PERIODO}
      order by ncf`
    expect(filas).toHaveLength(2)
    const [factura, nota] = [filas.find((f) => f.ncf === ncfFactura), filas.find((f) => f.ncf_type === 'B04')]
    expect(factura).toMatchObject({ monto_facturado: '5000.00', itbis_facturado: '900.00' })
    expect(factura!.ncf_modificado).toBeNull()
    expect(nota).toMatchObject({
      ncf_modificado: ncfFactura,
      monto_facturado: '2000.00',
      itbis_facturado: '360.00',
      origen: 'nota_credito',
    })
    expect(nota!.ncf).toMatch(/^B04\d{8}$/)
  })

  it('el IT-1 del periodo resta el ITBIS de la nota: 900 - 360 = 540', async () => {
    const r = await cerrarLiquidacion(c.fd({ period: PERIODO }, 'Dueno'))
    expect(r).toEqual({ ok: true })
    const [f] = await db()<{ itbis_charged: string }[]>`
      select itbis_charged::text from public.tax_filings
      where tenant_id = ${c.tenantId} and form = 'IT-1' and period = ${PERIODO}`
    expect(Number(f!.itbis_charged)).toBe(540)
  })
})
