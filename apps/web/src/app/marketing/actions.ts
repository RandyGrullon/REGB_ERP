'use server'

import { revalidatePath } from 'next/cache'
import { transicionValidaCampana, type EstadoCampana } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Marketing & Campanas (modulo 37, F9/S59).
 *
 * `enviarCampana()` es la unica accion con efecto real: toma la foto
 * de los leads que HOY cumplen el filtro de segmento y crea un
 * destinatario por cada uno -no manda ningun correo ni WhatsApp de
 * verdad, no hay integracion con un proveedor externo todavia-.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function crearCampana(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'marketing', 'marketing.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const channel = String(fd.get('channel') ?? '')
  const subject = String(fd.get('subject') ?? '').trim() || null
  const message = String(fd.get('message') ?? '').trim()
  const targetStatus = String(fd.get('targetStatus') ?? '') || null
  const targetSource = String(fd.get('targetSource') ?? '') || null
  const utmCampaign = String(fd.get('utmCampaign') ?? '').trim() || null

  if (!name) return { ok: false, error: 'Falta el nombre.' }
  if (!['email', 'whatsapp'].includes(channel))
    return { ok: false, error: 'Elige un canal valido.' }
  if (!message) return { ok: false, error: 'Falta el mensaje.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.campaigns (tenant_id, name, channel, subject, message, target_status, target_source, utm_source, utm_medium, utm_campaign, created_by)
    values (${ctx.tenantId}, ${name}, ${channel}, ${subject}, ${message}, ${targetStatus}, ${targetSource}, 'crm', ${channel}, ${utmCampaign}, ${ctx.userId})`,
  )

  revalidatePath('/marketing')
  return { ok: true }
}

/** Avanza el estado sin efectos -borrador a programada, o cualquiera a cancelada-. */
export async function transicionarCampana(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'marketing', 'marketing.manage')
  if (!permiso.ok) return permiso

  const campaignId = String(fd.get('campaignId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoCampana

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [c] = await tx<{ status: EstadoCampana }[]>`
      select status from public.campaigns where id = ${campaignId} and tenant_id = ${ctx.tenantId} for update`
    if (!c) return 'no-existe'
    if (!transicionValidaCampana(c.status, siguiente)) return 'Esa transicion no esta permitida.'

    await tx`update public.campaigns set status = ${siguiente}, updated_at = now() where id = ${campaignId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa campana no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/marketing/${campaignId}`)
  revalidatePath('/marketing')
  return { ok: true }
}

/** Toma la foto de los leads que hoy cumplen el segmento y crea un destinatario real por cada uno. */
export async function enviarCampana(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'marketing', 'marketing.manage')
  if (!permiso.ok) return permiso

  const campaignId = String(fd.get('campaignId') ?? '')

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [c] = await tx<
      { status: EstadoCampana; target_status: string | null; target_source: string | null }[]
    >`
      select status, target_status, target_source from public.campaigns
      where id = ${campaignId} and tenant_id = ${ctx.tenantId} for update`
    if (!c) return 'no-existe'
    if (!transicionValidaCampana(c.status, 'sent'))
      return 'Esa campana no se puede enviar en su estado actual.'

    const leads = await tx<{ id: string }[]>`
      select id from public.leads
      where tenant_id = ${ctx.tenantId}
        and (${c.target_status}::text is null or status = ${c.target_status})
        and (${c.target_source}::text is null or source = ${c.target_source})`

    if (leads.length === 0) return 'Ningun lead cumple el segmento de esta campana.'

    for (const lead of leads) {
      await tx`
        insert into public.campaign_recipients (tenant_id, campaign_id, lead_id)
        values (${ctx.tenantId}, ${campaignId}, ${lead.id})
        on conflict do nothing`
      await tx`update public.leads set campaign_id = ${campaignId} where id = ${lead.id} and campaign_id is null`
    }

    await tx`update public.campaigns set status = 'sent', sent_at = now() where id = ${campaignId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('marketing.campaign.sent',
        ${JSON.stringify({ campaignId, destinatarios: leads.length })}::text::jsonb, 'marketing')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa campana no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/marketing/${campaignId}`)
  revalidatePath('/marketing')
  return { ok: true }
}

export async function marcarAperturaClic(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'marketing', 'marketing.manage')
  if (!permiso.ok) return permiso

  const recipientId = String(fd.get('recipientId') ?? '')
  const tipo = String(fd.get('tipo') ?? '')
  const campaignId = String(fd.get('campaignId') ?? '')

  if (!['opened', 'clicked'].includes(tipo)) return { ok: false, error: 'Tipo invalido.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) =>
    tipo === 'clicked'
      ? tx`update public.campaign_recipients set opened_at = coalesce(opened_at, now()), clicked_at = coalesce(clicked_at, now()) where id = ${recipientId} and tenant_id = ${ctx.tenantId}`
      : tx`update public.campaign_recipients set opened_at = coalesce(opened_at, now()) where id = ${recipientId} and tenant_id = ${ctx.tenantId}`,
  )

  revalidatePath(`/marketing/${campaignId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearCampanaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearCampana(fd), 'crearCampana')
}
export async function transicionarCampanaForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarCampana(fd), 'transicionarCampana')
}
export async function enviarCampanaForm(fd: FormData): Promise<void> {
  await anotarAviso(await enviarCampana(fd), 'enviarCampana')
}
export async function marcarAperturaClicForm(fd: FormData): Promise<void> {
  await anotarAviso(await marcarAperturaClic(fd), 'marcarAperturaClic')
}
