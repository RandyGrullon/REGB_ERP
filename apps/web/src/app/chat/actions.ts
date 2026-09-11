'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Chat interno (modulo 92, F9/S65-66).
 *
 * Un mensaje enviado es un hecho historico -inmutable desde el
 * insert, igual que un mensaje de ticket-. Las menciones se eligen de
 * la lista real de usuarios del tenant, nunca se parsean de texto
 * libre.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function crearCanal(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'chat', 'chat.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const scopeType = String(fd.get('scopeType') ?? 'general')
  const scopeLabel = String(fd.get('scopeLabel') ?? '').trim() || null

  if (!name) return { ok: false, error: 'Falta el nombre del canal.' }
  if (!['module', 'project', 'branch', 'general'].includes(scopeType)) return { ok: false, error: 'Elige un ambito valido.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.chat_channels (tenant_id, name, scope_type, scope_label, created_by)
    values (${ctx.tenantId}, ${name}, ${scopeType}, ${scopeLabel}, ${ctx.userId})`)

  revalidatePath('/chat')
  return { ok: true }
}

export async function enviarMensaje(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'chat', 'chat.manage')
  if (!permiso.ok) return permiso

  const channelId = String(fd.get('channelId') ?? '')
  const body = String(fd.get('body') ?? '').trim()
  const parentMessageId = String(fd.get('parentMessageId') ?? '') || null
  const mentionedUserIds = fd.getAll('mentions').map(String)

  if (!body) return { ok: false, error: 'Escribe un mensaje.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    await tx`
      insert into public.chat_messages (tenant_id, channel_id, parent_message_id, author_id, body, mentioned_user_ids)
      values (${ctx.tenantId}, ${channelId}, ${parentMessageId}, ${ctx.userId}, ${body}, ${mentionedUserIds})`

    await tx`
      select public.emit_event('chat.message.posted',
        ${JSON.stringify({ channelId })}::text::jsonb, 'chat')`
  })

  revalidatePath(`/chat/${channelId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearCanalForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearCanal(fd), 'crearCanal')
}
export async function enviarMensajeForm(fd: FormData): Promise<void> {
  await anotarAviso(await enviarMensaje(fd), 'enviarMensaje')
}
