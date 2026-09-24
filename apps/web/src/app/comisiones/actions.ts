'use server'

import { revalidatePath } from 'next/cache'
import {
  calcularComision,
  transicionValidaComision,
  type EsquemaComision,
  type EstadoComision,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Comisiones (modulo 34, F9/S57).
 *
 * `calcularComision()` es la unica formula -porcentaje sobre una base
 * o monto fijo-, calculada una vez al crear la entrada, no
 * recalculada despues. `transicionValidaComision()` exige aprobar
 * antes de pagar.
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

export async function crearPlan(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'commissions', 'commissions.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const basis = String(fd.get('basis') ?? '') as EsquemaComision
  const rate = num(String(fd.get('rate') ?? ''))

  if (!name) return { ok: false, error: 'Ponle un nombre al plan.' }
  if (!['percentage', 'fixed'].includes(basis))
    return { ok: false, error: 'Elige un esquema valido.' }
  if (rate === null || rate <= 0) return { ok: false, error: 'La tasa debe ser mayor que cero.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.commission_plans (tenant_id, name, basis, rate)
    values (${ctx.tenantId}, ${name}, ${basis}, ${rate})`,
  )

  revalidatePath('/comisiones/planes')
  return { ok: true }
}

export async function crearEntrada(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'commissions', 'commissions.manage')
  if (!permiso.ok) return permiso

  const planId = String(fd.get('planId') ?? '')
  const salesOrderId = String(fd.get('salesOrderId') ?? '')
  const salespersonId = String(fd.get('salespersonId') ?? '')

  if (!planId || !salesOrderId || !salespersonId)
    return { ok: false, error: 'Falta el plan, la orden o el vendedor.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [plan] = await tx<{ basis: EsquemaComision; rate: string }[]>`
      select basis, rate::text from public.commission_plans where id = ${planId} and tenant_id = ${ctx.tenantId}`
    if (!plan) return 'Ese plan no existe.'

    const [orden] = await tx<{ total: string }[]>`
      select total::text from public.sales_orders where id = ${salesOrderId} and tenant_id = ${ctx.tenantId}`
    if (!orden) return 'Esa orden de venta no existe.'

    const baseAmount = Number(orden.total)
    const commissionAmount = calcularComision(baseAmount, Number(plan.rate), plan.basis)

    await tx`
      insert into public.commission_entries (tenant_id, plan_id, sales_order_id, salesperson_id, base_amount, commission_amount)
      values (${ctx.tenantId}, ${planId}, ${salesOrderId}, ${salespersonId}, ${baseAmount}, ${commissionAmount})`

    return 'ok'
  })

  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/comisiones')
  return { ok: true }
}

/** Avanza el estado de una comision -pending/approved/rejected/paid-. */
export async function transicionarEntrada(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'commissions', 'commissions.manage')
  if (!permiso.ok) return permiso

  const entryId = String(fd.get('entryId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoComision

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [e] = await tx<{ status: EstadoComision }[]>`
      select status from public.commission_entries where id = ${entryId} and tenant_id = ${ctx.tenantId} for update`
    if (!e) return 'no-existe'
    if (!transicionValidaComision(e.status, siguiente)) return 'Esa transicion no esta permitida.'

    const aprobando = siguiente === 'approved'
    const pagando = siguiente === 'paid'
    await tx`
      update public.commission_entries
      set status = ${siguiente}, updated_at = now(),
          approved_at = case when ${aprobando} then now() else approved_at end,
          paid_at = case when ${pagando} then now() else paid_at end
      where id = ${entryId} and tenant_id = ${ctx.tenantId}`

    if (siguiente === 'approved' || siguiente === 'paid') {
      await tx`
        select public.emit_event(${`commissions.entry.${siguiente}`},
          ${JSON.stringify({ entryId })}::text::jsonb, 'commissions')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa comision no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/comisiones')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearPlanForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearPlan(fd), 'crearPlan')
}
export async function crearEntradaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearEntrada(fd), 'crearEntrada')
}
export async function transicionarEntradaForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarEntrada(fd), 'transicionarEntrada')
}
