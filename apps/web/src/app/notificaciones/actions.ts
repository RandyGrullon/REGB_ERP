'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult } from '@/lib/module-page'
import { anotarAviso } from '@/lib/aviso'

/** Acciones del modulo `notifications` (S10). */

function demoDe(formData: FormData) {
  return {
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  }
}

async function leerUna(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'notifications', 'notifications.edit')
  if (!permiso.ok) return permiso

  const id = String(formData.get('id') ?? '')
  if (!id) return { ok: false, error: 'Falta la notificacion.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.notifications set read_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}
        and (user_id = ${ctx.userId} or user_id is null)
        and read_at is null`
  })

  revalidatePath('/notificaciones')
  return { ok: true }
}

async function leerTodas(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'notifications', 'notifications.edit')
  if (!permiso.ok) return permiso

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.notifications set read_at = now()
      where tenant_id = ${ctx.tenantId}
        and (user_id = ${ctx.userId} or user_id is null)
        and read_at is null`
  })

  revalidatePath('/notificaciones')
  return { ok: true }
}

// ── Envoltorios para <form action> ──────────────────────────────────────
//  Marcar una sola como leida NO avisa en caso de exito: el punto
//  desaparece de la lista a la vista y un aviso por cada clic es ruido.
//  El error SI se dice -si no, un permiso denegado se ve como que el
//  boton no hace nada-.
export async function marcarLeida(fd: FormData): Promise<void> {
  const r = await leerUna(fd)
  if (!r.ok) await anotarAviso(r, 'marcarLeida')
}
export async function marcarTodasLeidas(fd: FormData): Promise<void> {
  await anotarAviso(await leerTodas(fd), 'marcarTodasLeidas', 'Listo, marcamos todas como leidas.')
}
