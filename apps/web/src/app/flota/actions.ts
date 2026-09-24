'use server'

import { revalidatePath } from 'next/cache'
import { transicionValidaMulta, type EstadoMulta } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/** Acciones de flota y vehiculos (modulo 54, F8/S49). */

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

/** Registra un vehiculo nuevo. */
export async function crearVehiculo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'fleet', 'fleet.manage')
  if (!permiso.ok) return permiso

  const plate = String(fd.get('plate') ?? '')
    .trim()
    .toUpperCase()
  const brand = String(fd.get('brand') ?? '').trim()
  const model = String(fd.get('model') ?? '').trim()
  const year = num(String(fd.get('year') ?? ''))
  const driverId = String(fd.get('driverId') ?? '') || null

  if (!plate) return { ok: false, error: 'Escribe la placa.' }
  if (!brand) return { ok: false, error: 'Escribe la marca.' }
  if (!model) return { ok: false, error: 'Escribe el modelo.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.vehicles (tenant_id, plate, brand, model, year, assigned_driver_id)
      values (${ctx.tenantId}, ${plate}, ${brand}, ${model}, ${year}, ${driverId})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/flota')
  return { ok: true }
}

/** Registra un documento del vehiculo -licencia, seguro o inspeccion-. */
export async function registrarDocumento(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'fleet', 'fleet.manage')
  if (!permiso.ok) return permiso

  const vehicleId = String(fd.get('vehicleId') ?? '')
  const docType = String(fd.get('docType') ?? '')
  const expiryDate = String(fd.get('expiryDate') ?? '')
  if (!vehicleId) return { ok: false, error: 'Falta el vehiculo.' }
  if (!['license', 'insurance', 'inspection'].includes(docType)) {
    return { ok: false, error: 'Tipo de documento invalido.' }
  }
  if (!expiryDate) return { ok: false, error: 'Escribe la fecha de vencimiento.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.vehicle_documents (tenant_id, vehicle_id, doc_type, expiry_date)
      values (${ctx.tenantId}, ${vehicleId}, ${docType}, ${expiryDate})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/flota/${vehicleId}`)
  return { ok: true }
}

/** Registra una carga de combustible -actualiza el kilometraje del vehiculo-. */
export async function registrarCombustible(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'fleet', 'fleet.manage')
  if (!permiso.ok) return permiso

  const vehicleId = String(fd.get('vehicleId') ?? '')
  const driverId = String(fd.get('driverId') ?? '') || null
  const liters = num(String(fd.get('liters') ?? ''))
  const cost = num(String(fd.get('cost') ?? ''))
  const odometerKm = num(String(fd.get('odometerKm') ?? ''))

  if (!vehicleId) return { ok: false, error: 'Falta el vehiculo.' }
  if (liters === null || liters <= 0)
    return { ok: false, error: 'Los litros deben ser mayor que cero.' }
  if (cost === null || cost < 0) return { ok: false, error: 'El costo no es valido.' }
  if (odometerKm === null || odometerKm < 0)
    return { ok: false, error: 'El kilometraje no es valido.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.fuel_logs (tenant_id, vehicle_id, driver_id, liters, cost, odometer_km)
        values (${ctx.tenantId}, ${vehicleId}, ${driverId}, ${liters}, ${cost}, ${odometerKm})`

      await tx`
        update public.vehicles set odometer_km = greatest(odometer_km, ${odometerKm}), updated_at = now()
        where id = ${vehicleId} and tenant_id = ${ctx.tenantId}`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/flota/${vehicleId}`)
  return { ok: true }
}

/** Registra un mantenimiento -actualiza el kilometraje del vehiculo-. */
export async function registrarMantenimiento(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'fleet', 'fleet.manage')
  if (!permiso.ok) return permiso

  const vehicleId = String(fd.get('vehicleId') ?? '')
  const type = String(fd.get('type') ?? '')
  const description = String(fd.get('description') ?? '').trim()
  const cost = num(String(fd.get('cost') ?? '')) ?? 0
  const odometerKm = num(String(fd.get('odometerKm') ?? ''))
  const nextDueKm = num(String(fd.get('nextDueKm') ?? ''))

  if (!vehicleId) return { ok: false, error: 'Falta el vehiculo.' }
  if (!['preventive', 'corrective'].includes(type)) return { ok: false, error: 'Tipo invalido.' }
  if (!description) return { ok: false, error: 'Describe el mantenimiento.' }
  if (odometerKm === null || odometerKm < 0)
    return { ok: false, error: 'El kilometraje no es valido.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.maintenance_records
          (tenant_id, vehicle_id, type, description, cost, odometer_km, next_due_km)
        values (${ctx.tenantId}, ${vehicleId}, ${type}, ${description}, ${cost}, ${odometerKm}, ${nextDueKm})`

      await tx`
        update public.vehicles
        set status = 'active', odometer_km = greatest(odometer_km, ${odometerKm}), updated_at = now()
        where id = ${vehicleId} and tenant_id = ${ctx.tenantId}`

      await tx`
        select public.emit_event('fleet.maintenance.recorded',
          ${JSON.stringify({ vehicleId })}::text::jsonb, 'fleet')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/flota/${vehicleId}`)
  revalidatePath('/flota')
  return { ok: true }
}

/** Registra una multa. */
export async function registrarMulta(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'fleet', 'fleet.fines.manage')
  if (!permiso.ok) return permiso

  const vehicleId = String(fd.get('vehicleId') ?? '')
  const driverId = String(fd.get('driverId') ?? '') || null
  const amount = num(String(fd.get('amount') ?? ''))
  const reason = String(fd.get('reason') ?? '').trim()

  if (!vehicleId) return { ok: false, error: 'Falta el vehiculo.' }
  if (amount === null || amount <= 0)
    return { ok: false, error: 'El monto debe ser mayor que cero.' }
  if (!reason) return { ok: false, error: 'Escribe la razon de la multa.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [f] = await tx<{ id: string }[]>`
        insert into public.traffic_fines (tenant_id, vehicle_id, driver_id, amount, reason)
        values (${ctx.tenantId}, ${vehicleId}, ${driverId}, ${amount}, ${reason})
        returning id`

      await tx`
        select public.emit_event('fleet.fine.registered',
          ${JSON.stringify({ vehicleId, fineId: f!.id })}::text::jsonb, 'fleet')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/flota/${vehicleId}`)
  return { ok: true }
}

/** Cambia el estado de una multa -pending/disputed son editables, paid/dismissed son terminales-. */
export async function resolverMulta(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'fleet', 'fleet.fines.manage')
  if (!permiso.ok) return permiso

  const fineId = String(fd.get('fineId') ?? '')
  const vehicleId = String(fd.get('vehicleId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoMulta
  if (!fineId) return { ok: false, error: 'Falta la multa.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [multa] = await tx<{ status: string }[]>`
      select status from public.traffic_fines where id = ${fineId} and tenant_id = ${ctx.tenantId}`
    if (!multa) return 'no-existe'
    if (!transicionValidaMulta(multa.status as EstadoMulta, siguiente)) {
      return 'Esa transicion no es valida desde el estado actual.'
    }

    await tx`
      update public.traffic_fines
      set status = ${siguiente}, resolved_at = ${siguiente === 'paid' || siguiente === 'dismissed' ? new Date() : null},
          updated_at = now()
      where id = ${fineId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa multa no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/flota/${vehicleId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearVehiculoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearVehiculo(fd), 'crearVehiculo')
}
export async function registrarDocumentoForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarDocumento(fd), 'registrarDocumento')
}
export async function registrarCombustibleForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarCombustible(fd), 'registrarCombustible')
}
export async function registrarMantenimientoForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarMantenimiento(fd), 'registrarMantenimiento')
}
export async function registrarMultaForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarMulta(fd), 'registrarMulta')
}
export async function resolverMultaForm(fd: FormData): Promise<void> {
  await anotarAviso(await resolverMulta(fd), 'resolverMulta')
}
