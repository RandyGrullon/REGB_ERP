'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type ModulePageCtx } from '@/lib/module-page'
import { enviarInvitacionPorCorreo } from './correo'
import { enlaceDeInvitacion, type EnvioCorreo, type ResultadoInvitacion } from './invitacion'

/**
 * Acciones del modulo `users`. Permiso en servidor + escritura bajo RLS,
 * el mismo doble candado de roles/actions.ts (§8.3).
 *
 * Invitar ya NO toca `memberships` (0123): crea una invitacion pendiente
 * con `public.crear_invitacion()`, que devuelve el token UNA vez y guarda
 * solo su hash. La membresia nace cuando la persona acepta con su cuenta
 * real (`/auth/invitacion/<token>`). Antes se insertaba una membresia con
 * un `user_id` inventado que nunca podia enlazarse con nadie.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function demoDe(fd: FormData) {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

/**
 * Los errores que levantan las funciones de 0123 ya vienen redactados para
 * el usuario (que paso y que hacer). Se muestran esos; cualquier otro es un
 * fallo nuestro y no se le enseña un mensaje de Postgres a nadie.
 */
const CODIGOS_CON_MENSAJE = new Set(['22023', '23505', '42501', '55000', '28000'])

function mensajeDeBase(e: unknown, generico: string): string {
  const err = e as { code?: string; message?: string; constraint_name?: string }
  // Dos invitaciones al mismo correo a la vez: la segunda la frena el
  // indice unico, no la funcion, y su texto es de Postgres.
  if (err?.constraint_name === 'user_invitations_una_pendiente') {
    return 'Ya hay una invitacion pendiente para ese correo. Reenviala o revocala.'
  }
  if (err?.code && CODIGOS_CON_MENSAJE.has(err.code) && err.message) return err.message
  console.error('[usuarios]', e)
  return generico
}

/** De donde sale el enlace que se ENSEÑA en pantalla (el del correo lo arma la Edge Function). */
async function origen(): Promise<string> {
  const h = await headers()
  const o = h.get('origin')
  if (o && /^https?:\/\/[a-z0-9.:-]+$/i.test(o)) return o
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (host && /^[a-z0-9.:-]+$/i.test(host)) {
    const proto = h.get('x-forwarded-proto') === 'https' ? 'https' : 'http'
    return `${proto}://${host}`
  }
  return 'http://localhost:3000'
}

/** Intenta el correo y, SOLO si salio, deja constancia en la invitacion. */
async function entregar(
  ctx: ModulePageCtx,
  invitationId: string,
  token: string,
): Promise<EnvioCorreo> {
  const envio = await enviarInvitacionPorCorreo({ invitationId, token })
  if (envio.enviado) {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`select public.marcar_invitacion_enviada(${invitationId}::uuid)`,
    )
  }
  return envio
}

async function resultado(
  email: string,
  envio: EnvioCorreo,
  token: string,
): Promise<ResultadoInvitacion> {
  return {
    ok: true,
    email,
    envio,
    enlace: envio.enviado ? null : enlaceDeInvitacion(await origen(), token),
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Invitar
// ═══════════════════════════════════════════════════════════════════════

export async function invitarMiembro(
  _prev: ResultadoInvitacion | null,
  formData: FormData,
): Promise<ResultadoInvitacion> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'users', 'users.create')
  if (!permiso.ok) return permiso

  const nombre = String(formData.get('nombre') ?? '').trim()
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const roleId = String(formData.get('roleId') ?? '')

  if (nombre.length < 3) return { ok: false, error: 'El nombre necesita al menos 3 letras.' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return {
      ok: false,
      error: 'Ese correo no es valido. Revisalo: debe verse como juana@tuempresa.do.',
    }
  }
  if (!UUID.test(roleId)) return { ok: false, error: 'Elige un rol.' }

  let creada: { invitacion: string; token: string }
  try {
    creada = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [r] = await tx<{ invitacion: string; token: string }[]>`
        select invitacion, token
        from public.crear_invitacion(${email}, ${nombre}, ${roleId}::uuid)`
      return r!
    })
  } catch (e) {
    return {
      ok: false,
      error: mensajeDeBase(e, 'No pudimos crear la invitacion. Intenta de nuevo.'),
    }
  }

  const envio = await entregar(ctx, creada.invitacion, creada.token)
  revalidatePath('/usuarios')
  return resultado(email, envio, creada.token)
}

// ═══════════════════════════════════════════════════════════════════════
//  Reenviar: token nuevo, el enlace anterior deja de servir
// ═══════════════════════════════════════════════════════════════════════

export async function reenviarInvitacion(
  _prev: ResultadoInvitacion | null,
  formData: FormData,
): Promise<ResultadoInvitacion> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'users', 'users.create')
  if (!permiso.ok) return permiso

  const invitationId = String(formData.get('invitationId') ?? '')
  if (!UUID.test(invitationId)) return { ok: false, error: 'Falta la invitacion.' }

  let nueva: { token: string; email: string }
  try {
    nueva = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [r] = await tx<{ token: string }[]>`
        select token from public.reenviar_invitacion(${invitationId}::uuid)`
      const [i] = await tx<{ email: string }[]>`
        select email from public.user_invitations
        where id = ${invitationId} and tenant_id = ${ctx.tenantId}`
      return { token: r!.token, email: i?.email ?? '' }
    })
  } catch (e) {
    return {
      ok: false,
      error: mensajeDeBase(e, 'No pudimos reenviar la invitacion. Intenta de nuevo.'),
    }
  }

  const envio = await entregar(ctx, invitationId, nueva.token)
  revalidatePath('/usuarios')
  return resultado(nueva.email, envio, nueva.token)
}

// ═══════════════════════════════════════════════════════════════════════
//  Revocar
// ═══════════════════════════════════════════════════════════════════════

export async function revocarInvitacion(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'users', 'users.create')
  if (!permiso.ok) return permiso

  const invitationId = String(formData.get('invitationId') ?? '')
  if (!UUID.test(invitationId)) return { ok: false, error: 'Falta la invitacion.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`select public.revocar_invitacion(${invitationId}::uuid)`,
    )
  } catch (e) {
    return {
      ok: false,
      error: mensajeDeBase(e, 'No pudimos revocar la invitacion. Intenta de nuevo.'),
    }
  }

  revalidatePath('/usuarios')
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════
//  Miembros
// ═══════════════════════════════════════════════════════════════════════

export async function cambiarRolMiembro(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
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
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'users', 'users.edit')
  if (!permiso.ok) return permiso

  const userId = String(formData.get('userId') ?? '')
  if (!userId) return { ok: false, error: 'Faltan datos.' }
  if (userId === ctx.userId) return { ok: false, error: 'No puedes desactivarte a ti mismo.' }

  const fila = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [m] = await tx<{ id: string; is_active: boolean }[]>`
      update public.memberships
      set is_active = not is_active, updated_at = now()
      where tenant_id = ${ctx.tenantId} and user_id = ${userId}
      returning id, is_active`
    // Mismo mecanismo y misma transaccion que el cambio: si algo revierte,
    // el evento tampoco existe (outbox, 0007).
    if (m && !m.is_active) {
      await tx`
        select public.emit_event(
          'users.member.deactivated',
          ${tx.json({ membership_id: m.id, user_id: userId, deactivated_by: ctx.userId })},
          'users')`
    }
    return m
  })

  if (!fila) return { ok: false, error: 'Esa persona no esta en tu equipo.' }

  revalidatePath('/usuarios')
  return { ok: true }
}

// ── Versiones para <form action>: el form no consume el resultado ───────
export async function cambiarRolMiembroForm(fd: FormData): Promise<void> {
  await anotarAviso(await cambiarRolMiembro(fd), 'cambiarRolMiembro')
}
export async function alternarActivoForm(fd: FormData): Promise<void> {
  await anotarAviso(await alternarActivo(fd), 'alternarActivo')
}
export async function revocarInvitacionForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await revocarInvitacion(fd),
    'revocarInvitacion',
    'Listo, revocamos la invitacion. Su enlace ya no sirve.',
  )
}
