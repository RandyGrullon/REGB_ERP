'use server'

import { revalidatePath } from 'next/cache'
import { rutaCompleta, transicionValidaRuta, type EstadoRuta } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/** Acciones de logistica y rutas (modulo 53, F8/S49). */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

/** Planifica una ruta nueva -sin paradas todavia-. */
export async function crearRuta(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'logistics', 'logistics.manage')
  if (!permiso.ok) return permiso

  const driverId = String(fd.get('driverId') ?? '') || null
  const vehiclePlate = String(fd.get('vehiclePlate') ?? '').trim() || null
  const routeDate = String(fd.get('routeDate') ?? '') || null

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.delivery_routes (tenant_id, driver_id, vehicle_plate, route_date)
      values (${ctx.tenantId}, ${driverId}, ${vehiclePlate}, ${routeDate ?? new Date().toISOString().slice(0, 10)})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/rutas')
  return { ok: true }
}

/** Agrega una parada a una ruta todavia en planificacion. */
export async function agregarParada(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'logistics', 'logistics.manage')
  if (!permiso.ok) return permiso

  const routeId = String(fd.get('routeId') ?? '')
  const customerId = String(fd.get('customerId') ?? '') || null
  const address = String(fd.get('address') ?? '').trim()
  if (!routeId) return { ok: false, error: 'Falta la ruta.' }
  if (!address) return { ok: false, error: 'Escribe la direccion.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [ruta] = await tx<{ status: string }[]>`
      select status from public.delivery_routes where id = ${routeId} and tenant_id = ${ctx.tenantId}`
    if (!ruta) return 'no-existe'
    if (ruta.status !== 'planned')
      return 'Solo se pueden agregar paradas mientras la ruta esta planificada.'

    const [n] = await tx<{ n: string }[]>`
      select coalesce(max(sequence), 0)::text as n from public.route_stops
      where route_id = ${routeId} and tenant_id = ${ctx.tenantId}`

    await tx`
      insert into public.route_stops (route_id, tenant_id, sequence, address, customer_id)
      values (${routeId}, ${ctx.tenantId}, ${Number(n!.n) + 1}, ${address}, ${customerId})`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa ruta no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/rutas/${routeId}`)
  return { ok: true }
}

/** Despacha la ruta -pasa a en progreso-. */
export async function despacharRuta(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'logistics', 'logistics.manage')
  if (!permiso.ok) return permiso

  const routeId = String(fd.get('routeId') ?? '')
  if (!routeId) return { ok: false, error: 'Falta la ruta.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [ruta] = await tx<{ status: string }[]>`
      select status from public.delivery_routes where id = ${routeId} and tenant_id = ${ctx.tenantId}`
    if (!ruta) return 'no-existe'
    if (!transicionValidaRuta(ruta.status as EstadoRuta, 'in_progress')) {
      return 'Esa ruta ya no se puede despachar.'
    }

    const [paradas] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.route_stops where route_id = ${routeId} and tenant_id = ${ctx.tenantId}`
    if (Number(paradas!.n) === 0) return 'Agrega al menos una parada antes de despachar.'

    await tx`
      update public.delivery_routes set status = 'in_progress', started_at = now(), updated_at = now()
      where id = ${routeId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa ruta no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/rutas/${routeId}`)
  revalidatePath('/rutas')
  return { ok: true }
}

/** Cancela una ruta -solo mientras sigue planificada-. */
export async function cancelarRuta(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'logistics', 'logistics.manage')
  if (!permiso.ok) return permiso

  const routeId = String(fd.get('routeId') ?? '')
  if (!routeId) return { ok: false, error: 'Falta la ruta.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [ruta] = await tx<{ status: string }[]>`
      select status from public.delivery_routes where id = ${routeId} and tenant_id = ${ctx.tenantId}`
    if (!ruta) return 'no-existe'
    if (!transicionValidaRuta(ruta.status as EstadoRuta, 'cancelled')) {
      return 'Esa ruta ya no se puede cancelar -ya salio a reparto-.'
    }

    await tx`
      update public.delivery_routes set status = 'cancelled', updated_at = now()
      where id = ${routeId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa ruta no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/rutas/${routeId}`)
  revalidatePath('/rutas')
  return { ok: true }
}

/** Marca una parada entregada o fallida -la prueba de entrega es quien recibio-. */
export async function resolverParada(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'logistics', 'logistics.deliver')
  if (!permiso.ok) return permiso

  const stopId = String(fd.get('stopId') ?? '')
  const routeId = String(fd.get('routeId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '')
  const recipientName = String(fd.get('recipientName') ?? '').trim() || null
  const deliveryNotes = String(fd.get('deliveryNotes') ?? '').trim() || null

  if (!stopId) return { ok: false, error: 'Falta la parada.' }
  if (siguiente !== 'delivered' && siguiente !== 'failed')
    return { ok: false, error: 'Estado invalido.' }
  if (siguiente === 'delivered' && !recipientName) {
    return { ok: false, error: 'Escribe quien recibio -es la prueba de entrega-.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        update public.route_stops
        set status = ${siguiente}, recipient_name = ${recipientName}, delivery_notes = ${deliveryNotes},
            delivered_at = now()
        where id = ${stopId} and tenant_id = ${ctx.tenantId} and status = 'pending'`

      if (siguiente === 'delivered') {
        await tx`
          select public.emit_event('logistics.stop.delivered',
            ${JSON.stringify({ stopId })}::text::jsonb, 'logistics')`
      }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/rutas/${routeId}`)
  return { ok: true }
}

/** Completa la ruta -solo si ninguna parada sigue pendiente-. */
export async function completarRuta(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'logistics', 'logistics.manage')
  if (!permiso.ok) return permiso

  const routeId = String(fd.get('routeId') ?? '')
  if (!routeId) return { ok: false, error: 'Falta la ruta.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [ruta] = await tx<{ status: string }[]>`
      select status from public.delivery_routes where id = ${routeId} and tenant_id = ${ctx.tenantId}`
    if (!ruta) return 'no-existe'
    if (!transicionValidaRuta(ruta.status as EstadoRuta, 'completed')) {
      return 'Esa ruta ya no se puede completar.'
    }

    const paradas = await tx<{ status: 'pending' | 'delivered' | 'failed' }[]>`
      select status from public.route_stops where route_id = ${routeId} and tenant_id = ${ctx.tenantId}`
    if (!rutaCompleta(paradas)) return 'Todavia hay paradas pendientes.'

    await tx`
      update public.delivery_routes set status = 'completed', completed_at = now(), updated_at = now()
      where id = ${routeId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('logistics.route.completed',
        ${JSON.stringify({ routeId })}::text::jsonb, 'logistics')`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa ruta no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/rutas/${routeId}`)
  revalidatePath('/rutas')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearRutaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearRuta(fd), 'crearRuta')
}
export async function agregarParadaForm(fd: FormData): Promise<void> {
  await anotarAviso(await agregarParada(fd), 'agregarParada')
}
export async function despacharRutaForm(fd: FormData): Promise<void> {
  await anotarAviso(await despacharRuta(fd), 'despacharRuta')
}
export async function cancelarRutaForm(fd: FormData): Promise<void> {
  await anotarAviso(await cancelarRuta(fd), 'cancelarRuta')
}
export async function resolverParadaForm(fd: FormData): Promise<void> {
  await anotarAviso(await resolverParada(fd), 'resolverParada')
}
export async function completarRutaForm(fd: FormData): Promise<void> {
  await anotarAviso(await completarRuta(fd), 'completarRuta')
}
