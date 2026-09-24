'use server'

import { revalidatePath } from 'next/cache'
import { diasLaborablesEntre } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'
import { ErrorVacaciones, revisarVacaciones } from './saldo'

/**
 * Acciones de vacaciones y permisos (modulo 64, F7/S39).
 *
 * `business_days` se calcula UNA vez, aqui, con diasLaborablesEntre()
 * (@regb/operations) -nunca en SQL- y se guarda como hecho historico.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const TIPOS = ['vacation', 'sick', 'personal', 'maternity', 'paternity', 'bereavement', 'other']

/** Registra una solicitud de ausencia -queda en `pending` hasta que alguien la resuelva-. */
export async function solicitarAusencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'time-off', 'time-off.request')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const leaveType = String(fd.get('leaveType') ?? '')
  const startRaw = String(fd.get('startDate') ?? '')
  const endRaw = String(fd.get('endDate') ?? '')
  const reason = String(fd.get('reason') ?? '').trim() || null

  if (!employeeId) return { ok: false, error: 'Elige el empleado.' }
  if (!TIPOS.includes(leaveType)) return { ok: false, error: 'Elige un tipo de ausencia valido.' }
  if (!startRaw || !endRaw) return { ok: false, error: 'Elige las fechas.' }

  const inicio = new Date(`${startRaw}T00:00:00`)
  const fin = new Date(`${endRaw}T00:00:00`)
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    return { ok: false, error: 'Las fechas no son validas.' }
  }
  if (fin < inicio)
    return { ok: false, error: 'La fecha de fin no puede ser antes que la de inicio.' }

  const businessDays = diasLaborablesEntre(inicio, fin)
  if (businessDays === 0) {
    return { ok: false, error: 'El rango elegido no incluye ningun dia laborable.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      // Que no se cruce con otra ausencia y que las vacaciones quepan en el
      // saldo, contando lo pendiente como reservado (0138).
      const problema = await revisarVacaciones(tx, ctx.tenantId, {
        employeeId,
        tipo: leaveType,
        inicio: startRaw,
        fin: endRaw,
        dias: businessDays,
        contarPendientes: true,
      })
      if (problema) throw new ErrorVacaciones(problema)

      await tx`
        insert into public.time_off_requests
          (tenant_id, employee_id, leave_type, start_date, end_date, business_days, reason)
        values (${ctx.tenantId}, ${employeeId}, ${leaveType}, ${startRaw}, ${endRaw}, ${businessDays}, ${reason})`
    })
  } catch (e) {
    if (e instanceof ErrorVacaciones) return { ok: false, error: e.message }
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/vacaciones')
  return { ok: true }
}

/** Cancela una solicitud propia todavia pendiente. */
export async function cancelarSolicitud(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'time-off', 'time-off.request')
  if (!permiso.ok) return permiso

  const recordId = String(fd.get('recordId') ?? '')
  if (!recordId) return { ok: false, error: 'Falta la solicitud.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [row] = await tx<{ status: string }[]>`
        select status from public.time_off_requests
        where id = ${recordId} and tenant_id = ${ctx.tenantId}`
      if (!row) throw new Error('Esa solicitud no existe.')
      if (row.status !== 'pending')
        throw new Error('Esa solicitud ya fue resuelta: no se puede cancelar.')

      await tx`
        update public.time_off_requests
        set status = 'cancelled', updated_at = now()
        where id = ${recordId} and tenant_id = ${ctx.tenantId}`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/vacaciones')
  return { ok: true }
}

/** Aprueba o rechaza una solicitud pendiente. */
export async function resolverSolicitud(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'time-off', 'time-off.approve')
  if (!permiso.ok) return permiso

  const recordId = String(fd.get('recordId') ?? '')
  const decision = String(fd.get('decision') ?? '')
  const note = String(fd.get('note') ?? '').trim() || null
  if (!recordId) return { ok: false, error: 'Falta la solicitud.' }
  if (decision !== 'approved' && decision !== 'rejected')
    return { ok: false, error: 'Decision invalida.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      // `for update`: dos aprobaciones a la vez no gastan el mismo saldo.
      const [row] = await tx<
        {
          status: string
          employee_id: string
          leave_type: string
          start_date: string
          end_date: string
          business_days: number
        }[]
      >`
        select status, employee_id, leave_type, start_date::text, end_date::text, business_days
        from public.time_off_requests
        where id = ${recordId} and tenant_id = ${ctx.tenantId}
        for update`
      if (!row) throw new ErrorVacaciones('Esa solicitud no existe.')
      if (row.status !== 'pending') throw new ErrorVacaciones('Esa solicitud ya fue resuelta.')

      // Aprobar es la puerta que ven TODAS las solicitudes -la web, el
      // portal y la app movil (pedir_vacaciones)-: aqui se revisa el saldo
      // con lo ya aprobado, sin contar esta misma (0138).
      if (decision === 'approved') {
        const problema = await revisarVacaciones(tx, ctx.tenantId, {
          employeeId: row.employee_id,
          tipo: row.leave_type,
          inicio: row.start_date,
          fin: row.end_date,
          dias: row.business_days,
          excluirId: recordId,
          contarPendientes: false,
        })
        if (problema) throw new ErrorVacaciones(`No se puede aprobar. ${problema}`)
      }

      await tx`
        update public.time_off_requests
        set status = ${decision}, decided_by = ${ctx.userId}, decided_at = now(),
            decision_note = ${note}, updated_at = now()
        where id = ${recordId} and tenant_id = ${ctx.tenantId}`

      await tx`
        select public.emit_event(${`time-off.request.${decision}`},
          ${JSON.stringify({ recordId })}::text::jsonb, 'time-off')`
    })
  } catch (e) {
    if (e instanceof ErrorVacaciones) return { ok: false, error: e.message }
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/vacaciones')
  revalidatePath('/vacaciones/aprobar')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function solicitarAusenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await solicitarAusencia(fd),
    'solicitarAusencia',
    'Listo, la solicitud quedó pendiente de aprobación.',
  )
}
export async function cancelarSolicitudForm(fd: FormData): Promise<void> {
  await anotarAviso(await cancelarSolicitud(fd), 'cancelarSolicitud')
}
export async function resolverSolicitudForm(fd: FormData): Promise<void> {
  const aprueba = String(fd.get('decision') ?? '') === 'approved'
  await anotarAviso(
    await resolverSolicitud(fd),
    'resolverSolicitud',
    aprueba ? 'Listo, la solicitud quedó aprobada.' : 'Listo, la solicitud quedó rechazada.',
  )
}
