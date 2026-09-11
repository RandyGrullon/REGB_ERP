'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/** Acciones de desempeno (modulo 66, F7/S42). */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const TIPOS_EVALUACION = ['self', 'manager', 'peer', 'direct_report']
const ESTADOS_PLAN = ['completed', 'cancelled']

const num = (raw: string): number | null => {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Crea un objetivo -de un empleado, o de toda la empresa si no se elige ninguno-. */
export async function crearObjetivo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'performance', 'performance.manage-objectives')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '') || null
  const title = String(fd.get('title') ?? '').trim()
  const period = String(fd.get('period') ?? '').trim()

  if (!title) return { ok: false, error: 'Escribe el titulo del objetivo.' }
  if (!period) return { ok: false, error: 'Escribe el periodo (ej. 2026-Q3).' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.performance_objectives (tenant_id, employee_id, title, period)
        values (${ctx.tenantId}, ${employeeId}, ${title}, ${period})`

      await tx`
        select public.emit_event('performance.objective.created',
          ${JSON.stringify({ employeeId, title })}::text::jsonb, 'performance')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/desempeno')
  return { ok: true }
}

/** Agrega un resultado clave a un objetivo. */
export async function crearResultadoClave(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'performance', 'performance.manage-objectives')
  if (!permiso.ok) return permiso

  const objectiveId = String(fd.get('objectiveId') ?? '')
  const description = String(fd.get('description') ?? '').trim()
  const targetValue = num(String(fd.get('targetValue') ?? ''))
  const unit = String(fd.get('unit') ?? '').trim() || null

  if (!objectiveId) return { ok: false, error: 'Falta el objetivo.' }
  if (!description) return { ok: false, error: 'Describe el resultado clave.' }
  if (targetValue === null) return { ok: false, error: 'La meta debe ser un numero.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.performance_key_results (tenant_id, objective_id, description, target_value, unit)
      values (${ctx.tenantId}, ${objectiveId}, ${description}, ${targetValue}, ${unit})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/desempeno')
  return { ok: true }
}

/** Actualiza el valor actual de un resultado clave -el progreso se deriva de esto, no se pide directamente-. */
export async function actualizarProgreso(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'performance', 'performance.manage-objectives')
  if (!permiso.ok) return permiso

  const keyResultId = String(fd.get('keyResultId') ?? '')
  const currentValue = num(String(fd.get('currentValue') ?? ''))
  if (!keyResultId) return { ok: false, error: 'Falta el resultado clave.' }
  if (currentValue === null) return { ok: false, error: 'El valor debe ser un numero.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      update public.performance_key_results set current_value = ${currentValue}, updated_at = now()
      where id = ${keyResultId} and tenant_id = ${ctx.tenantId}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/desempeno')
  return { ok: true }
}

/** Agenda un 1:1. */
export async function crearUnoAUno(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'performance', 'performance.manage-one-on-ones')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const scheduledAt = String(fd.get('scheduledAt') ?? '')
  if (!employeeId) return { ok: false, error: 'Elige el empleado.' }
  if (!scheduledAt) return { ok: false, error: 'Elige la fecha y hora.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.performance_one_on_ones (tenant_id, employee_id, scheduled_at)
      values (${ctx.tenantId}, ${employeeId}, ${scheduledAt})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/desempeno')
  return { ok: true }
}

/** Marca un 1:1 como realizado, con sus notas y compromisos. */
export async function completarUnoAUno(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'performance', 'performance.manage-one-on-ones')
  if (!permiso.ok) return permiso

  const recordId = String(fd.get('recordId') ?? '')
  const notes = String(fd.get('notes') ?? '').trim() || null
  const actionItems = String(fd.get('actionItems') ?? '').trim() || null
  if (!recordId) return { ok: false, error: 'Falta el 1:1.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      update public.performance_one_on_ones
      set status = 'completed', notes = ${notes}, action_items = ${actionItems}, updated_at = now()
      where id = ${recordId} and tenant_id = ${ctx.tenantId}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/desempeno')
  return { ok: true }
}

/** Envia una evaluacion -queda fija desde el momento en que se envia-. */
export async function enviarEvaluacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'performance', 'performance.submit-review')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const cycle = String(fd.get('cycle') ?? '').trim()
  const reviewType = String(fd.get('reviewType') ?? '')
  const reviewerName = String(fd.get('reviewerName') ?? '').trim() || null
  const rating = Number.parseInt(String(fd.get('rating') ?? ''), 10)
  const comments = String(fd.get('comments') ?? '').trim() || null

  if (!employeeId) return { ok: false, error: 'Elige el empleado.' }
  if (!cycle) return { ok: false, error: 'Escribe el ciclo (ej. 2026-Q3).' }
  if (!TIPOS_EVALUACION.includes(reviewType)) return { ok: false, error: 'Elige un tipo valido.' }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'La calificacion debe ser un numero de 1 a 5.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.performance_reviews
          (tenant_id, employee_id, cycle, review_type, reviewer_name, rating, comments)
        values (${ctx.tenantId}, ${employeeId}, ${cycle}, ${reviewType}, ${reviewerName}, ${rating}, ${comments})`

      await tx`
        select public.emit_event('performance.review.submitted',
          ${JSON.stringify({ employeeId, cycle, reviewType })}::text::jsonb, 'performance')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/desempeno')
  return { ok: true }
}

/** Crea un plan de mejora. */
export async function crearPlanMejora(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'performance', 'performance.manage-improvement-plans')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const reason = String(fd.get('reason') ?? '').trim()
  const goals = String(fd.get('goals') ?? '').trim() || null
  const startDate = String(fd.get('startDate') ?? '')
  const endDate = String(fd.get('endDate') ?? '')

  if (!employeeId) return { ok: false, error: 'Elige el empleado.' }
  if (!reason) return { ok: false, error: 'Escribe el motivo.' }
  if (!startDate || !endDate) return { ok: false, error: 'Elige las fechas.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.performance_improvement_plans
          (tenant_id, employee_id, reason, goals, start_date, end_date)
        values (${ctx.tenantId}, ${employeeId}, ${reason}, ${goals}, ${startDate}, ${endDate})`

      await tx`
        select public.emit_event('performance.improvement-plan.created',
          ${JSON.stringify({ employeeId })}::text::jsonb, 'performance')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/desempeno')
  return { ok: true }
}

/** Cierra un plan de mejora -completado o cancelado-. */
export async function resolverPlanMejora(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'performance', 'performance.manage-improvement-plans')
  if (!permiso.ok) return permiso

  const recordId = String(fd.get('recordId') ?? '')
  const status = String(fd.get('status') ?? '')
  if (!recordId) return { ok: false, error: 'Falta el plan.' }
  if (!ESTADOS_PLAN.includes(status)) return { ok: false, error: 'Estado invalido.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [row] = await tx<{ status: string }[]>`
        select status from public.performance_improvement_plans
        where id = ${recordId} and tenant_id = ${ctx.tenantId}`
      if (!row) throw new Error('Ese plan no existe.')
      if (row.status !== 'active') throw new Error('Ese plan ya fue resuelto.')

      await tx`
        update public.performance_improvement_plans set status = ${status}, updated_at = now()
        where id = ${recordId} and tenant_id = ${ctx.tenantId}`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/desempeno')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearObjetivoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearObjetivo(fd), 'crearObjetivo')
}
export async function crearResultadoClaveForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearResultadoClave(fd), 'crearResultadoClave')
}
export async function actualizarProgresoForm(fd: FormData): Promise<void> {
  await anotarAviso(await actualizarProgreso(fd), 'actualizarProgreso')
}
export async function crearUnoAUnoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearUnoAUno(fd), 'crearUnoAUno')
}
export async function completarUnoAUnoForm(fd: FormData): Promise<void> {
  await anotarAviso(await completarUnoAUno(fd), 'completarUnoAUno')
}
export async function enviarEvaluacionForm(fd: FormData): Promise<void> {
  await anotarAviso(await enviarEvaluacion(fd), 'enviarEvaluacion')
}
export async function crearPlanMejoraForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearPlanMejora(fd), 'crearPlanMejora')
}
export async function resolverPlanMejoraForm(fd: FormData): Promise<void> {
  await anotarAviso(await resolverPlanMejora(fd), 'resolverPlanMejora')
}
