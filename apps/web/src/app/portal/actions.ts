'use server'

import { revalidatePath } from 'next/cache'
import { diasLaborablesEntre } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'
import { resolverMiEmpleado } from './mi-empleado'

/**
 * Acciones del portal del empleado (modulo 70, F7/S40).
 *
 * Toda accion aqui empieza resolviendo el expediente propio por el
 * vinculo que asigno RRHH (`employees.user_id`, 0132) -nunca por correo,
 * y nunca opera sobre un employeeId que venga del formulario-, para que
 * nadie pueda pedir vacaciones o editar el telefono de otro empleado
 * con solo cambiar un id en el request.
 */

const SIN_VINCULO =
  'Tu cuenta no esta vinculada a ningun expediente. Pide a RRHH que la vincule desde Empleados.'

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

/** Actualiza el telefono del propio expediente. */
export async function editarMiTelefono(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'hr-portal', 'hr-portal.edit-profile')
  if (!permiso.ok) return permiso

  const phone = String(fd.get('phone') ?? '').trim() || null

  try {
    // Por el token (0132): con el rol real en los claims, el rol Empleado
    // no puede tocar `employees` -ni debe-; la funcion edita SOLO el
    // expediente vinculado a esta cuenta, sin recibir ningun id.
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const yo = await resolverMiEmpleado(tx)
      if (!yo) throw new Error(SIN_VINCULO)

      await tx`select public.editar_mi_telefono(${phone})`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/portal')
  return { ok: true }
}

/** Pide vacaciones desde el portal -siempre para el empleado propio-. */
export async function solicitarDesdePortal(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'hr-portal', 'hr-portal.request-time-off')
  if (!permiso.ok) return permiso

  const startRaw = String(fd.get('startDate') ?? '')
  const endRaw = String(fd.get('endDate') ?? '')
  const reason = String(fd.get('reason') ?? '').trim() || null

  if (!startRaw || !endRaw) return { ok: false, error: 'Elige las fechas.' }
  const inicio = new Date(`${startRaw}T00:00:00`)
  const fin = new Date(`${endRaw}T00:00:00`)
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    return { ok: false, error: 'Las fechas no son validas.' }
  }
  if (fin < inicio) return { ok: false, error: 'La fecha de fin no puede ser antes que la de inicio.' }

  const businessDays = diasLaborablesEntre(inicio, fin)
  if (businessDays === 0) {
    return { ok: false, error: 'El rango elegido no incluye ningun dia laborable.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const yo = await resolverMiEmpleado(tx)
      if (!yo) throw new Error(SIN_VINCULO)

      await tx`
        insert into public.time_off_requests
          (tenant_id, employee_id, leave_type, start_date, end_date, business_days, reason)
        values (${ctx.tenantId}, ${yo.id}, 'vacation', ${startRaw}, ${endRaw}, ${businessDays}, ${reason})`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/portal')
  return { ok: true }
}

/** Publica un anuncio para todo el tenant. */
export async function publicarAnuncio(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'hr-portal', 'hr-portal.manage-announcements')
  if (!permiso.ok) return permiso

  const title = String(fd.get('title') ?? '').trim()
  const body = String(fd.get('body') ?? '').trim()
  if (!title) return { ok: false, error: 'Escribe un titulo.' }
  if (!body) return { ok: false, error: 'Escribe el contenido del anuncio.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.hr_announcements (tenant_id, title, body, published_by)
        values (${ctx.tenantId}, ${title}, ${body}, ${ctx.userId})`

      await tx`
        select public.emit_event('hr-portal.announcement.published',
          ${JSON.stringify({ title })}::text::jsonb, 'hr-portal')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/portal')
  revalidatePath('/portal/anuncios')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function editarMiTelefonoForm(fd: FormData): Promise<void> {
  await anotarAviso(await editarMiTelefono(fd), 'editarMiTelefono')
}
export async function solicitarDesdePortalForm(fd: FormData): Promise<void> {
  await anotarAviso(await solicitarDesdePortal(fd), 'solicitarDesdePortal')
}
export async function publicarAnuncioForm(fd: FormData): Promise<void> {
  await anotarAviso(await publicarAnuncio(fd), 'publicarAnuncio')
}
