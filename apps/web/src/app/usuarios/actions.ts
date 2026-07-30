'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult } from '@/lib/module-page'

/**
 * Acciones del modulo `users`. Permiso en servidor + escritura bajo RLS,
 * el mismo doble candado de roles/actions.ts (§8.3).
 */

export async function invitarMiembro(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx({
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  })
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'users', 'users.create')
  if (!permiso.ok) return permiso

  const nombre = String(formData.get('nombre') ?? '').trim()
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const roleId = String(formData.get('roleId') ?? '')

  if (nombre.length < 3) return { ok: false, error: 'El nombre necesita al menos 3 letras.' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Correo invalido.' }
  if (!roleId) return { ok: false, error: 'Elige un rol.' }

  // En produccion el user_id sale de auth.users al aceptar la invitacion;
  // aqui se genera para que el flujo completo sea recorrible en demo.
  const nuevoUsuario = crypto.randomUUID()

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    await tx`
      insert into public.user_profiles (tenant_id, user_id, display_name, email)
      values (${ctx.tenantId}, ${nuevoUsuario}, ${nombre}, ${email})`
    await tx`
      insert into public.memberships (tenant_id, user_id, role_id, invited_at, is_active)
      values (${ctx.tenantId}, ${nuevoUsuario}, ${roleId}, now(), true)`
  })

  revalidatePath('/usuarios')
  return { ok: true }
}

export async function cambiarRolMiembro(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx({
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  })
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'users', 'users.edit')
  if (!permiso.ok) return permiso

  const userId = String(formData.get('userId') ?? '')
  const roleId = String(formData.get('roleId') ?? '')
  if (!userId || !roleId) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.memberships
      set role_id = ${roleId}, updated_at = now()
      where tenant_id = ${ctx.tenantId} and user_id = ${userId}`
  })

  revalidatePath('/usuarios')
  return { ok: true }
}

export async function alternarActivo(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx({
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  })
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'users', 'users.edit')
  if (!permiso.ok) return permiso

  const userId = String(formData.get('userId') ?? '')
  if (!userId) return { ok: false, error: 'Faltan datos.' }
  if (userId === ctx.userId) return { ok: false, error: 'No puedes desactivarte a ti mismo.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.memberships
      set is_active = not is_active, updated_at = now()
      where tenant_id = ${ctx.tenantId} and user_id = ${userId}`
  })

  revalidatePath('/usuarios')
  return { ok: true }
}

// ── Versiones para <form action>: el form no consume el resultado ───────
export async function invitarMiembroForm(fd: FormData): Promise<void> {
  await invitarMiembro(fd)
}
export async function cambiarRolMiembroForm(fd: FormData): Promise<void> {
  await cambiarRolMiembro(fd)
}
export async function alternarActivoForm(fd: FormData): Promise<void> {
  await alternarActivo(fd)
}
