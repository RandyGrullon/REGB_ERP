import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import {
  MODULOS_CREDITO,
  almacen,
  cliente,
  factura,
  limpiarCredito,
  pedido,
  producto,
} from '@/test/venta-a-credito'
import { confirmarPedido } from './actions'

/**
 * Limite de credito y bloqueo por vencidas, llamando a confirmarPedido()
 * DE VERDAD.
 *
 * El hallazgo (analisis de flujo, 23 sep 2026): `customers.credit_limit`
 * existia desde la 0020 y nada lo leia. Ferreteria El Martillo tenia una
 * factura vencida hace 96 dias y aun asi se le confirmaba, entregaba y
 * facturaba un pedido de RD$100,000.
 *
 * Cada caso se vio en rojo contra la accion vieja antes de escribir el
 * arreglo, y otra vez rompiendo el arreglo a proposito.
 */

const VENDEDOR = { 'sales-orders.*': true, 'ar.view': true, 'products.view': true }
const DUENO = { '*': true }
// Lleva la cartera pero no autoriza excepciones: la denegacion explicita
// gana sobre el comodin `ar.*`, que es como el dueno se la quita a alguien.
const CONTADOR = { 'ar.*': true, 'sales-orders.*': true, 'ar.credit.override': false }

let c: ClientePrueba
let wh: string
let prod: string

async function estadoPedido(orderId: string): Promise<string> {
  const [o] = await db()<{ status: string }[]>`select status from public.sales_orders where id = ${orderId}`
  return o!.status
}

async function apartado(): Promise<number> {
  const [s] = await db()<{ q: string }[]>`
    select coalesce(sum(qty_reserved), 0)::text as q from public.stock_levels
    where tenant_id = ${c.tenantId} and product_id = ${prod}`
  return Number(s!.q)
}

async function excepciones(orderId: string) {
  return db()<
    {
      stage: string
      reason: string
      authorized_by: string
      document_total: string
      oldest_overdue_days: number | null
      blocks: string[]
    }[]
  >`
    select stage, reason, authorized_by, document_total::text, oldest_overdue_days, blocks
    from public.credit_overrides where tenant_id = ${c.tenantId} and order_id = ${orderId}`
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-credito',
    nombre: 'Distribuidora de Prueba SRL',
    modulos: MODULOS_CREDITO,
    roles: { Vendedor: VENDEDOR, Dueno: DUENO, Contador: CONTADOR },
  })
  wh = await almacen(c.tenantId)
  prod = await producto(c.tenantId, wh, { sku: 'CEM-100', precio: 1000, existencia: 500 })
})

afterAll(async () => {
  await limpiarCredito(c.limpiar)
  await cerrarBase()
})

describe('Cliente con facturas vencidas', () => {
  let martillo: string
  let pedidoMartillo: string

  beforeAll(async () => {
    martillo = await cliente(c.tenantId, { nombre: 'Ferreteria El Martillo SRL', dias: 30 })
    await factura(c.tenantId, martillo, { numero: 'FA-VIEJA-1', total: 11564, diasVencida: 96 })
    pedidoMartillo = await pedido(c.tenantId, {
      customerId: martillo,
      warehouseId: wh,
      productId: prod,
      cantidad: 10,
      precio: 1000,
      estado: 'draft',
    })
  })

  it('96 dias vencida -> confirmar se bloquea, lo dice, y no aparta nada', async () => {
    const r = await confirmarPedido(c.fd({ orderId: pedidoMartillo }, 'Vendedor'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/96 dias/)
    expect(r.error).toMatch(/FA-VIEJA-1/)
    expect(await estadoPedido(pedidoMartillo)).toBe('draft')
    expect(await apartado()).toBe(0)
  })

  it('el vendedor no puede autorizarse la excepcion a si mismo', async () => {
    const r = await confirmarPedido(
      c.fd(
        { orderId: pedidoMartillo, creditOverride: '1', overrideReason: 'Me lo pidio el cliente' },
        'Vendedor',
      ),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/ar\.credit\.override/)
    expect(await estadoPedido(pedidoMartillo)).toBe('draft')
  })

  it('la denegacion explicita al Contador tambien cierra la puerta, aunque tenga ar.*', async () => {
    const r = await confirmarPedido(
      c.fd(
        { orderId: pedidoMartillo, creditOverride: '1', overrideReason: 'Lo autorizo yo' },
        'Contador',
      ),
    )
    expect(r.ok).toBe(false)
    expect(await estadoPedido(pedidoMartillo)).toBe('draft')
  })

  it('una excepcion sin motivo no se acepta: tiene que quedar escrito por que', async () => {
    const r = await confirmarPedido(
      c.fd({ orderId: pedidoMartillo, creditOverride: '1', overrideReason: '' }, 'Dueno'),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/motivo/i)
    expect(await estadoPedido(pedidoMartillo)).toBe('draft')
  })

  it('con la excepcion del dueno pasa, y queda escrita con quien, por que y que se salto', async () => {
    const r = await confirmarPedido(
      c.fd(
        {
          orderId: pedidoMartillo,
          creditOverride: '1',
          overrideReason: 'Cliente de 10 anos, paga el viernes con cheque',
        },
        'Dueno',
      ),
    )
    expect(r).toEqual({ ok: true })
    expect(await estadoPedido(pedidoMartillo)).toBe('confirmed')
    expect(await apartado()).toBe(10)

    const ex = await excepciones(pedidoMartillo)
    expect(ex).toHaveLength(1)
    expect(ex[0]!.stage).toBe('confirm')
    expect(ex[0]!.reason).toBe('Cliente de 10 anos, paga el viernes con cheque')
    expect(ex[0]!.authorized_by).toBeTruthy()
    expect(ex[0]!.oldest_overdue_days).toBe(96)
    expect(ex[0]!.blocks).toEqual(['overdue'])
    expect(Number(ex[0]!.document_total)).toBe(11800)

    // La bitacora general tambien la tiene: es lo que revisa el dueno.
    const [log] = await db()<{ n: string }[]>`
      select count(*)::text as n from audit.log
      where tenant_id = ${c.tenantId} and entity = 'credit_overrides' and action = 'create'`
    expect(Number(log!.n)).toBeGreaterThanOrEqual(1)

    // Y el evento, para quien quiera enterarse.
    const [ev] = await db()<{ n: string }[]>`
      select count(*)::text as n from public.event_outbox
      where tenant_id = ${c.tenantId} and type = 'ar.credit.overridden'`
    expect(Number(ev!.n)).toBe(1)
  })

  it('los dias son configurables: con 120 de tolerancia, 96 dias ya no bloquean', async () => {
    const { guardarPoliticaDeCredito } = await import('../cobrar/actions')
    const cambio = await guardarPoliticaDeCredito(c.fd({ overdueDays: '120' }, 'Dueno'))
    expect(cambio).toEqual({ ok: true })

    const otro = await pedido(c.tenantId, {
      customerId: martillo,
      warehouseId: wh,
      productId: prod,
      cantidad: 1,
      precio: 1000,
      estado: 'draft',
    })
    try {
      const r = await confirmarPedido(c.fd({ orderId: otro }, 'Vendedor'))
      expect(r).toEqual({ ok: true })
    } finally {
      await guardarPoliticaDeCredito(c.fd({ overdueDays: '30' }, 'Dueno'))
    }
  })

  it('el vendedor no cambia la politica de credito', async () => {
    const { guardarPoliticaDeCredito } = await import('../cobrar/actions')
    const r = await guardarPoliticaDeCredito(c.fd({ overdueDays: '365' }, 'Vendedor'))
    expect(r.ok).toBe(false)
  })

  it('con ar apagado no hay cartera que mirar: el pedido pasa como antes', async () => {
    const otro = await pedido(c.tenantId, {
      customerId: martillo,
      warehouseId: wh,
      productId: prod,
      cantidad: 1,
      precio: 1000,
      estado: 'draft',
    })
    await c.modulo('ar', false)
    try {
      const r = await confirmarPedido(c.fd({ orderId: otro }, 'Vendedor'))
      expect(r).toEqual({ ok: true })
    } finally {
      await c.modulo('ar', true)
    }
  })
})

describe('Limite de credito', () => {
  it('saldo 40,000 + pedido 11,800 pasa un limite de 50,000 -> bloqueado', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Constructora Duarte SRL', limite: 50000 })
    await factura(c.tenantId, cli, { numero: 'FA-LIM-1', total: 40000, diasVencida: -10 })
    const ped = await pedido(c.tenantId, {
      customerId: cli,
      warehouseId: wh,
      productId: prod,
      cantidad: 10,
      precio: 1000,
      estado: 'draft',
    })
    const r = await confirmarPedido(c.fd({ orderId: ped }, 'Vendedor'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/limite/i)
    expect(r.error).toMatch(/50,000\.00/)
    expect(await estadoPedido(ped)).toBe('draft')
  })

  it('dentro del limite pasa', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Colmado Dentro SRL', limite: 50000 })
    await factura(c.tenantId, cli, { numero: 'FA-LIM-2', total: 30000, diasVencida: -10 })
    const ped = await pedido(c.tenantId, {
      customerId: cli,
      warehouseId: wh,
      productId: prod,
      cantidad: 10,
      precio: 1000,
      estado: 'draft',
    })
    expect(await confirmarPedido(c.fd({ orderId: ped }, 'Vendedor'))).toEqual({ ok: true })
  })

  it('lo confirmado y no facturado tambien cuenta: dos pedidos no se cuelan por separado', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Ferreteria Dos Pedidos SRL', limite: 20000 })
    const a = await pedido(c.tenantId, {
      customerId: cli,
      warehouseId: wh,
      productId: prod,
      cantidad: 10,
      precio: 1000,
      estado: 'draft',
    })
    const b = await pedido(c.tenantId, {
      customerId: cli,
      warehouseId: wh,
      productId: prod,
      cantidad: 10,
      precio: 1000,
      estado: 'draft',
    })
    expect(await confirmarPedido(c.fd({ orderId: a }, 'Vendedor'))).toEqual({ ok: true })
    const r = await confirmarPedido(c.fd({ orderId: b }, 'Vendedor'))
    expect(r.ok).toBe(false)
    expect(await estadoPedido(b)).toBe('draft')
  })

  it('sin limite fijado y sin vencidas, el pedido pasa como siempre', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Cliente Sin Limite SRL', limite: null })
    await factura(c.tenantId, cli, { numero: 'FA-LIM-3', total: 900000, diasVencida: -5 })
    const ped = await pedido(c.tenantId, {
      customerId: cli,
      warehouseId: wh,
      productId: prod,
      cantidad: 10,
      precio: 1000,
      estado: 'draft',
    })
    expect(await confirmarPedido(c.fd({ orderId: ped }, 'Vendedor'))).toEqual({ ok: true })
  })
})

describe('Confirmar no tira la pantalla', () => {
  it('un pedido de otro formato (id roto) devuelve un error legible, no una excepcion', async () => {
    const p = confirmarPedido(c.fd({ orderId: 'no-es-un-uuid' }, 'Vendedor'))
    await expect(p).resolves.toMatchObject({ ok: false })
  })
})
