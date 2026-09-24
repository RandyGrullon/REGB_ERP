'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { mensajeLegible, sinExcepciones } from '@/lib/accion-segura'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de pasarelas de cobro (modulo 27, F6/S34).
 *
 * Confirmar un pago delega TODO en mark_payment_link_paid() (0050): sin
 * pasarela real conectada, es siempre una decision humana -el dinero ya
 * llego por el canal que sea, esto solo lo registra-.
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

/** Genera un link de cobro. */
export async function crearLink(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'payments', 'payments.link.create')
  if (!permiso.ok) return permiso

  const customerId = String(fd.get('customerId') ?? '') || null
  const amount = num(String(fd.get('amount') ?? ''))
  const description = String(fd.get('description') ?? '').trim()
  const expiresAt = String(fd.get('expiresAt') ?? '').trim() || null

  if (amount === null || amount <= 0)
    return { ok: false, error: 'El monto debe ser mayor que cero.' }
  if (description.length < 3) return { ok: false, error: 'Describe el cobro.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.payment_links (tenant_id, customer_id, amount, description, expires_at)
        values (${ctx.tenantId}, ${customerId}, ${amount}, ${description}, ${expiresAt})`

      await tx`
        select public.emit_event('payments.link.created',
          ${JSON.stringify({ amount, description })}::text::jsonb, 'payments')`
    })
  } catch (e) {
    return { ok: false, error: mensajeLegible(e) }
  }

  revalidatePath('/cobros')
  return { ok: true }
}

/** Confirma que un link ya se pago -de forma manual, por el canal que sea-. */
export async function confirmarPago(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'payments', 'payments.link.confirm')
  if (!permiso.ok) return permiso

  const linkId = String(fd.get('linkId') ?? '')
  const amount = num(String(fd.get('paidAmount') ?? ''))
  if (!linkId) return { ok: false, error: 'Falta el link.' }
  if (amount === null || amount <= 0)
    return { ok: false, error: 'El monto pagado debe ser mayor que cero.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`select public.mark_payment_link_paid(${linkId}, ${amount})`
      await tx`
        select public.emit_event('payments.link.paid',
          ${JSON.stringify({ linkId, amount })}::text::jsonb, 'payments')`
    })
  } catch (e) {
    return { ok: false, error: mensajeLegible(e) }
  }

  revalidatePath('/cobros')
  return { ok: true }
}

/** Cancela un link pendiente. */
export async function cancelarLink(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('cancelarLink', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'payments', 'payments.link.confirm')
    if (!permiso.ok) return permiso

    const linkId = String(fd.get('linkId') ?? '')
    if (!linkId) return { ok: false, error: 'Falta el link.' }

    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      update public.payment_links set status = 'canceled'
      where id = ${linkId} and tenant_id = ${ctx.tenantId} and status = 'pending'`,
    )

    revalidatePath('/cobros')
    return { ok: true }
  })
}

/** Crea un cobro recurrente. */
export async function crearRecurrente(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'payments', 'payments.recurring.create')
  if (!permiso.ok) return permiso

  const customerId = String(fd.get('customerId') ?? '')
  const amount = num(String(fd.get('amount') ?? ''))
  const description = String(fd.get('description') ?? '').trim()
  const frequency = String(fd.get('frequency') ?? 'monthly')
  const nextChargeDate = String(fd.get('nextChargeDate') ?? '').trim()

  if (!customerId) return { ok: false, error: 'Elige el cliente.' }
  if (amount === null || amount <= 0)
    return { ok: false, error: 'El monto debe ser mayor que cero.' }
  if (description.length < 3) return { ok: false, error: 'Describe el cobro.' }
  if (!['weekly', 'monthly', 'yearly'].includes(frequency)) {
    return { ok: false, error: 'Frecuencia no valida.' }
  }
  if (!nextChargeDate) return { ok: false, error: 'Falta la fecha del proximo cobro.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.recurring_charges
        (tenant_id, customer_id, amount, description, frequency, next_charge_date)
      values (${ctx.tenantId}, ${customerId}, ${amount}, ${description}, ${frequency}, ${nextChargeDate})`,
    )
  } catch (e) {
    return { ok: false, error: mensajeLegible(e) }
  }

  revalidatePath('/cobros')
  return { ok: true }
}

/** Genera los links de los cobros recurrentes ya vencidos. */
export async function correrRecurrentes(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('correrRecurrentes', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'payments', 'payments.recurring.create')
    if (!permiso.ok) return permiso

    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`select public.run_recurring_charges(${ctx.tenantId})`,
    )

    revalidatePath('/cobros')
    return { ok: true }
  })
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearLinkForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearLink(fd), 'crearLink')
}
export async function confirmarPagoForm(fd: FormData): Promise<void> {
  await anotarAviso(await confirmarPago(fd), 'confirmarPago')
}
export async function cancelarLinkForm(fd: FormData): Promise<void> {
  await anotarAviso(await cancelarLink(fd), 'cancelarLink')
}
export async function crearRecurrenteForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearRecurrente(fd), 'crearRecurrente')
}
export async function correrRecurrentesForm(fd: FormData): Promise<void> {
  await anotarAviso(await correrRecurrentes(fd), 'correrRecurrentes')
}
