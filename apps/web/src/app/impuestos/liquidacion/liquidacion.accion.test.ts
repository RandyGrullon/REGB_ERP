import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { cerrarLiquidacion, cerrarLiquidacionForm } from './actions'

/**
 * cerrarLiquidacion() llamada DE VERDAD, contra la base de pruebas.
 *
 * supabase/tests/taxes.test.ts prueba la tabla y registrar_declaracion();
 * lo que ninguna prueba fijaba era la ACCION: que sumas hace antes de
 * llamar a la funcion. Y ahi estan los tres errores que cuestan una multa
 * o dinero y que el IT-1 no delata porque cuadra consigo mismo:
 *
 *  1. Ventas SIN NCF: el 607 no las trae, el IT-1 si tiene que llevarlas.
 *  2. ITBIS retenido a proveedores: SUMA a lo que se paga, no resta.
 *  3. Saltarse un mes: el saldo a favor se arrastra de uno en uno.
 *
 * Cada caso se comprobo rompiendo a proposito ese pedazo de la accion y
 * viendo la prueba en rojo antes de restaurarla.
 */

const TABLAS = [
  'public.tax_filings',
  'public.pos_sales',
  'public.pos_shifts',
  'public.warehouses',
  'public.customer_invoices',
  'public.supplier_invoices',
  'public.customers',
  'public.suppliers',
]

const CONTADOR = { 'taxes.*': true, 'ar.*': true, 'ap.*': true }
// Ve impuestos y todo lo demas, pero no puede cerrar. La negacion
// explicita gana sobre el comodin: es la forma en que un dueño le quita
// a alguien solo esa accion.
const AUXILIAR = { 'taxes.*': true, 'taxes.filing.close': false, 'ar.*': true, 'ap.*': true }

interface Fila {
  period: string
  status: string
  itbis_charged: string
  itbis_paid: string
  itbis_withheld: string
  itbis_retained: string
  previous_credit: string
  amount_due: string
  credit_forward: string
}

async function declaracion(tenantId: string, period: string): Promise<Fila | undefined> {
  const [f] = await db()<Fila[]>`
    select period, status,
           itbis_charged::text, itbis_paid::text, itbis_withheld::text,
           itbis_retained::text, previous_credit::text,
           amount_due::text, credit_forward::text
    from public.tax_filings
    where tenant_id = ${tenantId} and form = 'IT-1' and period = ${period}`
  return f
}

async function cliente(tenantId: string): Promise<string> {
  const [c] = await db()<{ id: string }[]>`
    insert into public.customers (tenant_id, name, tax_id)
    values (${tenantId}, 'Colmado La Esquina', '101234567') returning id`
  return c!.id
}

async function factura(
  tenantId: string,
  customerId: string,
  f: { numero: string; fecha: string; itbis: string; ncf: string | null; anulada?: boolean },
): Promise<void> {
  const base = (Number(f.itbis) / 0.18).toFixed(2)
  const total = (Number(base) + Number(f.itbis)).toFixed(2)
  await db()`
    insert into public.customer_invoices
      (tenant_id, number, customer_id, issue_date, due_date, subtotal, tax, total,
       status, void_reason, ncf, ncf_type)
    values (${tenantId}, ${f.numero}, ${customerId}, ${f.fecha}::date, ${f.fecha}::date,
            ${base}::numeric, ${f.itbis}::numeric, ${total}::numeric,
            ${f.anulada ? 'void' : 'open'}, ${f.anulada ? 'Error de digitacion' : null},
            ${f.ncf}, ${f.ncf ? 'B01' : null})`
}

afterAll(async () => {
  await cerrarBase()
})

// ─────────────────────────────────────────────────────────────────────────
describe('Ventas sin NCF entran en el ITBIS cobrado', () => {
  let c: ClientePrueba

  beforeAll(async () => {
    // `pos` encendido: pos_sales vive bajo la RLS de la caja y, apagada,
    // la venta de mostrador no se ve -ni aqui ni en el 607-.
    c = await sembrarCliente({
      modulos: ['taxes', 'ar', 'ap', 'pos'],
      roles: { Contador: CONTADOR },
    })
    const cli = await cliente(c.tenantId)
    // Con NCF: la ve el 607.
    await factura(c.tenantId, cli, {
      numero: 'F-0001',
      fecha: '2024-03-05',
      itbis: '1800.00',
      ncf: 'B0100000001',
    })
    // Sin NCF: el colmado que vende antes de tener rango autorizado.
    await factura(c.tenantId, cli, {
      numero: 'F-0002',
      fecha: '2024-03-12',
      itbis: '360.00',
      ncf: null,
    })
    // Sin NCF pero anulada: no se cobro, no se declara.
    await factura(c.tenantId, cli, {
      numero: 'F-0003',
      fecha: '2024-03-20',
      itbis: '999.00',
      ncf: null,
      anulada: true,
    })
    // Sin NCF de OTRO mes: no es de este periodo.
    await factura(c.tenantId, cli, {
      numero: 'F-0004',
      fecha: '2024-04-01',
      itbis: '50.00',
      ncf: null,
    })

    // La caja: el mismo hueco, por el otro lado de la union. Una venta sin
    // NCF que cuenta, una anulada que no.
    const [alm] = await db()<{ id: string }[]>`
      insert into public.warehouses (tenant_id, name, code, is_default)
      values (${c.tenantId}, 'Tienda principal', 'PRI', true) returning id`
    const [turno] = await db()<{ id: string }[]>`
      insert into public.pos_shifts (tenant_id, warehouse_id, opening_float, opened_at)
      values (${c.tenantId}, ${alm!.id}, 1000.00, '2024-03-08 08:00-04') returning id`
    await db()`
      insert into public.pos_sales
        (tenant_id, shift_id, number, subtotal, tax, total, created_at, sold_at)
      values (${c.tenantId}, ${turno!.id}, 'T-0001', 500.00, 90.00, 590.00,
              '2024-03-08 10:15-04', '2024-03-08 10:15-04')`
    await db()`
      insert into public.pos_sales
        (tenant_id, shift_id, number, subtotal, tax, total, voided, void_reason, created_at, sold_at)
      values (${c.tenantId}, ${turno!.id}, 'T-0002', 1000.00, 180.00, 1180.00, true,
              'Cliente se arrepintio', '2024-03-08 11:00-04', '2024-03-08 11:00-04')`
  })

  afterAll(async () => {
    await c.limpiar(TABLAS)
  })

  it('cierra y declara 1800 del 607 + 360 factura sin NCF + 90 caja sin NCF = 2250.00', async () => {
    const r = await cerrarLiquidacion(c.fd({ period: '202403' }))
    expect(r).toEqual({ ok: true })

    const f = await declaracion(c.tenantId, '202403')
    expect(f).toMatchObject({
      status: 'filed',
      itbis_charged: '2250.00',
      itbis_paid: '0.00',
      amount_due: '2250.00',
      credit_forward: '0.00',
    })
  })

  it('el mismo periodo no se cierra dos veces', async () => {
    const r = await cerrarLiquidacion(c.fd({ period: '202403' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ya esta cerrado/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('ITBIS retenido a proveedores SUMA', () => {
  let c: ClientePrueba

  beforeAll(async () => {
    c = await sembrarCliente({ modulos: ['taxes', 'ar', 'ap'], roles: { Contador: CONTADOR } })
    const cli = await cliente(c.tenantId)
    await factura(c.tenantId, cli, {
      numero: 'F-0001',
      fecha: '2024-05-10',
      itbis: '3600.00',
      ncf: 'B0100000001',
    })
    const [s] = await db()<{ id: string }[]>`
      insert into public.suppliers (tenant_id, name, tax_id)
      values (${c.tenantId}, 'Servicios Tecnicos del Cibao SRL', '131234567') returning id`
    // Servicio de 10,000 + ITBIS 1,800. Le retengo el 30% del ITBIS (540):
    // al proveedor le pago 1,260 de ITBIS, los 540 se los debo a la DGII.
    await db()`
      insert into public.supplier_invoices
        (tenant_id, supplier_id, supplier_invoice_number, supplier_ncf, issue_date, due_date,
         subtotal, services_amount, tax, retention_amount, isr_retained, total, expense_type)
      values (${c.tenantId}, ${s!.id}, 'P-778', 'B0100000555', '2024-05-03', '2024-06-02',
              10000.00, 10000.00, 1800.00, 540.00, 0, 11800.00, '02')`
  })

  afterAll(async () => {
    await c.limpiar(TABLAS)
  })

  it('3600 cobrado + 540 retenido - 1800 adelantado - 100 que me retuvieron = 2240.00', async () => {
    const r = await cerrarLiquidacion(c.fd({ period: '202405', itbisWithheld: '100.00' }))
    expect(r).toEqual({ ok: true })

    const f = await declaracion(c.tenantId, '202405')
    expect(f).toMatchObject({
      itbis_charged: '3600.00',
      itbis_paid: '1800.00',
      itbis_withheld: '100.00',
      itbis_retained: '540.00',
      previous_credit: '0.00',
      amount_due: '2240.00',
      credit_forward: '0.00',
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('No deja cerrar si falta el mes inmediatamente anterior', () => {
  let c: ClientePrueba

  beforeAll(async () => {
    c = await sembrarCliente({ modulos: ['taxes', 'ar', 'ap'], roles: { Contador: CONTADOR } })
    const [s] = await db()<{ id: string }[]>`
      insert into public.suppliers (tenant_id, name, tax_id)
      values (${c.tenantId}, 'Almacenes del Norte SRL', '130987654') returning id`
    // Enero: solo compras, queda un saldo a favor de 900 que arrastrar.
    await db()`
      insert into public.supplier_invoices
        (tenant_id, supplier_id, supplier_invoice_number, supplier_ncf, issue_date, due_date,
         subtotal, tax, total, expense_type)
      values (${c.tenantId}, ${s!.id}, 'P-1', 'B0100000900', '2024-01-15', '2024-02-15',
              5000.00, 900.00, 5900.00, '09')`
  })

  afterAll(async () => {
    await c.limpiar(TABLAS)
  })

  it('enero cierra con 900.00 a favor', async () => {
    expect(await cerrarLiquidacion(c.fd({ period: '202401' }))).toEqual({ ok: true })
    expect(await declaracion(c.tenantId, '202401')).toMatchObject({
      amount_due: '0.00',
      credit_forward: '900.00',
    })
  })

  it('marzo con febrero abierto: se niega, nombra febrero y no escribe nada', async () => {
    const r = await cerrarLiquidacion(c.fd({ period: '202403' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Falta cerrar febrero de 2024/)
    expect(await declaracion(c.tenantId, '202403')).toBeUndefined()
  })

  it('cerrado febrero, marzo ya cierra y el saldo de enero se consume UNA vez', async () => {
    expect(await cerrarLiquidacion(c.fd({ period: '202402' }))).toEqual({ ok: true })
    expect(await declaracion(c.tenantId, '202402')).toMatchObject({
      previous_credit: '900.00',
      credit_forward: '900.00',
    })
    expect(await cerrarLiquidacion(c.fd({ period: '202403' }))).toEqual({ ok: true })
    expect(await declaracion(c.tenantId, '202403')).toMatchObject({
      previous_credit: '900.00',
      credit_forward: '900.00',
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Guardas de la accion', () => {
  let c: ClientePrueba

  beforeAll(async () => {
    c = await sembrarCliente({
      // `pos` encendido: la venta de la noche del 30 es de caja.
      modulos: ['taxes', 'ar', 'ap', 'pos'],
      roles: { Contador: CONTADOR, Auxiliar: AUXILIAR },
    })
  })

  afterAll(async () => {
    await c.limpiar(TABLAS)
  })

  it('un rol sin taxes.filing.close no cierra, aunque llame directo a la accion', async () => {
    const r = await cerrarLiquidacion(c.fd({ period: '202406' }, 'Auxiliar'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/denegado "taxes.filing.close"/)
    expect(await declaracion(c.tenantId, '202406')).toBeUndefined()
  })

  it('con Cuentas por cobrar apagado y facturas en el periodo se niega: declararia de menos', async () => {
    // Desde la 0129 no se exige `ar` -un colmado con solo caja tambien
    // declara-: lo que se niega es cerrar cuando HAY ventas del periodo que
    // un modulo apagado esconde. Por eso la prueba siembra una factura.
    const cli = await cliente(c.tenantId)
    await factura(c.tenantId, cli, {
      numero: 'F-0601',
      fecha: '2024-06-12',
      itbis: '180.00',
      ncf: 'B0100000601',
    })
    await c.modulo('ar', false)
    try {
      const r = await cerrarLiquidacion(c.fd({ period: '202406' }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/modulo que esta apagado \(Cuentas por cobrar\)/)
      expect(await declaracion(c.tenantId, '202406')).toBeUndefined()
    } finally {
      await c.modulo('ar', true)
    }
  })

  it('una venta de caja de la noche del ultimo dia es de ese mes, aunque sincronice al otro', async () => {
    // 30 de junio a las 9:30 p. m. en RD = 1 de julio en UTC. Offline: llego
    // al servidor el 1 de julio por la mañana.
    const [alm] = await db()<{ id: string }[]>`
      insert into public.warehouses (tenant_id, name, code, is_default)
      values (${c.tenantId}, 'Caja noche', 'NOC', true) returning id`
    const [turno] = await db()<{ id: string }[]>`
      insert into public.pos_shifts (tenant_id, warehouse_id, opening_float, opened_at)
      values (${c.tenantId}, ${alm!.id}, 0, '2024-06-30 08:00-04') returning id`
    await db()`
      insert into public.pos_sales
        (tenant_id, shift_id, number, subtotal, tax, total, created_at, sold_at)
      values (${c.tenantId}, ${turno!.id}, 'T-NOCHE', 100.00, 18.00, 118.00,
              '2024-07-01 08:00-04', '2024-06-30 21:30-04')`

    expect(await cerrarLiquidacion(c.fd({ period: '202406' }))).toEqual({ ok: true })
    // 180 de la factura con NCF + 18 del ticket sin NCF de la noche del 30.
    expect(await declaracion(c.tenantId, '202406')).toMatchObject({ itbis_charged: '198.00' })
  })

  it('un tenant que no existe no pasa de actionCtx', async () => {
    const f = c.fd({ period: '202406' })
    f.set('tenant', 'no-existe-00000000')
    expect(await cerrarLiquidacion(f)).toEqual({ ok: false, error: 'Sesion no valida.' })
  })

  it('la version de formulario deja el aviso en la cookie', async () => {
    tarro.delete(COOKIE_AVISO)
    await cerrarLiquidacionForm(c.fd({ period: '2024-06' }))
    const aviso = JSON.parse(tarro.get(COOKIE_AVISO)?.value ?? '{}') as {
      tipo?: string
      texto?: string
    }
    expect(aviso).toEqual({ tipo: 'error', texto: 'El periodo va como AAAAMM.' })
  })
})
