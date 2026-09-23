import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fechaFiscal } from '@regb/operations'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { cerrarLiquidacion } from '@/app/impuestos/liquidacion/actions'
import { GET } from '@/app/api/dgii/[reporte]/route'
import { clasificarFactura, registrarFactura, registrarPago } from './actions'

/**
 * De la factura del proveedor al 606 y al IT-1, con las acciones reales.
 *
 * Hallazgo 7 del analisis de flujo: /pagar no pedia tipo de gasto, ni ISR
 * retenido, ni la fecha de la factura. El TXT del 606 respondia 409 sin
 * pantalla donde clasificar, y la retencion iba en UN campo que la vista
 * leia entera como ITBIS: el IT-1 cobraba como ITBIS el ISR retenido a un
 * profesional.
 *
 * Caso: honorarios de 10,000 + ITBIS 1,800. Se le retiene el 30% del ITBIS
 * (540) y el 10% de ISR (1,000). Al profesional se le pagan 10,260.
 */

const TABLAS = [
  'public.tax_filings',
  'public.supplier_payments',
  'public.supplier_invoices',
  'public.suppliers',
  'public.companies',
]

let c: ClientePrueba
let proveedor: string

async function descargar606(periodo: string) {
  const url = `http://x/api/dgii/606?periodo=${periodo}&formato=txt&tenant=${c.slug}&rol=Contador`
  const r = await GET(new Request(url), { params: Promise.resolve({ reporte: '606' }) })
  return { status: r.status, cuerpo: await r.text() }
}

/** La linea del 606 de un NCF, partida en sus 23 campos. */
function linea(cuerpo: string, ncf: string): string[] {
  const l = cuerpo.split('\r\n').find((x) => x.split('|')[3] === ncf)
  if (!l) throw new Error(`No esta ${ncf} en:\n${cuerpo}`)
  return l.split('|')
}

beforeAll(async () => {
  // Sin `ar`: el IT-1 ya no lo exige (0129) y una oficina que solo compra
  // servicios tambien declara.
  c = await sembrarCliente({
    prefijo: 'accion-606',
    modulos: ['purchase-orders', 'ap', 'taxes'],
    roles: { Contador: { 'ap.*': true, 'taxes.*': true } },
  })
  await db()`
    insert into public.companies (tenant_id, legal_name, tax_id, is_default)
    values (${c.tenantId}, 'Oficina Contable SRL', '131000025', true)`
  const [s] = await db()<{ id: string }[]>`
    insert into public.suppliers (tenant_id, name, tax_id, payment_terms)
    values (${c.tenantId}, 'Lic. Juana Perez', '00112345678', 0) returning id`
  proveedor = s!.id
})

afterAll(async () => {
  await c.limpiar(TABLAS)
  await cerrarBase()
})

describe('Factura de proveedor completa -> 606 TXT con cada retencion en su columna', () => {
  let facturaId: string

  it('registra la factura con fecha, tipo de gasto e ITBIS e ISR retenidos por separado', async () => {
    const r = await registrarFactura(
      c.fd({
        supplierId: proveedor,
        supplierInvoiceNumber: 'H-0042',
        supplierNcf: 'B0100000321',
        issueDate: '2026-08-28',
        subtotal: '10000',
        tax: '1800',
        expenseType: '02',
        servicesAmount: '10000',
        itbisRetention: '540',
        isrRetention: '1000',
        isrRetentionType: '02',
      }),
    )
    expect(r).toEqual({ ok: true })

    const [f] = await db()<
      {
        id: string
        issue_date: string
        expense_type: string
        retention_amount: string
        isr_retained: string
        isr_retention_type: string
      }[]
    >`
      select id, issue_date::text, expense_type, retention_amount::text, isr_retained::text,
             isr_retention_type
      from public.supplier_invoices
      where tenant_id = ${c.tenantId} and supplier_invoice_number = 'H-0042'`
    facturaId = f!.id
    expect(f).toMatchObject({
      issue_date: '2026-08-28',
      expense_type: '02',
      retention_amount: '1540.00',
      isr_retained: '1000.00',
      isr_retention_type: '02',
    })
  })

  it('ISR retenido sin su tipo se rechaza con un mensaje que se entiende', async () => {
    const r = await registrarFactura(
      c.fd({
        supplierId: proveedor,
        supplierInvoiceNumber: 'H-0043',
        supplierNcf: 'B0100000322',
        issueDate: '2026-08-29',
        subtotal: '5000',
        tax: '900',
        expenseType: '02',
        isrRetention: '500',
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/tipo es la retencion de ISR/)
  })

  it('con NCF y sin tipo de gasto no entra: el 606 no la podria declarar', async () => {
    const r = await registrarFactura(
      c.fd({
        supplierId: proveedor,
        supplierInvoiceNumber: 'H-0044',
        supplierNcf: 'B0100000323',
        issueDate: '2026-08-29',
        subtotal: '5000',
        tax: '900',
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/tipo de gasto/)
  })

  it('el pago descuenta las dos retenciones: al proveedor le tocan 10,260', async () => {
    const r = await registrarPago(
      c.fd({ invoiceId: facturaId, amount: '10260', method: 'transfer', reference: 'TRF-1' }),
    )
    expect(r).toEqual({ ok: true })
  })

  it('el 606 de agosto sale y lleva ITBIS retenido e ISR retenido en sus columnas', async () => {
    const { status, cuerpo } = await descargar606('202608')
    expect(status).toBe(200)
    expect(cuerpo.split('\r\n')[0]).toBe('606|131000025|202608|1')

    const f = linea(cuerpo, 'B0100000321')
    expect(f).toHaveLength(23)
    expect(f[0]).toBe('00112345678') // cedula del proveedor
    expect(f[1]).toBe('2') // tipo de identificacion: cedula
    expect(f[2]).toBe('02') // tipo de gasto
    expect(f[5]).toBe('20260828') // fecha del comprobante: la de la factura, no la de hoy
    expect(f[6]).toBe(fechaFiscal(new Date()).replace(/-/g, '')) // fecha de pago, en RD
    expect(f[7]).toBe('10000.00') // servicios
    expect(f[9]).toBe('10000.00') // total facturado
    expect(f[10]).toBe('1800.00') // ITBIS facturado
    expect(f[11]).toBe('540.00') // ITBIS retenido: SOLO el ITBIS
    expect(f[14]).toBe('1800.00') // ITBIS por adelantar
    expect(f[16]).toBe('02') // tipo de retencion ISR
    expect(f[17]).toBe('1000.00') // retencion de renta
    expect(f[22]).toBe('02') // forma de pago: transferencia
  })

  it('el IT-1 de agosto suma los 540 de ITBIS retenido, no los 1,540', async () => {
    const r = await cerrarLiquidacion(c.fd({ period: '202608' }))
    expect(r).toEqual({ ok: true })
    const [f] = await db()<
      { itbis_paid: string; itbis_retained: string; amount_due: string; credit_forward: string }[]
    >`
      select itbis_paid::text, itbis_retained::text, amount_due::text, credit_forward::text
      from public.tax_filings
      where tenant_id = ${c.tenantId} and form = 'IT-1' and period = '202608'`
    // 0 cobrado + 540 retenido - 1,800 adelantado = -1,260: saldo a favor.
    expect(f).toEqual({
      itbis_paid: '1800.00',
      itbis_retained: '540.00',
      amount_due: '0.00',
      credit_forward: '1260.00',
    })
  })
})

describe('Una factura vieja sin clasificar se clasifica desde su ficha', () => {
  let vieja: string

  beforeAll(async () => {
    // Como las dejaba /pagar antes de la 0129: sin tipo de gasto y con
    // toda la retencion en un campo.
    const [f] = await db()<{ id: string }[]>`
      insert into public.supplier_invoices
        (tenant_id, supplier_id, supplier_invoice_number, supplier_ncf, issue_date, due_date,
         subtotal, tax, retention_amount, total)
      values (${c.tenantId}, ${proveedor}, 'H-0007', 'B0100000307', '2026-07-15', '2026-07-15',
              8000, 1440, 800, 9440)
      returning id`
    vieja = f!.id
    await db()`
      insert into public.supplier_payments (tenant_id, invoice_id, amount, method, paid_at)
      values (${c.tenantId}, ${vieja}, 8640, 'cash', '2026-07-20 10:00-04')`
  })

  it('sin clasificar, el TXT se niega y nombra el NCF', async () => {
    const { status, cuerpo } = await descargar606('202607')
    expect(status).toBe(409)
    expect(cuerpo).toMatch(/B0100000307/)
  })

  it('clasificada -los 800 eran ISR- el 606 sale con 0 de ITBIS retenido y 800 de renta', async () => {
    const r = await clasificarFactura(
      c.fd({
        invoiceId: vieja,
        expenseType: '02',
        servicesAmount: '8000',
        isrRetention: '800',
        isrRetentionType: '02',
      }),
    )
    expect(r).toEqual({ ok: true })

    const { status, cuerpo } = await descargar606('202607')
    expect(status).toBe(200)
    const f = linea(cuerpo, 'B0100000307')
    expect(f[11]).toBe('') // ITBIS retenido: cero se omite
    expect(f[16]).toBe('02')
    expect(f[17]).toBe('800.00')
  })

  it('no deja declarar como ISR mas de lo que se retuvo', async () => {
    const r = await clasificarFactura(
      c.fd({ invoiceId: vieja, expenseType: '02', isrRetention: '900', isrRetentionType: '02' }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ISR retenido no puede pasar/)
  })
})
