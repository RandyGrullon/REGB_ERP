'use server'

import { revalidatePath } from 'next/cache'
import { balanceAfter, deriveInvoiceStatus, dueDateFrom, overpayment } from '@regb/operations'
import { asUser, db } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de cuentas por cobrar (S22).
 *
 * El saldo NO se guarda: se deriva de total - cobrado. Un saldo escrito a
 * mano se desincroniza el dia que alguien anule un cobro. El `status` si
 * se persiste, pero como PROYECCION: siempre se recalcula con
 * deriveInvoiceStatus a partir de los cobros reales.
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

/**
 * Emite la factura de un pedido entregado.
 *
 * El vencimiento sale de los dias de credito que el cliente tenia AL
 * EMITIR: si manana se le cambian las condiciones, esta factura sigue
 * venciendo cuando le tocaba.
 */
export async function facturarPedido(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ar', 'ar.invoice.create')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  if (!orderId) return { ok: false, error: 'Faltan datos.' }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<
      {
        id: string
        status: string
        customer_id: string
        payment_terms: number
        subtotal: string
        discount: string
        tax: string
        total: string
        number: string
      }[]
    >`
      select o.id, o.status, o.customer_id, c.payment_terms,
             o.subtotal::text, o.discount::text, o.tax::text, o.total::text, o.number
      from public.sales_orders o
      join public.customers c on c.id = o.customer_id
      where o.id = ${orderId} and o.tenant_id = ${ctx.tenantId}`
    if (!order) return 'no-existe'
    if (order.status === 'draft') return 'sin-confirmar'
    if (order.status === 'cancelled') return 'cancelado'

    const [ya] = await tx<{ number: string }[]>`
      select number from public.customer_invoices
      where tenant_id = ${ctx.tenantId} and source_type = 'sales_order'
        and source_id = ${orderId} and status <> 'void'`
    if (ya) return `Ese pedido ya se facturo con ${ya.number}.`

    const [n] = await tx<{ next_customer_invoice_number: string }[]>`
      select public.next_customer_invoice_number(${ctx.tenantId})`

    const emision = new Date()
    const vence = dueDateFrom(emision, order.payment_terms)

    await tx`
      insert into public.customer_invoices
        (tenant_id, number, customer_id, source_type, source_id, issue_date, due_date,
         subtotal, discount, tax, total, created_by)
      values (${ctx.tenantId}, ${n!.next_customer_invoice_number}, ${order.customer_id},
              'sales_order', ${orderId},
              ${emision.toISOString().slice(0, 10)}, ${vence.toISOString().slice(0, 10)},
              ${order.subtotal}, ${order.discount}, ${order.tax}, ${order.total}, ${ctx.userId})`

    await tx`
      select public.emit_event('ar.invoice.issued',
        ${JSON.stringify({ orderId, number: n!.next_customer_invoice_number })}::text::jsonb, 'ar')`

    return 'ok'
  })

  if (res === 'no-existe') return { ok: false, error: 'Ese pedido no existe.' }
  if (res === 'sin-confirmar') return { ok: false, error: 'Confirma el pedido antes de facturar.' }
  if (res === 'cancelado') return { ok: false, error: 'El pedido esta cancelado.' }
  if (res !== 'ok') return { ok: false, error: res }

  revalidatePath('/cobrar')
  revalidatePath(`/pedidos/${orderId}`)
  return { ok: true }
}

/**
 * Registra un cobro y recalcula el estado. Rechaza cobrar de mas: un
 * sobrepago silencioso deja la cartera cuadrando con dinero que no existe.
 */
export async function registrarCobro(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ar', 'ar.payment.record')
  if (!permiso.ok) return permiso

  const invoiceId = String(fd.get('invoiceId') ?? '')
  const monto = num(String(fd.get('amount') ?? ''))
  const metodo = String(fd.get('method') ?? 'cash')
  const referencia = String(fd.get('reference') ?? '').trim() || null

  if (!invoiceId) return { ok: false, error: 'Faltan datos.' }
  if (monto === null || monto <= 0) return { ok: false, error: 'El monto debe ser positivo.' }
  if (!['cash', 'card', 'transfer', 'check'].includes(metodo)) {
    return { ok: false, error: 'Forma de pago no valida.' }
  }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [inv] = await tx<{ total: string; status: string; due_date: string }[]>`
      select total::text, status, due_date::text from public.customer_invoices
      where id = ${invoiceId} and tenant_id = ${ctx.tenantId} for update`
    if (!inv) return 'no-existe'
    if (inv.status === 'void') return 'anulada'

    const cobros = await tx<{ amount: string }[]>`
      select amount::text from public.customer_payments
      where invoice_id = ${invoiceId} and tenant_id = ${ctx.tenantId}`
    const previos = cobros.map((c) => Number(c.amount))

    const sobra = overpayment(Number(inv.total), [...previos, monto])
    if (sobra > 0) {
      const saldo = balanceAfter(Number(inv.total), previos)
      return `Solo quedan ${saldo.toFixed(2)} por cobrar; se intento cobrar ${monto.toFixed(2)}.`
    }

    await tx`
      insert into public.customer_payments
        (tenant_id, invoice_id, amount, method, reference, received_by)
      values (${ctx.tenantId}, ${invoiceId}, ${monto}, ${metodo}, ${referencia}, ${ctx.userId})`

    // `settled` es el TOTAL cobrado, no la lista de cobros.
    const cobradoTotal = [...previos, monto].reduce((a, n) => a + n, 0)
    const estado = deriveInvoiceStatus(
      Number(inv.total),
      cobradoTotal,
      new Date(`${inv.due_date}T12:00:00`),
      new Date(),
    )

    await tx`
      update public.customer_invoices set status = ${estado}
      where id = ${invoiceId} and tenant_id = ${ctx.tenantId}`

    if (estado === 'paid') {
      await tx`
        select public.emit_event('ar.invoice.paid',
          ${JSON.stringify({ invoiceId })}::text::jsonb, 'ar')`
    }

    return 'ok'
  })

  if (res === 'no-existe') return { ok: false, error: 'Esa factura no existe.' }
  if (res === 'anulada') return { ok: false, error: 'Esa factura esta anulada.' }
  if (res !== 'ok') return { ok: false, error: res }

  revalidatePath('/cobrar')
  revalidatePath(`/cobrar/${invoiceId}`)
  return { ok: true }
}

/** Anula la factura. No borra: la marca con motivo, como todo en el sistema. */
export async function anularFactura(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ar', 'ar.invoice.void')
  if (!permiso.ok) return permiso

  const invoiceId = String(fd.get('invoiceId') ?? '')
  const motivo = String(fd.get('reason') ?? '').trim()
  if (!invoiceId) return { ok: false, error: 'Faltan datos.' }
  if (motivo.length < 4) return { ok: false, error: 'Escribe el motivo de la anulacion.' }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [cobrado] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.customer_payments
      where invoice_id = ${invoiceId} and tenant_id = ${ctx.tenantId}`
    // Una factura con cobros no se anula: se emite una nota de credito. Si
    // se anulara, el dinero recibido quedaria sin documento que lo respalde.
    if (Number(cobrado!.n) > 0) return 'con-cobros'

    await tx`
      update public.customer_invoices
      set status = 'void', void_reason = ${motivo}
      where id = ${invoiceId} and tenant_id = ${ctx.tenantId} and status <> 'void'`
    return 'ok'
  })

  if (res === 'con-cobros') {
    return {
      ok: false,
      error: 'Esta factura ya tiene cobros. Se anula con una nota de credito, no borrandola.',
    }
  }

  revalidatePath('/cobrar')
  return { ok: true }
}

/** Marca vencidas las que pasaron su fecha. Idempotente. */
export async function marcarVencidas(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ar', 'ar.view')
  if (!permiso.ok) return permiso

  await db()`select public.mark_overdue_invoices(${ctx.tenantId})`

  revalidatePath('/cobrar')
  revalidatePath('/cobrar/cartera')
  return { ok: true }
}

// ── Envoltorios para <form action> ─────────────────────────────────────
export async function facturarPedidoForm(fd: FormData): Promise<void> {
  await facturarPedido(fd)
}
export async function registrarCobroForm(fd: FormData): Promise<void> {
  await registrarCobro(fd)
}
export async function anularFacturaForm(fd: FormData): Promise<void> {
  await anularFactura(fd)
}
export async function marcarVencidasForm(fd: FormData): Promise<void> {
  await marcarVencidas(fd)
}
