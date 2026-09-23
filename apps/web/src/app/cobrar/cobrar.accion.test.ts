import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import {
  MODULOS_CREDITO,
  almacen,
  cliente,
  estadoFactura,
  factura,
  limpiarCredito,
  mora,
  pedido,
  producto,
  proximoNcf,
  saldo,
  secuencia,
} from '@/test/venta-a-credito'
import { facturarPedido, registrarCobro } from './actions'

/**
 * Por cobrar llamado DE VERDAD: facturar, cobrar, reversar y nota de
 * credito, contra la base de pruebas.
 *
 * Lo que fija, del analisis de flujo del 23 sep 2026 (flujo 3, hallazgos
 * 2 y 3):
 *
 *  1. Facturar sin secuencia B01 tiraba la pantalla: `assign_ncf` lanza y
 *     la accion no lo atrapaba.
 *  2. Un RNC invalido caia en B02 sin decir nada.
 *  3. El cobro se validaba contra el total SIN la mora: cobrar el saldo
 *     que la propia pantalla proponia daba "Solo quedan 11564.00", y
 *     cobrar el capital marcaba pagada una factura con mora pendiente.
 *  4. Un cobro mal digitado no tenia correccion.
 *
 * Cada caso se vio en rojo contra la accion vieja y otra vez rompiendo el
 * arreglo a proposito.
 */

const DUENO = { '*': true }
// Cobra y factura, pero no reversa ni autoriza credito.
const COBRADOR = {
  'ar.view': true,
  'ar.invoice.create': true,
  'ar.payment.record': true,
  'sales-orders.view': true,
}

// RNC de la propia DGII: verificado con el digito del modulo 11.
const RNC_VALIDO = '401007551'
// El de Ferreteria El Martillo en la demo: el digito no cuadra.
const RNC_MALO = '131223345'

let c: ClientePrueba
let wh: string
let prod: string

async function facturaDelPedido(orderId: string) {
  const [f] = await db()<
    { id: string; ncf: string | null; ncf_type: string | null; buyer_tax_id: string | null }[]
  >`
    select id, ncf, ncf_type, buyer_tax_id from public.customer_invoices
    where tenant_id = ${c.tenantId} and source_type = 'sales_order' and source_id = ${orderId}`
  return f
}

async function entregado(customerId: string): Promise<string> {
  return pedido(c.tenantId, {
    customerId,
    warehouseId: wh,
    productId: prod,
    cantidad: 5,
    precio: 1000,
    estado: 'delivered',
  })
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-cobrar',
    nombre: 'Tienda de Electronica de Prueba SRL',
    modulos: MODULOS_CREDITO,
    roles: { Dueno: DUENO, Cobrador: COBRADOR },
  })
  wh = await almacen(c.tenantId)
  prod = await producto(c.tenantId, wh, { sku: 'TV-55', precio: 1000, existencia: 200 })
})

afterAll(async () => {
  await limpiarCredito(c.limpiar)
  await cerrarBase()
})

// ─────────────────────────────────────────────────────────────────────────
describe('facturarPedido: sin secuencia B01 no revienta', () => {
  it('devuelve un error legible, sin excepcion, y no crea la factura', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Cliente con RNC SRL', rnc: RNC_VALIDO })
    const ped = await entregado(cli)

    const p = facturarPedido(c.fd({ orderId: ped }, 'Cobrador'))
    await expect(p).resolves.toMatchObject({ ok: false })
    const r = await p
    if (r.ok) return
    expect(r.error).toMatch(/B01/)
    expect(r.error).toMatch(/secuencia/i)
    expect(await facturaDelPedido(ped)).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('facturarPedido: el comprobante se decide a la vista', () => {
  beforeAll(async () => {
    await secuencia(c.tenantId, 'B01')
    await secuencia(c.tenantId, 'B02')
  })

  it('RNC invalido -> error que lo dice; ni B02 en silencio ni NCF quemado', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Ferreteria El Martillo SRL', rnc: RNC_MALO })
    const ped = await entregado(cli)
    const b01 = await proximoNcf(c.tenantId, 'B01')
    const b02 = await proximoNcf(c.tenantId, 'B02')

    const r = await facturarPedido(c.fd({ orderId: ped }, 'Cobrador'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/RNC/)
    expect(r.error).toMatch(/131-22334-5/)
    expect(await facturaDelPedido(ped)).toBeUndefined()
    expect(await proximoNcf(c.tenantId, 'B01')).toBe(b01)
    expect(await proximoNcf(c.tenantId, 'B02')).toBe(b02)
  })

  it('si se pide consumo (B02) a proposito, se factura B02 y el RNC malo no viaja al 607', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Taller Consumo SRL', rnc: RNC_MALO })
    const ped = await entregado(cli)
    const r = await facturarPedido(c.fd({ orderId: ped, ncfType: 'B02' }, 'Cobrador'))
    expect(r).toEqual({ ok: true })
    const f = await facturaDelPedido(ped)
    expect(f!.ncf_type).toBe('B02')
    expect(f!.buyer_tax_id).toBeNull()
  })

  it('pedir credito fiscal (B01) para un cliente sin RNC -> error, no B02', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Consumidor Final' })
    const ped = await entregado(cli)
    const r = await facturarPedido(c.fd({ orderId: ped, ncfType: 'B01' }, 'Cobrador'))
    expect(r.ok).toBe(false)
    expect(await facturaDelPedido(ped)).toBeUndefined()
  })

  it('RNC valido -> B01, con el RNC en digitos', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Oficina Valida SRL', rnc: '401-00755-1' })
    const ped = await entregado(cli)
    const r = await facturarPedido(c.fd({ orderId: ped }, 'Cobrador'))
    expect(r).toEqual({ ok: true })
    const f = await facturaDelPedido(ped)
    expect(f!.ncf_type).toBe('B01')
    expect(f!.ncf).toMatch(/^B01\d{8}$/)
    expect(f!.buyer_tax_id).toBe(RNC_VALIDO)
  })

  it('sin RNC y sin pedir nada -> consumo (B02), como siempre', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Juan Perez' })
    const ped = await entregado(cli)
    expect(await facturarPedido(c.fd({ orderId: ped }, 'Cobrador'))).toEqual({ ok: true })
    expect((await facturaDelPedido(ped))!.ncf_type).toBe('B02')
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('facturarPedido: el credito tambien se mira al facturar', () => {
  it('cliente con 96 dias vencida y pedido confirmado antes de la regla -> bloqueado', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Moroso Viejo SRL' })
    await factura(c.tenantId, cli, { numero: 'FA-MOR-1', total: 5000, diasVencida: 96 })
    const ped = await entregado(cli)
    const r = await facturarPedido(c.fd({ orderId: ped }, 'Cobrador'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/96 dias/)
    expect(await facturaDelPedido(ped)).toBeUndefined()

    // El dueno autoriza al facturar: pasa y queda escrito en esa etapa.
    const ok = await facturarPedido(
      c.fd(
        { orderId: ped, creditOverride: '1', overrideReason: 'Mercancia ya entregada, se cobra el lunes' },
        'Dueno',
      ),
    )
    expect(ok).toEqual({ ok: true })
    const [ex] = await db()<{ stage: string }[]>`
      select stage from public.credit_overrides where tenant_id = ${c.tenantId} and order_id = ${ped}`
    expect(ex!.stage).toBe('invoice')
  })

  it('la excepcion autorizada al confirmar cubre la factura de ESE pedido', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Autorizado Antes SRL' })
    await factura(c.tenantId, cli, { numero: 'FA-MOR-2', total: 5000, diasVencida: 96 })
    const ped = await entregado(cli)
    await db()`
      insert into public.credit_overrides
        (tenant_id, customer_id, order_id, stage, blocks, document_total, exposure,
         oldest_overdue_days, overdue_block_days, reason)
      values (${c.tenantId}, ${cli}, ${ped}, 'confirm', array['overdue'], 5900, 5000,
              96, 30, 'Autorizado por el dueno al confirmar')`
    expect(await facturarPedido(c.fd({ orderId: ped }, 'Cobrador'))).toEqual({ ok: true })
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('registrarCobro: la mora se cobra', () => {
  let cli: string

  beforeAll(async () => {
    cli = await cliente(c.tenantId, { nombre: 'Cliente con Mora SRL' })
  })

  it('cobrar el saldo real (capital + mora) se acepta y la deja pagada en cero', async () => {
    const inv = await factura(c.tenantId, cli, { numero: 'FA-MORA-1', total: 11564, diasVencida: 96 })
    await mora(c.tenantId, inv, 500, 96)
    expect(await saldo(inv)).toBe(12064)

    const r = await registrarCobro(
      c.fd({ invoiceId: inv, amount: '12064.00', method: 'cash' }, 'Cobrador'),
    )
    expect(r).toEqual({ ok: true })
    expect(await saldo(inv)).toBe(0)
    expect(await estadoFactura(inv)).toBe('paid')
  })

  it('cobrar solo el capital deja la mora pendiente y la factura NO queda pagada', async () => {
    const inv = await factura(c.tenantId, cli, { numero: 'FA-MORA-2', total: 11564, diasVencida: 96 })
    await mora(c.tenantId, inv, 500, 96)

    const r = await registrarCobro(
      c.fd({ invoiceId: inv, amount: '11564.00', method: 'transfer' }, 'Cobrador'),
    )
    expect(r).toEqual({ ok: true })
    expect(await saldo(inv)).toBe(500)
    expect(await estadoFactura(inv)).toBe('overdue')

    // Y la mora se puede cobrar despues.
    expect(
      await registrarCobro(c.fd({ invoiceId: inv, amount: '500', method: 'cash' }, 'Cobrador')),
    ).toEqual({ ok: true })
    expect(await estadoFactura(inv)).toBe('paid')
  })

  it('cobrar de mas se rechaza diciendo el saldo real, con la mora', async () => {
    const inv = await factura(c.tenantId, cli, { numero: 'FA-MORA-3', total: 11564, diasVencida: 96 })
    await mora(c.tenantId, inv, 500, 96)
    const r = await registrarCobro(
      c.fd({ invoiceId: inv, amount: '12065', method: 'cash' }, 'Cobrador'),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/12,064\.00/)
    expect(r.error).toMatch(/mora/)
  })

  it('un id roto no tira la pantalla', async () => {
    const p = registrarCobro(c.fd({ invoiceId: 'x', amount: '10' }, 'Cobrador'))
    await expect(p).resolves.toMatchObject({ ok: false })
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('reversarCobro: un cobro mal digitado se corrige sin borrar', () => {
  let cli: string

  async function cobros(invoiceId: string) {
    return db()<
      { amount: string; reversed_at: string | null; reversal_reason: string | null; reversed_by: string | null }[]
    >`
      select amount::text, reversed_at::text, reversal_reason, reversed_by::text
      from public.customer_payments where invoice_id = ${invoiceId} order by received_at`
  }

  async function ultimoCobro(invoiceId: string): Promise<string> {
    const [p] = await db()<{ id: string }[]>`
      select id from public.customer_payments where invoice_id = ${invoiceId}
      order by received_at desc limit 1`
    return p!.id
  }

  beforeAll(async () => {
    cli = await cliente(c.tenantId, { nombre: 'Cliente del Cobro Mal Digitado' })
  })

  it('5,000 en vez de 500: se reversa con motivo, el saldo vuelve y la fila se queda', async () => {
    const inv = await factura(c.tenantId, cli, { numero: 'FA-REV-1', total: 5000, diasVencida: -10 })
    await registrarCobro(c.fd({ invoiceId: inv, amount: '5000', method: 'cash' }, 'Cobrador'))
    expect(await estadoFactura(inv)).toBe('paid')

    const { reversarCobro } = await import('./actions')
    const pago = await ultimoCobro(inv)
    const r = await reversarCobro(
      c.fd({ paymentId: pago, reason: 'Se digito 5,000 y el cliente pago 500' }, 'Dueno'),
    )
    expect(r).toEqual({ ok: true })
    expect(await saldo(inv)).toBe(5000)
    expect(await estadoFactura(inv)).toBe('open')

    // Se registra el bueno.
    await registrarCobro(c.fd({ invoiceId: inv, amount: '500', method: 'cash' }, 'Cobrador'))
    expect(await saldo(inv)).toBe(4500)
    expect(await estadoFactura(inv)).toBe('partially_paid')

    const filas = await cobros(inv)
    expect(filas).toHaveLength(2)
    expect(filas[0]!.reversed_at).not.toBeNull()
    expect(filas[0]!.reversal_reason).toBe('Se digito 5,000 y el cliente pago 500')
    expect(filas[0]!.reversed_by).toBeTruthy()
    expect(filas[1]!.reversed_at).toBeNull()

    // La bitacora tiene el antes y el despues del reverso.
    const [log] = await db()<{ n: string }[]>`
      select count(*)::text as n from audit.log
      where tenant_id = ${c.tenantId} and entity = 'customer_payments' and action = 'update'
        and after ->> 'reversal_reason' = 'Se digito 5,000 y el cliente pago 500'`
    expect(Number(log!.n)).toBe(1)
    const [ev] = await db()<{ n: string }[]>`
      select count(*)::text as n from public.event_outbox
      where tenant_id = ${c.tenantId} and type = 'ar.payment.reversed'`
    expect(Number(ev!.n)).toBeGreaterThanOrEqual(1)
  })

  it('sin motivo no se reversa; dos veces tampoco', async () => {
    const inv = await factura(c.tenantId, cli, { numero: 'FA-REV-2', total: 1000, diasVencida: -10 })
    await registrarCobro(c.fd({ invoiceId: inv, amount: '1000', method: 'cash' }, 'Cobrador'))
    const { reversarCobro } = await import('./actions')
    const pago = await ultimoCobro(inv)

    expect((await reversarCobro(c.fd({ paymentId: pago, reason: '' }, 'Dueno'))).ok).toBe(false)
    expect(await reversarCobro(c.fd({ paymentId: pago, reason: 'Cheque devuelto' }, 'Dueno'))).toEqual({
      ok: true,
    })
    const otra = await reversarCobro(c.fd({ paymentId: pago, reason: 'Otra vez' }, 'Dueno'))
    expect(otra.ok).toBe(false)
    expect(await saldo(inv)).toBe(1000)
  })

  it('el cobrador registra cobros pero no los reversa', async () => {
    const inv = await factura(c.tenantId, cli, { numero: 'FA-REV-3', total: 1000, diasVencida: -10 })
    await registrarCobro(c.fd({ invoiceId: inv, amount: '1000', method: 'cash' }, 'Cobrador'))
    const { reversarCobro } = await import('./actions')
    const r = await reversarCobro(
      c.fd({ paymentId: await ultimoCobro(inv), reason: 'Me equivoque' }, 'Cobrador'),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/ar\.payment\.reverse/)
    expect(await saldo(inv)).toBe(0)
  })

  it('una factura cuyo unico cobro se reverso ya se puede anular', async () => {
    const inv = await factura(c.tenantId, cli, { numero: 'FA-REV-4', total: 1000, diasVencida: -10 })
    await registrarCobro(c.fd({ invoiceId: inv, amount: '1000', method: 'cash' }, 'Cobrador'))
    const { reversarCobro, anularFactura } = await import('./actions')
    const conCobro = await anularFactura(
      c.fd({ invoiceId: inv, reason: 'Factura duplicada', voidType: '4' }, 'Dueno'),
    )
    expect(conCobro.ok).toBe(false)

    await reversarCobro(c.fd({ paymentId: await ultimoCobro(inv), reason: 'Cobro duplicado' }, 'Dueno'))
    expect(
      await anularFactura(c.fd({ invoiceId: inv, reason: 'Factura duplicada', voidType: '4' }, 'Dueno')),
    ).toEqual({ ok: true })
    expect(await estadoFactura(inv)).toBe('void')
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('La factura guarda sus lineas y factura lo ENTREGADO', () => {
  it('pedido de 10 con 4 entregados: se facturan 4; luego las otras 6, en otra factura', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Cliente Entrega Parcial' })
    const ped = await pedido(c.tenantId, {
      customerId: cli,
      warehouseId: wh,
      productId: prod,
      cantidad: 10,
      precio: 1000,
      estado: 'confirmed',
    })
    await db()`update public.sales_order_lines set qty_delivered = 4 where order_id = ${ped}`
    await db()`update public.sales_orders set status = 'partially_delivered' where id = ${ped}`

    expect(await facturarPedido(c.fd({ orderId: ped, ncfType: 'B02' }, 'Cobrador'))).toEqual({ ok: true })
    const facturas = () =>
      db()<{ id: string; total: string; subtotal: string; tax: string }[]>`
        select id, total::text, subtotal::text, tax::text from public.customer_invoices
        where source_type = 'sales_order' and source_id = ${ped} order by created_at`
    let fs = await facturas()
    expect(fs).toHaveLength(1)
    expect(Number(fs[0]!.subtotal)).toBe(4000)
    expect(Number(fs[0]!.tax)).toBe(720)
    expect(Number(fs[0]!.total)).toBe(4720)

    const [linea] = await db()<{ qty: string; unit_price: string; description: string; line_total: string }[]>`
      select qty::text, unit_price::text, description, line_total::text
      from public.customer_invoice_lines where invoice_id = ${fs[0]!.id}`
    expect(Number(linea!.qty)).toBe(4)
    expect(Number(linea!.unit_price)).toBe(1000)
    expect(linea!.description).toBe('Producto TV-55')
    expect(Number(linea!.line_total)).toBe(4720)

    // Facturar otra vez sin entregar mas: no hay nada nuevo.
    const otra = await facturarPedido(c.fd({ orderId: ped, ncfType: 'B02' }, 'Cobrador'))
    expect(otra.ok).toBe(false)
    if (!otra.ok) expect(otra.error).toMatch(/ya esta facturado/)

    // Salen las otras 6: segunda factura por 6.
    await db()`update public.sales_order_lines set qty_delivered = 10 where order_id = ${ped}`
    expect(await facturarPedido(c.fd({ orderId: ped, ncfType: 'B02' }, 'Cobrador'))).toEqual({ ok: true })
    fs = await facturas()
    expect(fs.map((f) => Number(f.total))).toEqual([4720, 7080])
  })

  it('sin nada entregado no se factura', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Cliente Sin Entrega' })
    const ped = await pedido(c.tenantId, {
      customerId: cli,
      warehouseId: wh,
      productId: prod,
      cantidad: 3,
      precio: 1000,
      estado: 'confirmed',
    })
    const r = await facturarPedido(c.fd({ orderId: ped }, 'Cobrador'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/entregado, no lo pedido/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Nota de credito B04', () => {
  let cli: string

  async function facturaConLineas(cantidad: number): Promise<{ invoiceId: string; lineId: string }> {
    const ped = await entregado(cli)
    await db()`update public.sales_order_lines set qty_delivered = ${cantidad}, qty_ordered = ${cantidad}
               where order_id = ${ped}`
    const r = await facturarPedido(c.fd({ orderId: ped }, 'Cobrador'))
    expect(r).toEqual({ ok: true })
    const [f] = await db()<{ id: string; line: string }[]>`
      select i.id, (select id from public.customer_invoice_lines where invoice_id = i.id) as line
      from public.customer_invoices i
      where i.source_type = 'sales_order' and i.source_id = ${ped}`
    return { invoiceId: f!.id, lineId: f!.line }
  }

  async function existencia(): Promise<number> {
    const [s] = await db()<{ q: string }[]>`
      select qty_on_hand::text as q from public.stock_levels
      where tenant_id = ${c.tenantId} and product_id = ${prod} and warehouse_id = ${wh}`
    return Number(s!.q)
  }

  beforeAll(async () => {
    cli = await cliente(c.tenantId, { nombre: 'Cliente de Devoluciones SRL', rnc: RNC_VALIDO })
  })

  it('sin secuencia B04: error legible, ni nota ni saldo tocado', async () => {
    const { invoiceId, lineId } = await facturaConLineas(5)
    const { emitirNotaDeCredito } = await import('./actions')
    const r = await emitirNotaDeCredito(
      c.fd({ invoiceId, kind: 'return', reason: 'Devolvio 2 televisores', [`qty_${lineId}`]: '2' }, 'Dueno'),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/B04/)
    expect(await saldo(invoiceId)).toBe(5900)
  })

  it('devolucion de 2 de 5: B04 que modifica el NCF de la factura, saldo baja y el inventario vuelve', async () => {
    await secuencia(c.tenantId, 'B04')
    const { invoiceId, lineId } = await facturaConLineas(5)
    const antes = await existencia()
    const { emitirNotaDeCredito } = await import('./actions')
    const r = await emitirNotaDeCredito(
      c.fd(
        {
          invoiceId,
          kind: 'return',
          reason: 'Devolvio 2 televisores sin abrir',
          restock: '1',
          [`qty_${lineId}`]: '2',
        },
        'Dueno',
      ),
    )
    expect(r).toEqual({ ok: true })

    const [n] = await db()<
      { ncf: string; ncf_type: string; modified_ncf: string; total: string; tax: string; restocked: boolean }[]
    >`
      select ncf, ncf_type, modified_ncf, total::text, tax::text, restocked
      from public.customer_credit_notes where invoice_id = ${invoiceId}`
    const [inv] = await db()<{ ncf: string }[]>`select ncf from public.customer_invoices where id = ${invoiceId}`
    expect(n!.ncf).toMatch(/^B04\d{8}$/)
    expect(n!.ncf_type).toBe('B04')
    expect(n!.modified_ncf).toBe(inv!.ncf)
    expect(Number(n!.total)).toBe(2360)
    expect(Number(n!.tax)).toBe(360)
    expect(n!.restocked).toBe(true)

    expect(await saldo(invoiceId)).toBe(3540)
    expect(await existencia()).toBe(antes + 2)

    // No se devuelve mas de lo facturado: quedan 3.
    const demas = await emitirNotaDeCredito(
      c.fd({ invoiceId, kind: 'return', reason: 'Otra devolucion', [`qty_${lineId}`]: '4' }, 'Dueno'),
    )
    expect(demas.ok).toBe(false)
  })

  it('rebaja de monto: se separa el ITBIS y no pasa del saldo', async () => {
    const { invoiceId } = await facturaConLineas(1)
    const { emitirNotaDeCredito } = await import('./actions')
    expect(
      await emitirNotaDeCredito(
        c.fd({ invoiceId, kind: 'adjustment', reason: 'Descuento por rayon', amount: '118' }, 'Dueno'),
      ),
    ).toEqual({ ok: true })
    const [n] = await db()<{ subtotal: string; tax: string }[]>`
      select subtotal::text, tax::text from public.customer_credit_notes where invoice_id = ${invoiceId}`
    expect(Number(n!.subtotal)).toBe(100)
    expect(Number(n!.tax)).toBe(18)
    expect(await saldo(invoiceId)).toBe(1062)

    // Mas de lo que queda de la factura: rechazado.
    const demas = await emitirNotaDeCredito(
      c.fd({ invoiceId, kind: 'adjustment', reason: 'Otra rebaja', amount: '2000' }, 'Dueno'),
    )
    expect(demas.ok).toBe(false)
    if (!demas.ok) expect(demas.error).toMatch(/pasa de lo que queda/)
  })

  it('si el cliente ya pago, la nota no puede dejarle un saldo a favor que nadie devuelve', async () => {
    const { invoiceId } = await facturaConLineas(1)
    await registrarCobro(c.fd({ invoiceId, amount: '1000', method: 'cash' }, 'Cobrador'))
    const { emitirNotaDeCredito } = await import('./actions')
    const r = await emitirNotaDeCredito(
      c.fd({ invoiceId, kind: 'adjustment', reason: 'Rebaja tardia', amount: '500' }, 'Dueno'),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/saldo pendiente \(RD\$ 180\.00\)/)
    expect(await saldo(invoiceId)).toBe(180)
  })

  it('una factura con nota de credito no se anula', async () => {
    const { invoiceId } = await facturaConLineas(1)
    const { emitirNotaDeCredito, anularFactura } = await import('./actions')
    await emitirNotaDeCredito(
      c.fd({ invoiceId, kind: 'adjustment', reason: 'Rebaja acordada', amount: '100' }, 'Dueno'),
    )
    const r = await anularFactura(c.fd({ invoiceId, reason: 'Ya no', voidType: '4' }, 'Dueno'))
    expect(r.ok).toBe(false)
  })

  it('reponer con inventario apagado: lo dice la RLS, llega como aviso y no queda nota a medias', async () => {
    const { invoiceId, lineId } = await facturaConLineas(2)
    const { emitirNotaDeCredito } = await import('./actions')
    await c.modulo('inventory', false)
    try {
      const r = await emitirNotaDeCredito(
        c.fd(
          { invoiceId, kind: 'return', reason: 'Devolucion', restock: '1', [`qty_${lineId}`]: '1' },
          'Dueno',
        ),
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/inventario no esta activo/)
    } finally {
      await c.modulo('inventory', true)
    }
    const [n] = await db()<{ n: string }[]>`
      select count(*)::text as n from public.customer_credit_notes where invoice_id = ${invoiceId}`
    expect(n!.n).toBe('0')
    expect(await saldo(invoiceId)).toBe(2360)
  })

  it('el cobrador no emite notas de credito', async () => {
    const { invoiceId } = await facturaConLineas(1)
    const { emitirNotaDeCredito } = await import('./actions')
    const r = await emitirNotaDeCredito(
      c.fd({ invoiceId, kind: 'adjustment', reason: 'Rebaja', amount: '10' }, 'Cobrador'),
    )
    expect(r.ok).toBe(false)
  })
})
