'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult } from '@/lib/module-page'
import { anotarAviso } from '@/lib/aviso'

/**
 * Acciones del modulo `notifications` (S10).
 *
 * Marcar como leido escribe una LECTURA de quien lo pide, no toca el
 * aviso (0125). Un aviso de equipo que lee el cajero sigue sin leer para
 * el gerente. Quien es quien sale de la sesion via `asUser` -la base lo
 * lee de `rls.regb_uid()`-, nunca del formulario.
 */

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

  // Un id que no es un uuid haria saltar la conversion en la base con un
  // error de sintaxis; para quien pulsa es lo mismo que un aviso ajeno.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, error: 'Ese aviso no existe.' }
  }

  // `false` si ya estaba leido (doble clic) o si no es suyo ni del equipo.
  // Lo segundo no se distingue a proposito: decir "es de otro" confirma
  // que el id existe.
  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`select public.marcar_aviso_leido(${id})`)

  revalidatePath('/notificaciones')
  return { ok: true }
}

async function leerTodas(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'notifications', 'notifications.edit')
  if (!permiso.ok) return permiso

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`select public.marcar_avisos_leidos()`)

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
