'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  documentTotals,
  lineTotals,
  transicionValidaCotizacion,
  type EstadoCotizacion,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { sinExcepciones } from '@/lib/accion-segura'
import { precioDeVenta } from '@/lib/precio'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'
import type postgres from 'postgres'

/**
 * Acciones de Cotizaciones (modulo 31, F9/S56).
 *
 * `documentTotals()`/`lineTotals()` -las MISMAS funciones que ya usan
 * pedidos, POS y facturas- calculan cada total; nunca se escribe una
 * formula de dinero nueva aqui. `transicionValidaCotizacion()` valida
 * la maquina de estados antes de escribir.
 *
 * Toda accion pasa por `sinExcepciones`: un error de la base llega como
 * aviso legible, no como pantalla rota.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

function qsDe(fd: FormData): string {
  const { tenant, rol } = demoDe(fd)
  return tenant ? `?tenant=${tenant}&rol=${encodeURIComponent(rol ?? 'Owner')}` : ''
}

const num = (raw: string): number | null => {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

async function recalcularTotales(tx: postgres.TransactionSql, tenantId: string, quoteId: string) {
  const lineas = await tx<
    { quantity: string; unit_price: string; discount_pct: string; tax_rate: string }[]
  >`
    select quantity::text, unit_price::text, discount_pct::text, tax_rate::text
    from public.quote_lines where quote_id = ${quoteId} and tenant_id = ${tenantId}`

  const totales = documentTotals(
    lineas.map((l) => ({
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      discountPct: Number(l.discount_pct),
      taxRate: Number(l.tax_rate),
    })),
  )

  await tx`
    update public.quotes
    set subtotal = ${totales.subtotal}, discount = ${totales.discount}, tax = ${totales.tax}, total = ${totales.total}, updated_at = now()
    where id = ${quoteId} and tenant_id = ${tenantId}`
}

/** Lo que devuelve crear: el id, para llevar al vendedor a la cotizacion. */
export type CotizacionCreada = ActionResult & { quoteId?: string; number?: string }

export async function crearCotizacion(fd: FormData): Promise<CotizacionCreada> {
  const salida: { quoteId?: string; number?: string } = {}
  const r = await sinExcepciones('crearCotizacion', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'quotes', 'quotes.manage')
    if (!permiso.ok) return permiso

    const customerId = String(fd.get('customerId') ?? '') || null
    const terms = String(fd.get('terms') ?? '').trim() || null
    const validUntil = String(fd.get('validUntil') ?? '') || null

    const creada = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      // El siguiente numero sale del mayor, no de contar filas: cada
      // version nueva es una fila con el MISMO numero, y contarlas saltaba
      // numeros (COT-0001 v2 hacia que la siguiente fuera COT-0003).
      const [n] = await tx<{ n: number }[]>`
        select coalesce(max(nullif(substring(quote_number from '^COT-(\\d+)$'), '')::int), 0) + 1 as n
        from public.quotes where tenant_id = ${ctx.tenantId}`
      const numero = `COT-${String(n!.n).padStart(4, '0')}`

      const [q] = await tx<{ id: string }[]>`
        insert into public.quotes (tenant_id, quote_number, customer_id, terms, valid_until, created_by)
        values (${ctx.tenantId}, ${numero}, ${customerId}, ${terms}, ${validUntil}, ${ctx.userId})
        returning id`
      return { quoteId: q!.id, number: numero }
    })

    revalidatePath('/cotizaciones-venta')
    Object.assign(salida, creada)
    return { ok: true }
  })
  return r.ok ? { ...r, ...salida } : r
}

/** Solo una cotizacion en borrador se edita: lo enviado ya lo vio el cliente. */
async function exigirBorrador(
  tx: postgres.TransactionSql,
  tenantId: string,
  quoteId: string,
): Promise<{ customer_id: string | null } | string> {
  const [q] = await tx<{ status: EstadoCotizacion; customer_id: string | null }[]>`
    select status, customer_id from public.quotes
    where id = ${quoteId} and tenant_id = ${tenantId} for update`
  if (!q) return 'Esa cotizacion no existe.'
  if (q.status !== 'draft') {
    return 'Esta cotizacion ya se envio: lo que vio el cliente no se cambia. Crea una version nueva.'
  }
  return q
}

export async function agregarLinea(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('agregarLineaCotizacion', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'quotes', 'quotes.manage')
    if (!permiso.ok) return permiso

    const quoteId = String(fd.get('quoteId') ?? '')
    const productId = String(fd.get('productId') ?? '')
    const description = String(fd.get('description') ?? '').trim() || null
    const quantity = num(String(fd.get('quantity') ?? ''))
    const precioEscrito = num(String(fd.get('unitPrice') ?? ''))
    const discountPct = num(String(fd.get('discountPct') ?? '')) ?? 0
    const taxRateForm = num(String(fd.get('taxRate') ?? ''))

    if (!quoteId) return { ok: false, error: 'Faltan datos.' }
    if (!productId) return { ok: false, error: 'Elige el producto.' }
    if (quantity === null || quantity <= 0)
      return { ok: false, error: 'La cantidad debe ser mayor que cero.' }
    if (precioEscrito !== null && precioEscrito < 0) {
      return { ok: false, error: 'El precio debe ser un numero valido.' }
    }
    if (discountPct < 0 || discountPct > 100)
      return { ok: false, error: 'El descuento va de 0 a 100.' }

    const error = await asUser(ctx.userId, ctx.tenantId, async (tx): Promise<string | null> => {
      const q = await exigirBorrador(tx, ctx.tenantId, quoteId)
      if (typeof q === 'string') return q

      // La tasa y el precio salen del producto, igual que en caja, pedidos y
      // compras. El 0.18 queda solo para cuando la ficha no se ve (products
      // apagado).
      const [p] = await tx<{ tax_rate: string; price: string }[]>`
        select tax_rate::text, price::text from public.products
        where id = ${productId} and tenant_id = ${ctx.tenantId}`
      const taxRate = taxRateForm ?? (p ? Number(p.tax_rate) : 0.18)

      // Sin precio escrito se cotiza lo que el cliente pagaria en un pedido:
      // su lista de precios por cantidad, o el catalogo. Antes el campo era
      // obligatorio y vacio, y cada vendedor ponia el precio que recordaba.
      let unitPrice = precioEscrito
      if (unitPrice === null) {
        if (!p) return 'Escribe el precio unitario: no se pudo leer el del catalogo.'
        const { precio } = await precioDeVenta(
          tx,
          ctx.tenantId,
          { productId, cantidad: quantity, precioBase: Number(p.price) },
          { customerId: q.customer_id, channel: null, usarListaAsignada: true },
        )
        unitPrice = precio
      }

      let totalLinea: number
      try {
        totalLinea = lineTotals({ quantity, unitPrice, discountPct, taxRate }).total
      } catch {
        return 'Esos numeros no son validos.'
      }

      await tx`
        insert into public.quote_lines (quote_id, tenant_id, product_id, description, quantity, unit_price, discount_pct, tax_rate, line_total)
        values (${quoteId}, ${ctx.tenantId}, ${productId}, ${description}, ${quantity}, ${unitPrice}, ${discountPct}, ${taxRate}, ${totalLinea})`
      await recalcularTotales(tx, ctx.tenantId, quoteId)
      return null
    })
    if (error) return { ok: false, error }

    revalidatePath(`/cotizaciones-venta/${quoteId}`)
    return { ok: true }
  })
}

export async function quitarLinea(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('quitarLineaCotizacion', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'quotes', 'quotes.manage')
    if (!permiso.ok) return permiso

    const quoteId = String(fd.get('quoteId') ?? '')
    const lineId = String(fd.get('lineId') ?? '')
    if (!quoteId || !lineId) return { ok: false, error: 'Faltan datos.' }

    const error = await asUser(ctx.userId, ctx.tenantId, async (tx): Promise<string | null> => {
      const q = await exigirBorrador(tx, ctx.tenantId, quoteId)
      if (typeof q === 'string') return q
      await tx`delete from public.quote_lines where id = ${lineId} and quote_id = ${quoteId} and tenant_id = ${ctx.tenantId}`
      await recalcularTotales(tx, ctx.tenantId, quoteId)
      return null
    })
    if (error) return { ok: false, error }

    revalidatePath(`/cotizaciones-venta/${quoteId}`)
    return { ok: true }
  })
}

/** Avanza el estado de la cotizacion -draft/sent/approved/rejected/expired-. */
export async function transicionarCotizacion(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('transicionarCotizacion', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'quotes', 'quotes.manage')
    if (!permiso.ok) return permiso

    const quoteId = String(fd.get('quoteId') ?? '')
    const siguiente = String(fd.get('siguiente') ?? '') as EstadoCotizacion
    const rejectedReason = String(fd.get('rejectedReason') ?? '').trim() || null

    const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [q] = await tx<{ status: EstadoCotizacion; lineas: number }[]>`
        select q.status,
               (select count(*) from public.quote_lines l where l.quote_id = q.id)::int as lineas
        from public.quotes q where q.id = ${quoteId} and q.tenant_id = ${ctx.tenantId} for update`
      if (!q) return 'no-existe'
      if (!transicionValidaCotizacion(q.status, siguiente))
        return 'Esa transicion no esta permitida.'
      if (siguiente === 'sent' && q.lineas === 0) {
        return 'Agrega al menos una linea antes de enviarla: una cotizacion vacia no le dice nada al cliente.'
      }

      const enviando = siguiente === 'sent'
      const aprobando = siguiente === 'approved'
      await tx`
        update public.quotes
        set status = ${siguiente}, updated_at = now(),
            sent_at = case when ${enviando} then now() else sent_at end,
            approved_at = case when ${aprobando} then now() else approved_at end,
            rejected_reason = case when ${siguiente === 'rejected'} then ${rejectedReason} else rejected_reason end
        where id = ${quoteId} and tenant_id = ${ctx.tenantId}`

      if (siguiente === 'sent' || siguiente === 'approved' || siguiente === 'rejected') {
        await tx`
          select public.emit_event(${`quotes.quote.${siguiente === 'sent' ? 'sent' : siguiente === 'approved' ? 'approved' : 'rejected'}`},
            ${JSON.stringify({ quoteId })}::text::jsonb, 'quotes')`
      }

      return 'ok'
    })

    if (resultado === 'no-existe') return { ok: false, error: 'Esa cotizacion no existe.' }
    if (resultado !== 'ok') return { ok: false, error: resultado }

    revalidatePath(`/cotizaciones-venta/${quoteId}`)
    revalidatePath('/cotizaciones-venta')
    return { ok: true }
  })
}

/** Crea una version nueva de la cotizacion -marca la actual 'superseded', copia cliente/terminos/lineas-. */
export async function crearVersionNueva(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('crearVersionNueva', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'quotes', 'quotes.manage')
    if (!permiso.ok) return permiso

    const quoteId = String(fd.get('quoteId') ?? '')

    const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [actual] = await tx<
        {
          status: EstadoCotizacion
          quote_number: string
          version: number
          customer_id: string | null
          terms: string | null
          valid_until: string | null
          sales_order_id: string | null
        }[]
      >`
        select status, quote_number, version, customer_id, terms, valid_until::text, sales_order_id
        from public.quotes where id = ${quoteId} and tenant_id = ${ctx.tenantId} for update`
      if (!actual) return { error: 'Esa cotizacion no existe.' }
      if (actual.status === 'draft') {
        return {
          error: 'Una cotizacion en borrador se edita directo, no necesita una version nueva.',
        }
      }
      if (actual.status === 'superseded')
        return { error: 'Esa cotizacion ya fue sustituida por otra version.' }
      if (actual.sales_order_id) {
        return {
          error: 'Esta cotizacion ya se convirtio en pedido: los cambios se hacen en el pedido.',
        }
      }

      const lineas = await tx<
        {
          product_id: string
          description: string | null
          quantity: string
          unit_price: string
          discount_pct: string
          tax_rate: string
          line_total: string
        }[]
      >`
        select product_id, description, quantity::text, unit_price::text, discount_pct::text, tax_rate::text, line_total::text
        from public.quote_lines where quote_id = ${quoteId} and tenant_id = ${ctx.tenantId}`

      const [nueva] = await tx<{ id: string }[]>`
        insert into public.quotes (tenant_id, quote_number, version, supersedes_id, customer_id, terms, valid_until, created_by)
        values (${ctx.tenantId}, ${actual.quote_number}, ${actual.version + 1}, ${quoteId}, ${actual.customer_id}, ${actual.terms}, ${actual.valid_until}, ${ctx.userId})
        returning id`

      for (const l of lineas) {
        await tx`
          insert into public.quote_lines (quote_id, tenant_id, product_id, description, quantity, unit_price, discount_pct, tax_rate, line_total)
          values (${nueva!.id}, ${ctx.tenantId}, ${l.product_id}, ${l.description}, ${l.quantity}, ${l.unit_price}, ${l.discount_pct}, ${l.tax_rate}, ${l.line_total})`
      }
      await recalcularTotales(tx, ctx.tenantId, nueva!.id)

      await tx`update public.quotes set status = 'superseded', updated_at = now() where id = ${quoteId} and tenant_id = ${ctx.tenantId}`

      return { id: nueva!.id }
    })

    if ('error' in resultado) return { ok: false, error: resultado.error }

    revalidatePath('/cotizaciones-venta')
    return { ok: true }
  })
}

// ── Convertir en pedido ─────────────────────────────────────────────────

export type PedidoDesdeCotizacion = ActionResult & { orderId?: string; number?: string }

/**
 * La cotizacion APROBADA se vuelve un pedido en borrador, con sus mismas
 * lineas y sus mismos precios -los que el cliente acepto-, no los de la
 * lista de hoy. El pedido queda en borrador: confirmarlo (apartar y mirar
 * el credito) sigue siendo el paso de siempre.
 *
 * Antes no habia camino: el pedido se volvia a teclear a mano y nada
 * impedia cobrar otro precio. Se convierte UNA vez: la cotizacion guarda
 * su pedido (0136).
 */
export async function convertirEnPedido(fd: FormData): Promise<PedidoDesdeCotizacion> {
  const salida: { orderId?: string; number?: string } = {}
  const r = await sinExcepciones('convertirEnPedido', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const pc = exigir(ctx, 'quotes', 'quotes.manage')
    if (!pc.ok) return pc
    const pp = exigir(ctx, 'sales-orders', 'sales-orders.create')
    if (!pp.ok) return pp

    const quoteId = String(fd.get('quoteId') ?? '')
    const warehouseElegido = String(fd.get('warehouseId') ?? '') || null
    if (!quoteId) return { ok: false, error: 'Faltan datos.' }

    const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [q] = await tx<
        {
          status: EstadoCotizacion
          quote_number: string
          version: number
          customer_id: string | null
          sales_order_id: string | null
        }[]
      >`
        select status, quote_number, version, customer_id, sales_order_id
        from public.quotes where id = ${quoteId} and tenant_id = ${ctx.tenantId} for update`
      if (!q) return { error: 'Esa cotizacion no existe.' }
      if (q.sales_order_id) {
        const [o] = await tx<{ number: string }[]>`
          select number from public.sales_orders where id = ${q.sales_order_id}`
        return {
          error: `Esta cotizacion ya se convirtio en el pedido ${o?.number ?? ''}.`.replace(
            ' .',
            '.',
          ),
        }
      }
      if (q.status !== 'approved') {
        return { error: 'Solo una cotizacion aprobada por el cliente se convierte en pedido.' }
      }
      if (!q.customer_id) {
        return {
          error:
            'La cotizacion no tiene cliente: crea una version nueva con el cliente y apruebala.',
        }
      }

      const lineas = await tx<
        {
          product_id: string
          quantity: string
          unit_price: string
          discount_pct: string
          tax_rate: string
        }[]
      >`
        select product_id, quantity::text, unit_price::text, discount_pct::text, tax_rate::text
        from public.quote_lines where quote_id = ${quoteId} and tenant_id = ${ctx.tenantId}`
      if (lineas.length === 0) return { error: 'La cotizacion no tiene lineas.' }

      const [w] = warehouseElegido
        ? await tx<{ id: string }[]>`
            select id from public.warehouses
            where id = ${warehouseElegido} and tenant_id = ${ctx.tenantId} and is_active`
        : await tx<{ id: string }[]>`
            select id from public.warehouses
            where tenant_id = ${ctx.tenantId} and is_active
            order by is_default desc, name limit 1`
      if (!w) return { error: 'No hay un almacen activo que despache el pedido.' }

      const entradas = lineas.map((l) => ({
        quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price),
        discountPct: Number(l.discount_pct),
        taxRate: Number(l.tax_rate),
      }))
      const totales = documentTotals(entradas)

      const [n] = await tx<{ next_sales_order_number: string }[]>`
        select public.next_sales_order_number(${ctx.tenantId})`
      const nota = `Desde la cotizacion ${q.quote_number} v${q.version}`
      const [o] = await tx<{ id: string }[]>`
        insert into public.sales_orders
          (tenant_id, number, customer_id, warehouse_id, created_by, notes,
           subtotal, discount, tax, total)
        values (${ctx.tenantId}, ${n!.next_sales_order_number}, ${q.customer_id}, ${w.id},
                ${ctx.userId}, ${nota},
                ${totales.subtotal}, ${totales.discount}, ${totales.tax}, ${totales.total})
        returning id`

      for (const [i, l] of lineas.entries()) {
        await tx`
          insert into public.sales_order_lines
            (order_id, tenant_id, product_id, qty_ordered, unit_price, discount_pct, tax_rate, line_total)
          values (${o!.id}, ${ctx.tenantId}, ${l.product_id}, ${l.quantity}, ${l.unit_price},
                  ${l.discount_pct}, ${l.tax_rate}, ${totales.lines[i]!.total})`
      }

      await tx`
        update public.quotes set sales_order_id = ${o!.id}, updated_at = now()
        where id = ${quoteId} and tenant_id = ${ctx.tenantId}`

      return { orderId: o!.id, number: n!.next_sales_order_number }
    })

    if ('error' in res) return { ok: false, error: res.error }
    revalidatePath(`/cotizaciones-venta/${quoteId}`)
    revalidatePath('/cotizaciones-venta')
    revalidatePath('/pedidos')
    Object.assign(salida, res)
    return { ok: true }
  })
  return r.ok ? { ...r, ...salida } : r
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearCotizacionForm(fd: FormData): Promise<void> {
  const r = await crearCotizacion(fd)
  if (!r.ok || !r.quoteId) {
    await anotarAviso(r, 'crearCotizacion')
    return
  }
  await anotarAviso(r, 'crearCotizacion', `Cotizacion ${r.number} creada. Agregale las lineas.`)
  redirect(`/cotizaciones-venta/${r.quoteId}${qsDe(fd)}`)
}
export async function agregarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await agregarLinea(fd), 'agregarLinea')
}
export async function quitarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await quitarLinea(fd), 'quitarLinea')
}
const TEXTO_TRANSICION: Record<string, string> = {
  sent: 'Cotizacion marcada como enviada: ya no se edita. Imprimela para el cliente.',
  approved: 'Cotizacion aprobada. Ya la puedes convertir en pedido.',
  rejected: 'Cotizacion rechazada.',
  expired: 'Cotizacion marcada como vencida.',
}
export async function transicionarCotizacionForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await transicionarCotizacion(fd),
    'transicionarCotizacion',
    TEXTO_TRANSICION[String(fd.get('siguiente') ?? '')],
  )
}
export async function crearVersionNuevaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearVersionNueva(fd), 'crearVersionNueva')
}
export async function convertirEnPedidoForm(fd: FormData): Promise<void> {
  const r = await convertirEnPedido(fd)
  if (!r.ok || !r.orderId) {
    await anotarAviso(r, 'convertirEnPedido')
    return
  }
  await anotarAviso(
    r,
    'convertirEnPedido',
    `Pedido ${r.number} creado con los precios de la cotizacion. Revisalo y confirmalo para apartar la mercancia.`,
  )
  redirect(`/pedidos/${r.orderId}${qsDe(fd)}`)
}
