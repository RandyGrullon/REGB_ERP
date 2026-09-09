'use server'

import { revalidatePath } from 'next/cache'
import { transicionValidaRegistroTiempo, type EstadoRegistroTiempo } from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Hojas de tiempo (modulo 72, F10/S67).
 *
 * Rechazado no es el final: se corrige y se reenvia. Solo aprobado es
 * terminal de verdad -impedir_editar_registro_aprobado() lo respalda
 * a nivel de base de datos-.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function crearRegistro(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'timesheets', 'timesheets.manage')
  if (!permiso.ok) return permiso

  const taskId = String(fd.get('taskId') ?? '')
  const entryDate = String(fd.get('entryDate') ?? '')
  const hours = Number(fd.get('hours') ?? '')
  const billable = fd.get('billable') === 'on'
  const hourlyRate = Number(fd.get('hourlyRate') ?? '0') || 0
  const notes = String(fd.get('notes') ?? '').trim() || null

  if (!taskId) return { ok: false, error: 'Elige la tarea.' }
  if (!entryDate) return { ok: false, error: 'Falta la fecha.' }
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return { ok: false, error: 'Las horas deben estar entre 0 y 24.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.time_entries (tenant_id, task_id, user_id, entry_date, hours, billable, hourly_rate, notes)
    values (${ctx.tenantId}, ${taskId}, ${ctx.userId}, ${entryDate}, ${hours}, ${billable}, ${hourlyRate}, ${notes})`)

  revalidatePath('/hojas-de-tiempo')
  return { ok: true }
}

export async function transicionarRegistro(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'timesheets', 'timesheets.manage')
  if (!permiso.ok) return permiso

  const entryId = String(fd.get('entryId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoRegistroTiempo

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [e] = await tx<{ status: EstadoRegistroTiempo }[]>`
      select status from public.time_entries where id = ${entryId} and tenant_id = ${ctx.tenantId} for update`
    if (!e) return 'no-existe'
    if (!transicionValidaRegistroTiempo(e.status, siguiente)) return 'Esa transicion no esta permitida.'

    const aprobando = siguiente === 'approved'
    await tx`
      update public.time_entries
      set status = ${siguiente}, updated_at = now(),
          approved_by = case when ${aprobando} then ${ctx.userId} else approved_by end,
          approved_at = case when ${aprobando} then now() else approved_at end
      where id = ${entryId} and tenant_id = ${ctx.tenantId}`

    if (aprobando) {
      await tx`
        select public.emit_event('timesheets.entry.approved',
          ${JSON.stringify({ entryId })}::text::jsonb, 'timesheets')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese registro no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/hojas-de-tiempo')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearRegistroForm(fd: FormData): Promise<void> {
  await crearRegistro(fd)
}
export async function transicionarRegistroForm(fd: FormData): Promise<void> {
  await transicionarRegistro(fd)
}
