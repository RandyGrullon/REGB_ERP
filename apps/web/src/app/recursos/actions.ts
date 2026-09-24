'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Planificacion de recursos (modulo 75, F10/S68).
 *
 * La sobrecarga no se guarda como bandera: se deriva sumando las horas
 * asignadas de la semana contra la capacidad -`estaSobrecargado()` en
 * @regb/operations-.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const horas = (raw: string): number | null => {
  const n = Number(raw.trim())
  return Number.isFinite(n) ? n : null
}

/** El lunes de la semana de una fecha -toda la planificacion se ancla al lunes-. */
function lunesDe(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  const dia = d.getUTCDay()
  const diff = dia === 0 ? -6 : 1 - dia
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

export async function fijarCapacidad(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'resources', 'resources.manage')
  if (!permiso.ok) return permiso

  const userId = String(fd.get('userId') ?? '')
  const semana = String(fd.get('weekStart') ?? '')
  const capacidad = horas(String(fd.get('hoursCapacity') ?? ''))

  if (!userId) return { ok: false, error: 'Elige la persona.' }
  if (!semana) return { ok: false, error: 'Falta la semana.' }
  if (capacidad === null || capacidad < 0 || capacidad > 168) {
    return { ok: false, error: 'La capacidad debe estar entre 0 y 168 horas.' }
  }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.resource_capacity (tenant_id, user_id, week_start, hours_capacity)
    values (${ctx.tenantId}, ${userId}, ${lunesDe(semana)}, ${capacidad})
    on conflict (tenant_id, user_id, week_start)
      do update set hours_capacity = excluded.hours_capacity`,
  )

  revalidatePath('/recursos')
  return { ok: true }
}

export async function asignar(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'resources', 'resources.manage')
  if (!permiso.ok) return permiso

  const taskId = String(fd.get('taskId') ?? '')
  const userId = String(fd.get('userId') ?? '')
  const semana = String(fd.get('weekStart') ?? '')
  const h = horas(String(fd.get('hours') ?? ''))

  if (!taskId) return { ok: false, error: 'Elige la tarea.' }
  if (!userId) return { ok: false, error: 'Elige la persona.' }
  if (!semana) return { ok: false, error: 'Falta la semana.' }
  if (h === null || h <= 0 || h > 168)
    return { ok: false, error: 'Las horas deben estar entre 0 y 168.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.resource_allocations (tenant_id, task_id, user_id, week_start, hours, created_by)
    values (${ctx.tenantId}, ${taskId}, ${userId}, ${lunesDe(semana)}, ${h}, ${ctx.userId})
    on conflict (tenant_id, task_id, user_id, week_start)
      do update set hours = excluded.hours, updated_at = now()`,
  )

  revalidatePath('/recursos')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function fijarCapacidadForm(fd: FormData): Promise<void> {
  await anotarAviso(await fijarCapacidad(fd), 'fijarCapacidad')
}
export async function asignarForm(fd: FormData): Promise<void> {
  await anotarAviso(await asignar(fd), 'asignar')
}
