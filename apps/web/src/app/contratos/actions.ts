'use server'

import { revalidatePath } from 'next/cache'
import { calcularEscalamiento, transicionValidaContrato, type EstadoContrato } from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Contratos & Suscripciones (modulo 33, F9/S57).
 *
 * `calcularEscalamiento()` es la unica formula que decide el monto al
 * renovar. Renovar NO reabre el contrato -crea uno NUEVO en borrador
 * con `renewed_from_id` apuntando al anterior, que se marca
 * `renewed`-, el mismo criterio de versionado que `quotes`.
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

export async function crearContrato(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'contracts', 'contracts.manage')
  if (!permiso.ok) return permiso

  const customerId = String(fd.get('customerId') ?? '')
  const billingFrequency = String(fd.get('billingFrequency') ?? '')
  const startDate = String(fd.get('startDate') ?? '')
  const endDate = String(fd.get('endDate') ?? '')
  const baseAmount = num(String(fd.get('baseAmount') ?? ''))
  const escalationPct = num(String(fd.get('escalationPct') ?? '')) ?? 0
  const autoRenew = fd.get('autoRenew') === 'on'

  if (!customerId) return { ok: false, error: 'Elige el cliente.' }
  if (!['monthly', 'quarterly', 'annual'].includes(billingFrequency)) return { ok: false, error: 'Elige una frecuencia valida.' }
  if (!startDate || !endDate) return { ok: false, error: 'Falta la fecha de inicio o de fin.' }
  if (baseAmount === null || baseAmount <= 0) return { ok: false, error: 'El monto debe ser mayor que cero.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [n] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.contracts where tenant_id = ${ctx.tenantId}`
    const numero = `CTR-${String(Number(n!.n) + 1).padStart(4, '0')}`

    await tx`
      insert into public.contracts (tenant_id, contract_number, customer_id, billing_frequency, start_date, end_date, base_amount, escalation_pct, auto_renew, created_by)
      values (${ctx.tenantId}, ${numero}, ${customerId}, ${billingFrequency}, ${startDate}, ${endDate}, ${baseAmount}, ${escalationPct}, ${autoRenew}, ${ctx.userId})`
  })

  revalidatePath('/contratos')
  return { ok: true }
}

/** Avanza el estado del contrato -draft/active/cancelled/expired-. */
export async function transicionarContrato(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'contracts', 'contracts.manage')
  if (!permiso.ok) return permiso

  const contractId = String(fd.get('contractId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoContrato

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [c] = await tx<{ status: EstadoContrato }[]>`
      select status from public.contracts where id = ${contractId} and tenant_id = ${ctx.tenantId} for update`
    if (!c) return 'no-existe'
    if (!transicionValidaContrato(c.status, siguiente)) return 'Esa transicion no esta permitida.'

    const cancelando = siguiente === 'cancelled'
    await tx`
      update public.contracts
      set status = ${siguiente}, updated_at = now(),
          cancelled_at = case when ${cancelando} then now() else cancelled_at end
      where id = ${contractId} and tenant_id = ${ctx.tenantId}`

    if (siguiente === 'cancelled') {
      await tx`
        select public.emit_event('contracts.contract.cancelled',
          ${JSON.stringify({ contractId })}::text::jsonb, 'contracts')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese contrato no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/contratos/${contractId}`)
  revalidatePath('/contratos')
  return { ok: true }
}

/** Renueva el contrato: crea uno NUEVO en borrador con el monto escalado, marca el actual 'renewed'. */
export async function renovarContrato(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'contracts', 'contracts.manage')
  if (!permiso.ok) return permiso

  const contractId = String(fd.get('contractId') ?? '')

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [actual] = await tx<{
      status: EstadoContrato
      contract_number: string
      customer_id: string
      billing_frequency: string
      start_date: string
      end_date: string
      base_amount: string
      escalation_pct: string
      auto_renew: boolean
    }[]>`
      select status, contract_number, customer_id, billing_frequency, start_date::text, end_date::text,
             base_amount::text, escalation_pct::text, auto_renew
      from public.contracts where id = ${contractId} and tenant_id = ${ctx.tenantId} for update`
    if (!actual) return 'no-existe'
    if (!transicionValidaContrato(actual.status, 'renewed')) return 'Ese contrato no se puede renovar en su estado actual.'

    const duracionDias = Math.round(
      (new Date(actual.end_date).getTime() - new Date(actual.start_date).getTime()) / 86_400_000,
    )
    const nuevoInicio = new Date(actual.end_date)
    nuevoInicio.setDate(nuevoInicio.getDate() + 1)
    const nuevoFin = new Date(nuevoInicio)
    nuevoFin.setDate(nuevoFin.getDate() + duracionDias)
    const nuevoMonto = calcularEscalamiento(Number(actual.base_amount), Number(actual.escalation_pct))

    const [n] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.contracts where tenant_id = ${ctx.tenantId}`
    const numero = `CTR-${String(Number(n!.n) + 1).padStart(4, '0')}`

    await tx`
      insert into public.contracts
        (tenant_id, contract_number, customer_id, renewed_from_id, billing_frequency, start_date, end_date, base_amount, escalation_pct, auto_renew, created_by)
      values
        (${ctx.tenantId}, ${numero}, ${actual.customer_id}, ${contractId}, ${actual.billing_frequency},
         ${nuevoInicio.toISOString().slice(0, 10)}, ${nuevoFin.toISOString().slice(0, 10)},
         ${nuevoMonto}, ${actual.escalation_pct}, ${actual.auto_renew}, ${ctx.userId})`

    await tx`
      update public.contracts set status = 'renewed', updated_at = now()
      where id = ${contractId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('contracts.contract.renewed',
        ${JSON.stringify({ contractId })}::text::jsonb, 'contracts')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese contrato no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/contratos')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearContratoForm(fd: FormData): Promise<void> {
  await crearContrato(fd)
}
export async function transicionarContratoForm(fd: FormData): Promise<void> {
  await transicionarContrato(fd)
}
export async function renovarContratoForm(fd: FormData): Promise<void> {
  await renovarContrato(fd)
}
