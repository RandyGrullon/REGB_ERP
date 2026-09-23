import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { ajustarSecuencia, registrarSecuencia } from '@/app/cobrar/ncf/actions'
import { cerrarLiquidacion } from '@/app/impuestos/liquidacion/actions'
import { GET } from '@/app/api/dgii/[reporte]/route'
import { cobrarVenta } from './actions'

/**
 * El colmado que solo tiene CAJA, de punta a punta con las acciones reales.
 *
 * Hallazgos 1 y 4 del analisis de flujo: con solo `pos`, el colmado no
 * podia cargar su autorizacion de NCF (/cobrar/ncf era de `ar`), ni bajar
 * su 607, ni cerrar el IT-1 -la liquidacion exigia `ar`-. Y el 607 que si
 * salia (en quien tenia `ar`) declaraba el ticket con descuento por debajo
 * de lo cobrado y la venta de la noche del 30 en el mes siguiente.
 *
 * Cada caso se vio en rojo rompiendo a proposito ese pedazo del arreglo.
 */

const TABLAS = [
  'public.tax_filings',
  'public.pos_payments',
  'public.pos_sale_lines',
  'public.pos_sales',
  'public.pos_shifts',
  'public.ncf_sequences',
  'public.warehouses',
  'public.products',
  'public.companies',
]

const DUENO = { 'pos.*': true, 'products.*': true, 'taxes.*': true }
const CAJERO = { 'pos.view': true, 'pos.sell': true, 'pos.discount': true }

let c: ClientePrueba
let turno: string
let producto: string

/** GET de la ruta de descarga, como lo hace el navegador (modo demostracion). */
async function descargar(reporte: string, periodo: string, rol = 'Dueno', formato = 'txt') {
  const url = `http://x/api/dgii/${reporte}?periodo=${periodo}&formato=${formato}&tenant=${c.slug}&rol=${rol}`
  const r = await GET(new Request(url), { params: Promise.resolve({ reporte }) })
  return { status: r.status, cuerpo: await r.text() }
}

beforeAll(async () => {
  // Sin `ar` ni `sales-orders`: el colmado del hallazgo 1.
  c = await sembrarCliente({
    prefijo: 'accion-colmado',
    nombre: 'Colmado La Esperanza',
    modulos: ['products', 'pos', 'taxes'],
    roles: { Dueno: DUENO, Cajero: CAJERO },
  })
  await db()`
    insert into public.companies (tenant_id, legal_name, tax_id, is_default)
    values (${c.tenantId}, 'Colmado La Esperanza SRL', '131000017', true)`
  const [w] = await db()<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${c.tenantId}, 'Mostrador', 'MOS', true) returning id`
  const [t] = await db()<{ id: string }[]>`
    insert into public.pos_shifts (tenant_id, warehouse_id, opening_float, status)
    values (${c.tenantId}, ${w!.id}, 1000, 'open') returning id`
  turno = t!.id
  // Sin control de existencias: el colmado no tiene `inventory`.
  const [p] = await db()<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, price, cost, tax_rate, tracks_stock)
    values (${c.tenantId}, 'LECHE-1', 'Leche en polvo 2.5 kg', 1000, 700, 0.18, false)
    returning id`
  producto = p!.id
})

afterAll(async () => {
  await c.limpiar(TABLAS)
  await cerrarBase()
})

describe('Colmado solo con caja: NCF, 607 e IT-1 sin Por cobrar', () => {
  it('el dueño carga su autorizacion B02 desde la caja', async () => {
    const r = await registrarSecuencia(
      c.fd({
        ncfType: 'B02',
        rangeFrom: '1',
        rangeTo: '500',
        expiresOn: '2027-12-31',
        authRef: 'AUT-COL-1',
      }),
    )
    expect(r).toEqual({ ok: true })
  })

  it('el cajero no puede cargar ni corregir secuencias', async () => {
    const r = await registrarSecuencia(
      c.fd({ ncfType: 'B01', rangeFrom: '1', rangeTo: '10', expiresOn: '2027-12-31' }, 'Cajero'),
    )
    expect(r.ok).toBe(false)
  })

  it('un rango que pisa al cargado vuelve como mensaje, no como pantalla rota', async () => {
    const r = await registrarSecuencia(
      c.fd({ ncfType: 'B02', rangeFrom: '400', rangeTo: '900', expiresOn: '2027-12-31' }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/se cruza/)
  })

  it('el dueño corrige el vencimiento con motivo; sin motivo no', async () => {
    const [s] = await db()<{ id: string }[]>`
      select id from public.ncf_sequences where tenant_id = ${c.tenantId} and ncf_type = 'B02'`
    const sin = await ajustarSecuencia(
      c.fd({ id: s!.id, accion: 'vencimiento', expiresOn: '2028-01-31', reason: '' }),
    )
    expect(sin.ok).toBe(false)

    const r = await ajustarSecuencia(
      c.fd({
        id: s!.id,
        accion: 'vencimiento',
        expiresOn: '2028-01-31',
        reason: 'Mal digitado al cargar',
      }),
    )
    expect(r).toEqual({ ok: true })
    const [d] = await db()<{ expires_on: string; next_number: number }[]>`
      select expires_on::text, next_number from public.ncf_sequences where id = ${s!.id}`
    expect(d).toEqual({ expires_on: '2028-01-31', next_number: 1 })

    const cajero = await ajustarSecuencia(
      c.fd({ id: s!.id, accion: 'baja', reason: 'la apago yo' }, 'Cajero'),
    )
    expect(cajero.ok).toBe(false)
  })

  it('una venta de 1,000 con 10% a las 9 p. m. del 30 lleva NCF', async () => {
    const r = await cobrarVenta(
      c.fd(
        {
          shiftId: turno,
          soldAt: '2026-09-30T21:00:00-04:00',
          cart: JSON.stringify([{ productId: producto, qty: 1, discountPct: 10 }]),
          payments: JSON.stringify([{ method: 'cash', amount: 1062 }]),
        },
        'Cajero',
      ),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.venta).toMatchObject({ ncf: 'B0200000001', total: 1062 })
  })

  it('el 607 TXT sale desde la caja: septiembre, dia 30, 900 de base y 162 de ITBIS', async () => {
    const { status, cuerpo } = await descargar('607', '202609')
    expect(status).toBe(200)
    const [cabecera, detalle] = cuerpo.split('\r\n')
    expect(cabecera).toBe('607|131000017|202609|1')
    const f = detalle!.split('|')
    expect(f[2]).toBe('B0200000001') // NCF
    expect(f[5]).toBe('20260930') // fecha del comprobante
    expect(f[7]).toBe('900.00') // monto facturado: el descuento se resta UNA vez
    expect(f[8]).toBe('162.00') // ITBIS facturado
    expect(f[16]).toBe('1062.00') // efectivo
  })

  it('octubre no trae la venta de la noche del 30', async () => {
    const { status, cuerpo } = await descargar('607', '202610')
    expect(status).toBe(200)
    expect(cuerpo.split('\r\n')[0]).toBe('607|131000017|202610|0')
  })

  it('el 608 tambien se baja con solo caja', async () => {
    const { status } = await descargar('608', '202609')
    expect(status).toBe(200)
  })

  it('el cajero no descarga reportes fiscales', async () => {
    const { status } = await descargar('607', '202609', 'Cajero')
    expect(status).toBe(403)
  })

  it('el IT-1 de septiembre cierra sin `ar` y declara los 162 de ITBIS', async () => {
    const r = await cerrarLiquidacion(c.fd({ period: '202609' }))
    expect(r).toEqual({ ok: true })
    const [f] = await db()<{ itbis_charged: string; amount_due: string }[]>`
      select itbis_charged::text, amount_due::text from public.tax_filings
      where tenant_id = ${c.tenantId} and form = 'IT-1' and period = '202609'`
    expect(f).toEqual({ itbis_charged: '162.00', amount_due: '162.00' })
  })
})
