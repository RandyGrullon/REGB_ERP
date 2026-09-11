'use server'

import { revalidatePath } from 'next/cache'
import { documentTotals, lineTotals, transicionValidaCotizacion, type EstadoCotizacion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'
import type postgres from 'postgres'

/**
 * Acciones de Cotizaciones (modulo 31, F9/S56).
 *
 * `documentTotals()`/`lineTotals()` -las MISMAS funciones que ya usan
 * pedidos, POS y facturas- calculan cada total; nunca se escribe una
 * formula de dinero nueva aqui. `transicionValidaCotizacion()` valida
 * la maquina de estados antes de escribir.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const num = (raw: string): number | null => {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

async function recalcularTotales(tx: postgres.TransactionSql, tenantId: string, quoteId: string) {
  const lineas = await tx<{ quantity: string; unit_price: string; discount_pct: string; tax_rate: string }[]>`
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

export async function crearCotizacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quotes', 'quotes.manage')
  if (!permiso.ok) return permiso

  const customerId = String(fd.get('customerId') ?? '') || null
  const terms = String(fd.get('terms') ?? '').trim() || null
  const validUntil = String(fd.get('validUntil') ?? '') || null

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [n] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.quotes where tenant_id = ${ctx.tenantId}`
    const numero = `COT-${String(Number(n!.n) + 1).padStart(4, '0')}`

    await tx`
      insert into public.quotes (tenant_id, quote_number, customer_id, terms, valid_until, created_by)
      values (${ctx.tenantId}, ${numero}, ${customerId}, ${terms}, ${validUntil}, ${ctx.userId})`
  })

  revalidatePath('/cotizaciones-venta')
  return { ok: true }
}

export async function agregarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quotes', 'quotes.manage')
  if (!permiso.ok) return permiso

  const quoteId = String(fd.get('quoteId') ?? '')
  const productId = String(fd.get('productId') ?? '')
  const description = String(fd.get('description') ?? '').trim() || null
  const quantity = num(String(fd.get('quantity') ?? ''))
  const unitPrice = num(String(fd.get('unitPrice') ?? ''))
  const discountPct = num(String(fd.get('discountPct') ?? '')) ?? 0
  const taxRate = num(String(fd.get('taxRate') ?? '')) ?? 0.18

  if (!productId) return { ok: false, error: 'Elige el producto.' }
  if (quantity === null || quantity <= 0) return { ok: false, error: 'La cantidad debe ser mayor que cero.' }
  if (unitPrice === null || unitPrice < 0) return { ok: false, error: 'El precio debe ser un numero valido.' }

  let totalLinea: number
  try {
    totalLinea = lineTotals({ quantity, unitPrice, discountPct, taxRate }).total
  } catch {
    return { ok: false, error: 'Esos numeros no son validos.' }
  }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    await tx`
      insert into public.quote_lines (quote_id, tenant_id, product_id, description, quantity, unit_price, discount_pct, tax_rate, line_total)
      values (${quoteId}, ${ctx.tenantId}, ${productId}, ${description}, ${quantity}, ${unitPrice}, ${discountPct}, ${taxRate}, ${totalLinea})`
    await recalcularTotales(tx, ctx.tenantId, quoteId)
  })

  revalidatePath(`/cotizaciones-venta/${quoteId}`)
  return { ok: true }
}

export async function quitarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quotes', 'quotes.manage')
  if (!permiso.ok) return permiso

  const quoteId = String(fd.get('quoteId') ?? '')
  const lineId = String(fd.get('lineId') ?? '')

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    await tx`delete from public.quote_lines where id = ${lineId} and quote_id = ${quoteId} and tenant_id = ${ctx.tenantId}`
    await recalcularTotales(tx, ctx.tenantId, quoteId)
  })

  revalidatePath(`/cotizaciones-venta/${quoteId}`)
  return { ok: true }
}

/** Avanza el estado de la cotizacion -draft/sent/approved/rejected/expired-. */
export async function transicionarCotizacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quotes', 'quotes.manage')
  if (!permiso.ok) return permiso

  const quoteId = String(fd.get('quoteId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoCotizacion
  const rejectedReason = String(fd.get('rejectedReason') ?? '').trim() || null

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [q] = await tx<{ status: EstadoCotizacion }[]>`
      select status from public.quotes where id = ${quoteId} and tenant_id = ${ctx.tenantId} for update`
    if (!q) return 'no-existe'
    if (!transicionValidaCotizacion(q.status, siguiente)) return 'Esa transicion no esta permitida.'

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
}

/** Crea una version nueva de la cotizacion -marca la actual 'superseded', copia cliente/terminos/lineas-. */
export async function crearVersionNueva(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quotes', 'quotes.manage')
  if (!permiso.ok) return permiso

  const quoteId = String(fd.get('quoteId') ?? '')

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [actual] = await tx<{
      status: EstadoCotizacion
      quote_number: string
      version: number
      customer_id: string | null
      terms: string | null
      valid_until: string | null
    }[]>`
      select status, quote_number, version, customer_id, terms, valid_until::text
      from public.quotes where id = ${quoteId} and tenant_id = ${ctx.tenantId} for update`
    if (!actual) return 'no-existe'
    if (actual.status === 'draft') return 'Una cotizacion en borrador se edita directo, no necesita una version nueva.'
    if (actual.status === 'superseded') return 'Esa cotizacion ya fue sustituida por otra version.'

    const lineas = await tx<{
      product_id: string
      description: string | null
      quantity: string
      unit_price: string
      discount_pct: string
      tax_rate: string
      line_total: string
    }[]>`
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

    return nueva!.id
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa cotizacion no existe.' }
  if (resultado === 'Una cotizacion en borrador se edita directo, no necesita una version nueva.' || resultado === 'Esa cotizacion ya fue sustituida por otra version.') {
    return { ok: false, error: resultado }
  }

  revalidatePath('/cotizaciones-venta')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearCotizacionForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearCotizacion(fd), 'crearCotizacion')
}
export async function agregarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await agregarLinea(fd), 'agregarLinea')
}
export async function quitarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await quitarLinea(fd), 'quitarLinea')
}
export async function transicionarCotizacionForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarCotizacion(fd), 'transicionarCotizacion')
}
export async function crearVersionNuevaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearVersionNueva(fd), 'crearVersionNueva')
}
