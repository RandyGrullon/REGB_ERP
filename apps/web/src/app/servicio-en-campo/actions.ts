'use server'

import { revalidatePath } from 'next/cache'
import { transicionValidaOrden, type EstadoOrdenServicio } from '@regb/operations'
import { motivoParaNoCerrar } from './estados'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Servicio en campo (modulo 74, F10/S69).
 *
 * El cierre se PRE-valida aqui con `motivoNoCierre()` antes de tocar la
 * fila. El trigger de la base sigue siendo la regla de verdad -el
 * telefono del tecnico es un cliente remoto-, pero atrapar el error del
 * trigger dentro de un `sql.begin()` envenena la transaccion completa y
 * el commit implicito falla despues: exactamente el tropiezo que ya
 * dejo el modulo `projects` con las dependencias de tareas.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const numero = (raw: string): number | null => {
  const n = Number(raw.trim())
  return Number.isFinite(n) ? n : null
}

/**
 * El técnico solo toca SUS órdenes. Quien gestiona el módulo (el
 * despachador, el dueño) puede trabajar cualquiera; quien solo ejecuta,
 * la que tiene asignada. Antes cualquier técnico podía marcar pasos o
 * cerrar la orden de otro con solo tener el enlace.
 */
async function puedeTocarOrden(
  ctx: NonNullable<Awaited<ReturnType<typeof actionCtx>>>,
  orderId: string,
): Promise<ActionResult> {
  if (exigir(ctx, 'field-service', 'field-service.manage').ok) return { ok: true }
  const [o] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<{ technician_id: string | null }[]>`
      select technician_id from public.service_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`,
  )
  if (!o) return { ok: false, error: 'Esa orden no existe.' }
  if (o.technician_id !== ctx.userId) {
    return { ok: false, error: 'Esa orden está asignada a otro técnico.' }
  }
  return { ok: true }
}

/** Solo se asigna a alguien que trabaja en este negocio y tiene su acceso activo. */
async function esMiembroActivo(
  ctx: NonNullable<Awaited<ReturnType<typeof actionCtx>>>,
  userId: string,
): Promise<boolean> {
  const [m] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<{ ok: boolean }[]>`
      select exists (
        select 1 from public.memberships
        where tenant_id = ${ctx.tenantId} and user_id = ${userId}::uuid and is_active
      ) as ok`,
  )
  return m?.ok === true
}

export async function crearOrden(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesión no válida.' }
  const permiso = exigir(ctx, 'field-service', 'field-service.manage')
  if (!permiso.ok) return permiso

  const customerId = String(fd.get('customerId') ?? '')
  const descripcion = String(fd.get('description') ?? '').trim()
  const direccion = String(fd.get('address') ?? '').trim()
  const prioridad = String(fd.get('priority') ?? 'normal')
  const agendada = String(fd.get('scheduledAt') ?? '').trim()
  const tecnico = String(fd.get('technicianId') ?? '').trim()

  if (!customerId) return { ok: false, error: 'Elige el cliente.' }
  if (descripcion === '') return { ok: false, error: 'Escribe qué hay que hacer.' }
  if (tecnico !== '' && !(await esMiembroActivo(ctx, tecnico))) {
    return { ok: false, error: 'Ese técnico no tiene acceso activo en este negocio.' }
  }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    // El codigo se arma con el consecutivo del tenant, no con un global:
    // el cliente lee "OS-7", no un uuid ni el numero de otro negocio.
    const [n] = await tx<{ n: string }[]>`
      select (count(*) + 1)::text as n from public.service_orders where tenant_id = ${ctx.tenantId}`
    await tx`
      insert into public.service_orders
        (tenant_id, code, customer_id, description, address, priority, scheduled_at, status,
         technician_id, created_by)
      values (${ctx.tenantId}, ${`OS-${n?.n ?? '1'}`}, ${customerId}, ${descripcion},
              ${direccion || null}, ${prioridad},
              ${agendada === '' ? null : new Date(agendada).toISOString()},
              ${agendada === '' ? 'draft' : 'scheduled'}, ${tecnico || null}, ${ctx.userId})`
  })

  revalidatePath('/servicio-en-campo')
  return { ok: true }
}

export async function agregarPaso(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesión no válida.' }
  const permiso = exigir(ctx, 'field-service', 'field-service.manage')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const label = String(fd.get('label') ?? '').trim()
  const obligatorio = String(fd.get('required') ?? '') === 'on'

  if (!orderId) return { ok: false, error: 'Falta la orden.' }
  if (label === '') return { ok: false, error: 'Escribe el paso.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [p] = await tx<{ n: string }[]>`
      select coalesce(max(position) + 1, 0)::text as n
      from public.service_checklist_items where tenant_id = ${ctx.tenantId} and order_id = ${orderId}`
    await tx`
      insert into public.service_checklist_items (tenant_id, order_id, position, label, required)
      values (${ctx.tenantId}, ${orderId}, ${Number(p?.n ?? 0)}, ${label}, ${obligatorio})`
  })

  revalidatePath(`/servicio-en-campo/${orderId}`)
  return { ok: true }
}

/**
 * Marcar y desmarcar un paso es el gesto mas frecuente del modulo: el
 * tecnico lo hace con el pulgar, parado, y a veces se equivoca. Por eso
 * alterna en vez de ser una sola direccion.
 */
export async function alternarPaso(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesión no válida.' }
  const permiso = exigir(ctx, 'field-service', 'field-service.execute')
  if (!permiso.ok) return permiso

  const itemId = String(fd.get('itemId') ?? '')
  const orderId = String(fd.get('orderId') ?? '')
  if (!itemId) return { ok: false, error: 'Falta el paso.' }
  const propia = await puedeTocarOrden(ctx, orderId)
  if (!propia.ok) return propia

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    update public.service_checklist_items
    set done = not done,
        done_at = case when done then null else now() end
    where id = ${itemId} and tenant_id = ${ctx.tenantId} and order_id = ${orderId}`,
  )

  revalidatePath(`/servicio-en-campo/${orderId}`)
  return { ok: true }
}

export async function registrarRepuesto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesión no válida.' }
  const permiso = exigir(ctx, 'field-service', 'field-service.execute')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const productId = String(fd.get('productId') ?? '')
  const descripcion = String(fd.get('description') ?? '').trim()
  const qty = numero(String(fd.get('qty') ?? ''))
  const costo = numero(String(fd.get('unitCost') ?? ''))

  if (!orderId) return { ok: false, error: 'Falta la orden.' }
  if (descripcion === '') return { ok: false, error: 'Describe el repuesto.' }
  if (qty === null || qty <= 0)
    return { ok: false, error: 'La cantidad tiene que ser mayor que cero.' }
  if (costo === null || costo < 0) return { ok: false, error: 'El costo no puede ser negativo.' }
  const propia = await puedeTocarOrden(ctx, orderId)
  if (!propia.ok) return propia

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.service_parts (tenant_id, order_id, product_id, description, qty, unit_cost, created_by)
    values (${ctx.tenantId}, ${orderId}, ${productId || null}, ${descripcion}, ${qty}, ${costo}, ${ctx.userId})`,
  )

  revalidatePath(`/servicio-en-campo/${orderId}`)
  return { ok: true }
}

export async function transicionarOrden(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesión no válida.' }
  const permiso = exigir(ctx, 'field-service', 'field-service.execute')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoOrdenServicio
  const firmadoPor = String(fd.get('signedBy') ?? '').trim()

  if (!orderId) return { ok: false, error: 'Falta la orden.' }
  const propia = await puedeTocarOrden(ctx, orderId)
  if (!propia.ok) return propia

  const error = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [orden] = await tx<{ status: EstadoOrdenServicio }[]>`
      select status from public.service_orders where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    if (!orden) return 'Esa orden no existe.'
    if (!transicionValidaOrden(orden.status, siguiente)) {
      return 'Esa orden no puede pasar a ese estado desde donde está.'
    }

    if (siguiente === 'done') {
      const pasos = await tx<{ required: boolean; done: boolean }[]>`
        select required, done from public.service_checklist_items
        where tenant_id = ${ctx.tenantId} and order_id = ${orderId}`
      const motivo = motivoParaNoCerrar(pasos, firmadoPor === '' ? null : firmadoPor)
      if (motivo !== null) return motivo

      await tx`
        update public.service_orders
        set status = 'done', completed_at = now(), signed_by = ${firmadoPor}, signed_at = now(), updated_at = now()
        where id = ${orderId} and tenant_id = ${ctx.tenantId}`
      return null
    }

    await tx`
      update public.service_orders
      set status = ${siguiente},
          started_at = case when ${siguiente} = 'in_progress' and started_at is null then now() else started_at end,
          updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    return null
  })

  revalidatePath('/servicio-en-campo')
  revalidatePath(`/servicio-en-campo/${orderId}`)
  return error === null ? { ok: true } : { ok: false, error }
}

/** Quién va. Solo quien gestiona el módulo reparte las órdenes. */
export async function asignarTecnico(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesión no válida.' }
  const permiso = exigir(ctx, 'field-service', 'field-service.manage')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const tecnico = String(fd.get('technicianId') ?? '').trim()
  if (!orderId) return { ok: false, error: 'Falta la orden.' }
  if (tecnico !== '' && !(await esMiembroActivo(ctx, tecnico))) {
    return { ok: false, error: 'Ese técnico no tiene acceso activo en este negocio.' }
  }

  const error = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [o] = await tx<{ status: string }[]>`
      select status from public.service_orders where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    if (!o) return 'Esa orden no existe.'
    if (o.status === 'done' || o.status === 'cancelled') {
      return 'Una orden terminada o cancelada ya no cambia de técnico.'
    }
    await tx`
      update public.service_orders set technician_id = ${tecnico || null}, updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    return null
  })

  revalidatePath('/servicio-en-campo')
  revalidatePath(`/servicio-en-campo/${orderId}`)
  return error === null ? { ok: true } : { ok: false, error }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function asignarTecnicoForm(fd: FormData): Promise<void> {
  await anotarAviso(await asignarTecnico(fd), 'asignarTecnico')
}

export async function crearOrdenForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearOrden(fd), 'crearOrden')
}
export async function agregarPasoForm(fd: FormData): Promise<void> {
  await anotarAviso(await agregarPaso(fd), 'agregarPaso')
}
export async function alternarPasoForm(fd: FormData): Promise<void> {
  await anotarAviso(await alternarPaso(fd), 'alternarPaso')
}
export async function registrarRepuestoForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarRepuesto(fd), 'registrarRepuesto')
}
export async function transicionarOrdenForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarOrden(fd), 'transicionarOrden')
}
