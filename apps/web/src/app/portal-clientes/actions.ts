'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { transicionValidaInvitacion, type EstadoInvitacion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Portal de clientes (modulo 39, F9/S58).
 *
 * El token es un secreto de alta entropia generado con
 * `crypto.randomBytes` -no un id predecible-: quien lo tenga entra,
 * por eso revocar una invitacion tiene que dejarla inutilizable de
 * inmediato (`transicionValidaInvitacion()` lo exige).
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function crearInvitacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'customer-portal', 'customer-portal.manage')
  if (!permiso.ok) return permiso

  const customerId = String(fd.get('customerId') ?? '')
  const email = String(fd.get('email') ?? '').trim()

  if (!customerId) return { ok: false, error: 'Elige el cliente.' }
  if (!email) return { ok: false, error: 'Falta el correo.' }

  const token = randomBytes(24).toString('base64url')

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.portal_invites (tenant_id, customer_id, email, token, status, created_by)
    values (${ctx.tenantId}, ${customerId}, ${email}, ${token}, 'active', ${ctx.userId})`)

  revalidatePath('/portal-clientes')
  return { ok: true }
}

/** Revoca una invitacion -deja de funcionar de inmediato, es terminal-. */
export async function revocarInvitacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'customer-portal', 'customer-portal.manage')
  if (!permiso.ok) return permiso

  const inviteId = String(fd.get('inviteId') ?? '')

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [inv] = await tx<{ status: EstadoInvitacion }[]>`
      select status from public.portal_invites where id = ${inviteId} and tenant_id = ${ctx.tenantId} for update`
    if (!inv) return 'no-existe'
    if (!transicionValidaInvitacion(inv.status, 'revoked')) return 'Esa invitacion ya esta revocada.'

    await tx`
      update public.portal_invites set status = 'revoked', revoked_at = now()
      where id = ${inviteId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('customer-portal.invite.revoked',
        ${JSON.stringify({ inviteId })}::text::jsonb, 'customer-portal')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa invitacion no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/portal-clientes')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearInvitacionForm(fd: FormData): Promise<void> {
  await crearInvitacion(fd)
}
export async function revocarInvitacionForm(fd: FormData): Promise<void> {
  await revocarInvitacion(fd)
}
