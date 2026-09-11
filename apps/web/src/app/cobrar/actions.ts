'use server'

import { revalidatePath } from 'next/cache'
import {
  balanceAfter,
  daysOverdue,
  deriveInvoiceStatus,
  dueDateFrom,
  esMotivoDgii,
  isValidTaxId,
  lateFeeEligible,
  overpayment,
} from '@regb/operations'
import { asUser, db } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
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
        tax_id: string | null
      }[]
    >`
      select o.id, o.status, o.customer_id, c.payment_terms, c.tax_id,
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

    /**
     * Comprobante fiscal. Con RNC valido se emite credito fiscal (B01),
     * que es lo que le permite al cliente descontarse el ITBIS; sin el,
     * consumo (B02). Emitir B01 sin RNC lo rechaza la DGII en el 607.
     *
     * Si no hay secuencia autorizada, `assign_ncf` lanza y la factura NO
     * se crea: es preferible no facturar a facturar sin comprobante, que
     * es una factura invalida que hay que rehacer.
     */
    const tipo = order.tax_id && isValidTaxId(order.tax_id) ? 'B01' : 'B02'
    const [c] = await tx<{ assign_ncf: string }[]>`
      select public.assign_ncf(${ctx.tenantId}, ${tipo})`

    await tx`
      insert into public.customer_invoices
        (tenant_id, number, customer_id, source_type, source_id, issue_date, due_date,
         subtotal, discount, tax, total, created_by, ncf, ncf_type, buyer_tax_id)
      values (${ctx.tenantId}, ${n!.next_customer_invoice_number}, ${order.customer_id},
              'sales_order', ${orderId},
              ${emision.toISOString().slice(0, 10)}, ${vence.toISOString().slice(0, 10)},
              ${order.subtotal}, ${order.discount}, ${order.tax}, ${order.total}, ${ctx.userId},
              ${c!.assign_ncf}, ${tipo}, ${order.tax_id})`

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

/**
 * Aplica un cargo por mora, capturado a mano.
 *
 * NO hay formula: cuanto cobrar lo decide el negocio caso por caso, y esta
 * accion no calcula nada por su cuenta -solo valida que la factura sea
 * elegible (no anulada, no exenta, con dias de atraso) y deja el rastro de
 * con cuantos dias de atraso se decidio, para quien lo revise despues.
 *
 * Un cargo puede reabrir una factura ya "paid": el cliente termino de pagar
 * el capital, pero ahora debe el cargo que se decidio despues. Es correcto.
 */
export async function aplicarCargoPorMora(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ar', 'ar.latefee.apply')
  if (!permiso.ok) return permiso

  const invoiceId = String(fd.get('invoiceId') ?? '')
  const monto = num(String(fd.get('amount') ?? ''))
  const notas = String(fd.get('notes') ?? '').trim() || null
  if (!invoiceId) return { ok: false, error: 'Faltan datos.' }
  if (monto === null || monto <= 0) return { ok: false, error: 'El monto debe ser positivo.' }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [inv] = await tx<{ status: string; due_date: string; customer_exempt: boolean }[]>`
      select i.status, i.due_date::text, c.late_fee_exempt as customer_exempt
      from public.customer_invoices i
      join public.customers c on c.id = i.customer_id
      where i.id = ${invoiceId} and i.tenant_id = ${ctx.tenantId} for update`
    if (!inv) return 'no-existe'

    const dias = daysOverdue(new Date(`${inv.due_date}T12:00:00`), new Date())
    if (
      !lateFeeEligible(
        inv.status as 'open' | 'partially_paid' | 'paid' | 'overdue' | 'void',
        inv.customer_exempt,
        dias,
      )
    ) {
      return 'no-elegible'
    }

    await tx`
      insert into public.invoice_late_fees
        (tenant_id, invoice_id, amount, days_late_at_charge, notes, applied_by)
      values (${ctx.tenantId}, ${invoiceId}, ${monto}, ${dias}, ${notas}, ${ctx.userId})`

    // Recalcula el estado igual que un cobro, pero con el capital + TODA la
    // mora acumulada -no solo la de este cargo- contra lo cobrado.
    const [totales] = await tx<{ total: string; mora: string; cobrado: string }[]>`
      select i.total::text,
             coalesce((select sum(f.amount) from public.invoice_late_fees f
                        where f.invoice_id = i.id), 0)::text as mora,
             coalesce((select sum(p.amount) from public.customer_payments p
                        where p.invoice_id = i.id), 0)::text as cobrado
      from public.customer_invoices i where i.id = ${invoiceId}`
    const estado = deriveInvoiceStatus(
      Number(totales!.total) + Number(totales!.mora),
      Number(totales!.cobrado),
      new Date(`${inv.due_date}T12:00:00`),
      new Date(),
    )
    await tx`
      update public.customer_invoices set status = ${estado}
      where id = ${invoiceId} and tenant_id = ${ctx.tenantId}`

    return 'ok'
  })

  if (res === 'no-existe') return { ok: false, error: 'Esa factura no existe.' }
  if (res === 'no-elegible') {
    return {
      ok: false,
      error: 'Este cliente esta exento de mora, la factura esta anulada, o no tiene dias de atraso.',
    }
  }
  if (res !== 'ok') return { ok: false, error: res }

  revalidatePath('/cobrar')
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
  // El codigo se declara en el 608; el texto explica. Los dos.
  const codigo = String(fd.get('voidType') ?? '').trim()
  if (!invoiceId) return { ok: false, error: 'Faltan datos.' }
  if (motivo.length < 4) return { ok: false, error: 'Escribe el motivo de la anulacion.' }
  if (!esMotivoDgii(codigo)) {
    return {
      ok: false,
      error: 'Elige el motivo que pide la DGII: sin el, la factura no se puede declarar en el 608.',
    }
  }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [cobrado] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.customer_payments
      where invoice_id = ${invoiceId} and tenant_id = ${ctx.tenantId}`
    // Una factura con cobros no se anula: se emite una nota de credito. Si
    // se anulara, el dinero recibido quedaria sin documento que lo respalde.
    if (Number(cobrado!.n) > 0) return 'con-cobros'

    await tx`
      update public.customer_invoices
      set status = 'void', void_type = ${codigo}, void_reason = ${motivo}
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

/**
 * Marca o desmarca a un cliente como exento de cargos por mora. Es una
 * decision del negocio (relacion, volumen, acuerdo) y queda fija hasta que
 * alguien la cambie a mano — no se calcula sola por comportamiento.
 */
export async function alternarExentoMora(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ar', 'ar.latefee.apply')
  if (!permiso.ok) return permiso

  const id = String(fd.get('id') ?? '')
  if (!id) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.customers set late_fee_exempt = not late_fee_exempt, updated_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath('/pedidos/clientes')
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
  await anotarAviso(await facturarPedido(fd), 'facturarPedido')
}
export async function registrarCobroForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarCobro(fd), 'registrarCobro')
}
export async function anularFacturaForm(fd: FormData): Promise<void> {
  await anotarAviso(await anularFactura(fd), 'anularFactura')
}
export async function aplicarCargoPorMoraForm(fd: FormData): Promise<void> {
  await anotarAviso(await aplicarCargoPorMora(fd), 'aplicarCargoPorMora')
}
export async function alternarExentoMoraForm(fd: FormData): Promise<void> {
  await anotarAviso(await alternarExentoMora(fd), 'alternarExentoMora')
}
export async function marcarVencidasForm(fd: FormData): Promise<void> {
  await anotarAviso(await marcarVencidas(fd), 'marcarVencidas')
}
