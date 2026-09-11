'use server'

import { revalidatePath } from 'next/cache'
import { transicionValidaOrdenTrabajo, type EstadoOrdenTrabajo } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de mantenimiento / CMMS (modulo 59, F8.5/S53).
 *
 * `transicionValidaOrdenTrabajo()` valida la maquina de estados antes
 * de escribir -la base solo congela la orden una vez llega a un
 * estado terminal (completed/cancelled)-.
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

export async function crearEquipo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'maintenance', 'maintenance.manage')
  if (!permiso.ok) return permiso

  const code = String(fd.get('code') ?? '').trim()
  const name = String(fd.get('name') ?? '').trim()
  const location = String(fd.get('location') ?? '').trim() || null
  const intervaloUso = num(String(fd.get('maintenanceIntervalUsage') ?? ''))
  const intervaloDias = num(String(fd.get('maintenanceIntervalDays') ?? ''))

  if (!code || !name) return { ok: false, error: 'Ponle codigo y nombre al equipo.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.equipment (tenant_id, code, name, location, maintenance_interval_usage, maintenance_interval_days)
    values (${ctx.tenantId}, ${code}, ${name}, ${location}, ${intervaloUso}, ${intervaloDias})`)

  revalidatePath('/mantenimiento/equipos')
  return { ok: true }
}

/** Registra un servicio: pone al dia el uso y la fecha del ultimo mantenimiento. */
export async function registrarServicio(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'maintenance', 'maintenance.work')
  if (!permiso.ok) return permiso

  const equipmentId = String(fd.get('equipmentId') ?? '')
  const usageAtService = num(String(fd.get('usageAtService') ?? ''))
  if (usageAtService === null || usageAtService < 0) {
    return { ok: false, error: 'La lectura de uso debe ser un numero valido.' }
  }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    update public.equipment
    set usage_hours = ${usageAtService}, last_service_at = current_date, last_service_usage = ${usageAtService}, updated_at = now()
    where id = ${equipmentId} and tenant_id = ${ctx.tenantId}`)

  revalidatePath(`/mantenimiento/equipos/${equipmentId}`)
  revalidatePath('/mantenimiento/equipos')
  return { ok: true }
}

export async function crearOrden(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'maintenance', 'maintenance.work')
  if (!permiso.ok) return permiso

  const equipmentId = String(fd.get('equipmentId') ?? '')
  const type = String(fd.get('type') ?? '')
  const priority = String(fd.get('priority') ?? 'normal')
  const description = String(fd.get('description') ?? '').trim()

  if (!equipmentId) return { ok: false, error: 'Elige el equipo.' }
  if (!['preventive', 'corrective'].includes(type)) return { ok: false, error: 'Elige un tipo valido.' }
  if (!description) return { ok: false, error: 'Describe el problema o el trabajo a hacer.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [orden] = await tx<{ id: string }[]>`
      insert into public.work_orders (tenant_id, equipment_id, type, priority, description, requested_by)
      values (${ctx.tenantId}, ${equipmentId}, ${type}, ${priority}, ${description}, ${ctx.userId})
      returning id`
    await tx`
      select public.emit_event('maintenance.workorder.opened',
        ${JSON.stringify({ workOrderId: orden!.id, equipmentId, type })}::text::jsonb, 'maintenance')`
  })

  revalidatePath(`/mantenimiento/equipos/${equipmentId}`)
  revalidatePath('/mantenimiento')
  return { ok: true }
}

/** Avanza el estado de una orden de trabajo. */
export async function transicionarOrden(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'maintenance', 'maintenance.work')
  if (!permiso.ok) return permiso

  const ordenId = String(fd.get('ordenId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoOrdenTrabajo

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [orden] = await tx<{ status: EstadoOrdenTrabajo; equipment_id: string }[]>`
      select status, equipment_id from public.work_orders
      where id = ${ordenId} and tenant_id = ${ctx.tenantId} for update`
    if (!orden) return 'no-existe'
    if (!transicionValidaOrdenTrabajo(orden.status, siguiente)) {
      return 'Esa transicion no esta permitida.'
    }

    const completando = siguiente === 'completed'
    await tx`
      update public.work_orders
      set status = ${siguiente}, updated_at = now(),
          completed_at = case when ${completando} then now() else completed_at end
      where id = ${ordenId} and tenant_id = ${ctx.tenantId}`

    if (completando) {
      await tx`
        select public.emit_event('maintenance.workorder.completed',
          ${JSON.stringify({ workOrderId: ordenId })}::text::jsonb, 'maintenance')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa orden no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/mantenimiento/ordenes/${ordenId}`)
  revalidatePath('/mantenimiento')
  return { ok: true }
}

/** Registra un repuesto usado en la orden -no descuenta inventario, solo queda registrado-. */
export async function agregarParte(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'maintenance', 'maintenance.work')
  if (!permiso.ok) return permiso

  const ordenId = String(fd.get('ordenId') ?? '')
  const productId = String(fd.get('productId') ?? '')
  const qty = num(String(fd.get('qtyUsed') ?? ''))

  if (!productId) return { ok: false, error: 'Elige el repuesto.' }
  if (qty === null || qty <= 0) return { ok: false, error: 'La cantidad debe ser mayor que cero.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.work_order_parts (work_order_id, tenant_id, product_id, qty_used)
    values (${ordenId}, ${ctx.tenantId}, ${productId}, ${qty})`)

  revalidatePath(`/mantenimiento/ordenes/${ordenId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearEquipoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearEquipo(fd), 'crearEquipo')
}
export async function registrarServicioForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarServicio(fd), 'registrarServicio')
}
export async function crearOrdenForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearOrden(fd), 'crearOrden')
}
export async function transicionarOrdenForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarOrden(fd), 'transicionarOrden')
}
export async function agregarParteForm(fd: FormData): Promise<void> {
  await anotarAviso(await agregarParte(fd), 'agregarParte')
}
