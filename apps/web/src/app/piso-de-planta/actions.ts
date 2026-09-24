'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones del terminal de piso de planta (modulo 60, F8.5/S54).
 *
 * Marcar entrada/salida y abrir/cerrar un paro son las unicas
 * escrituras de este modulo -el OEE se calcula leyendo estas mismas
 * filas, nunca se guarda un numero calculado-.
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

export async function marcarEntrada(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'shopfloor', 'shopfloor.operate')
  if (!permiso.ok) return permiso

  const ordenId = String(fd.get('ordenId') ?? '')
  if (!ordenId) return { ok: false, error: 'Falta la orden.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.shopfloor_sessions (tenant_id, production_order_id, operator_id)
    values (${ctx.tenantId}, ${ordenId}, ${ctx.userId})`,
  )

  revalidatePath(`/piso-de-planta/${ordenId}`)
  return { ok: true }
}

export async function marcarSalida(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'shopfloor', 'shopfloor.operate')
  if (!permiso.ok) return permiso

  const ordenId = String(fd.get('ordenId') ?? '')
  const sesionId = String(fd.get('sesionId') ?? '')

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    update public.shopfloor_sessions set clocked_out_at = now()
    where id = ${sesionId} and tenant_id = ${ctx.tenantId} and clocked_out_at is null`,
  )

  revalidatePath(`/piso-de-planta/${ordenId}`)
  return { ok: true }
}

export async function iniciarParo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'shopfloor', 'shopfloor.operate')
  if (!permiso.ok) return permiso

  const ordenId = String(fd.get('ordenId') ?? '')
  const reason = String(fd.get('reason') ?? '').trim()
  if (!reason) return { ok: false, error: 'Explica la razon del paro.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.shopfloor_downtime (tenant_id, production_order_id, reason)
    values (${ctx.tenantId}, ${ordenId}, ${reason})`,
  )

  revalidatePath(`/piso-de-planta/${ordenId}`)
  return { ok: true }
}

export async function terminarParo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'shopfloor', 'shopfloor.operate')
  if (!permiso.ok) return permiso

  const ordenId = String(fd.get('ordenId') ?? '')
  const paroId = String(fd.get('paroId') ?? '')

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    update public.shopfloor_downtime set ended_at = now()
    where id = ${paroId} and tenant_id = ${ctx.tenantId} and ended_at is null`,
  )

  revalidatePath(`/piso-de-planta/${ordenId}`)
  return { ok: true }
}

/** Declara el ciclo ideal -horas por unidad- que usa rendimiento() para el OEE. */
export async function fijarCicloIdeal(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'shopfloor', 'shopfloor.operate')
  if (!permiso.ok) return permiso

  const ordenId = String(fd.get('ordenId') ?? '')
  const horas = num(String(fd.get('idealCycleHours') ?? ''))
  if (horas === null || horas <= 0)
    return { ok: false, error: 'El ciclo ideal debe ser mayor que cero.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    update public.production_orders set ideal_cycle_hours = ${horas}, updated_at = now()
    where id = ${ordenId} and tenant_id = ${ctx.tenantId}`,
  )

  revalidatePath(`/piso-de-planta/${ordenId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function marcarEntradaForm(fd: FormData): Promise<void> {
  await anotarAviso(await marcarEntrada(fd), 'marcarEntrada')
}
export async function marcarSalidaForm(fd: FormData): Promise<void> {
  await anotarAviso(await marcarSalida(fd), 'marcarSalida')
}
export async function iniciarParoForm(fd: FormData): Promise<void> {
  await anotarAviso(await iniciarParo(fd), 'iniciarParo')
}
export async function terminarParoForm(fd: FormData): Promise<void> {
  await anotarAviso(await terminarParo(fd), 'terminarParo')
}
export async function fijarCicloIdealForm(fd: FormData): Promise<void> {
  await anotarAviso(await fijarCicloIdeal(fd), 'fijarCicloIdeal')
}
