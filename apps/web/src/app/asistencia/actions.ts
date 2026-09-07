'use server'

import { revalidatePath } from 'next/cache'
import { isWithinGeofence } from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de asistencia (modulo 63, F7/S39).
 *
 * `within_geofence` se calcula UNA vez, aqui, con isWithinGeofence()
 * (@regb/operations) -nunca en SQL- y se guarda como hecho historico: la
 * cerca puede cambiar de radio despues sin que el marcaje de ayer se lea
 * distinto.
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

/** Marca entrada. Si hay coordenadas y una geocerca para la sucursal elegida, valida contra ella. */
export async function marcarEntrada(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'attendance', 'attendance.check-in')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const branchId = String(fd.get('branchId') ?? '') || null
  const lat = num(String(fd.get('lat') ?? ''))
  const lng = num(String(fd.get('lng') ?? ''))

  if (!employeeId) return { ok: false, error: 'Elige el empleado.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      let method = 'manual'
      let withinGeofence: boolean | null = null

      if (lat !== null && lng !== null && branchId) {
        const [geo] = await tx<{ latitude: string; longitude: string; radius_meters: number }[]>`
          select latitude::text, longitude::text, radius_meters from public.attendance_geofences
          where tenant_id = ${ctx.tenantId} and branch_id = ${branchId}`
        if (geo) {
          withinGeofence = isWithinGeofence(lat, lng, Number(geo.latitude), Number(geo.longitude), geo.radius_meters)
          method = 'geofence'
        }
      }

      await tx`
        insert into public.attendance_records
          (tenant_id, employee_id, check_in, check_in_method, check_in_lat, check_in_lng, within_geofence)
        values (${ctx.tenantId}, ${employeeId}, now(), ${method}, ${lat}, ${lng}, ${withinGeofence})`

      await tx`
        select public.emit_event('attendance.record.checked-in',
          ${JSON.stringify({ employeeId, method })}::text::jsonb, 'attendance')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
      return { ok: false, error: 'Ese empleado ya tiene un marcaje abierto: primero registra su salida.' }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/asistencia')
  return { ok: true }
}

/** Marca salida de un marcaje abierto. */
export async function marcarSalida(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'attendance', 'attendance.check-in')
  if (!permiso.ok) return permiso

  const recordId = String(fd.get('recordId') ?? '')
  if (!recordId) return { ok: false, error: 'Falta el marcaje.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`select public.check_out_attendance(${recordId})`
      await tx`
        select public.emit_event('attendance.record.checked-out',
          ${JSON.stringify({ recordId })}::text::jsonb, 'attendance')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/asistencia')
  return { ok: true }
}

/** Registra la geocerca de una sucursal -o la reemplaza si ya existia-. */
export async function guardarGeocerca(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'attendance', 'attendance.geofence.manage')
  if (!permiso.ok) return permiso

  const branchId = String(fd.get('branchId') ?? '')
  const lat = num(String(fd.get('lat') ?? ''))
  const lng = num(String(fd.get('lng') ?? ''))
  const radius = Number.parseInt(String(fd.get('radius') ?? ''), 10)

  if (!branchId) return { ok: false, error: 'Elige la sucursal.' }
  if (lat === null || lng === null) return { ok: false, error: 'Las coordenadas no son validas.' }
  if (!Number.isInteger(radius) || radius <= 0) return { ok: false, error: 'El radio debe ser mayor que cero.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.attendance_geofences (tenant_id, branch_id, latitude, longitude, radius_meters)
      values (${ctx.tenantId}, ${branchId}, ${lat}, ${lng}, ${radius})
      on conflict (tenant_id, branch_id)
      do update set latitude = excluded.latitude, longitude = excluded.longitude, radius_meters = excluded.radius_meters`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/asistencia/geocercas')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function marcarEntradaForm(fd: FormData): Promise<void> {
  await marcarEntrada(fd)
}
export async function marcarSalidaForm(fd: FormData): Promise<void> {
  await marcarSalida(fd)
}
export async function guardarGeocercaForm(fd: FormData): Promise<void> {
  await guardarGeocerca(fd)
}
