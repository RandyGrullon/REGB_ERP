'use server'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { transicionValidaFirma, type EstadoFirma } from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Firma electronica (modulo 91, F9/S56).
 *
 * NO es una firma criptografica con certificado ni PKI: al firmar se
 * guarda un hash de lo que se firmo (tipo, folio, firmante, momento)
 * y la IP de origen -trazabilidad real, no validez legal certificada-.
 * `transicionValidaFirma()` valida la maquina de estados antes de
 * escribir.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

async function ipDelSolicitante(): Promise<string | null> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return h.get('x-real-ip')
}

export async function crearSolicitud(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'e-sign', 'e-sign.manage')
  if (!permiso.ok) return permiso

  const documentType = String(fd.get('documentType') ?? '')
  const signerName = String(fd.get('signerName') ?? '').trim()
  const signerEmail = String(fd.get('signerEmail') ?? '').trim()

  if (!['quote', 'other'].includes(documentType)) return { ok: false, error: 'Elige un tipo de documento valido.' }
  if (!signerName || !signerEmail) return { ok: false, error: 'Falta el nombre o el correo de quien firma.' }

  let documentId: string
  let documentLabel: string
  if (documentType === 'quote') {
    const [id, ...labelParts] = String(fd.get('quoteChoice') ?? '').split('|')
    documentLabel = labelParts.join('|')
    if (!id || !documentLabel) return { ok: false, error: 'Elige la cotizacion a firmar.' }
    documentId = id
  } else {
    documentLabel = String(fd.get('manualLabel') ?? '').trim()
    if (!documentLabel) return { ok: false, error: 'Ponle una etiqueta al documento.' }
    documentId = crypto.randomUUID()
  }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [sol] = await tx<{ id: string }[]>`
      insert into public.signature_requests (tenant_id, document_type, document_id, document_label, signer_name, signer_email, created_by)
      values (${ctx.tenantId}, ${documentType}, ${documentId}, ${documentLabel}, ${signerName}, ${signerEmail}, ${ctx.userId})
      returning id`
    await tx`
      insert into public.signature_events (tenant_id, request_id, event_type)
      values (${ctx.tenantId}, ${sol!.id}, 'created')`
  })

  revalidatePath('/firma-electronica')
  return { ok: true }
}

/** Avanza el estado de una solicitud de firma. */
export async function transicionarSolicitud(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'e-sign', 'e-sign.manage')
  if (!permiso.ok) return permiso

  const requestId = String(fd.get('requestId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoFirma
  const declinedReason = String(fd.get('declinedReason') ?? '').trim() || null

  const ip = siguiente === 'signed' ? await ipDelSolicitante() : null

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [sol] = await tx<{ status: EstadoFirma; document_type: string; document_id: string; document_label: string; signer_email: string }[]>`
      select status, document_type, document_id, document_label, signer_email
      from public.signature_requests where id = ${requestId} and tenant_id = ${ctx.tenantId} for update`
    if (!sol) return 'no-existe'
    if (!transicionValidaFirma(sol.status, siguiente)) return 'Esa transicion no esta permitida.'
    if (siguiente === 'declined' && !declinedReason) return 'Explica por que se rechazo.'

    const firmando = siguiente === 'signed'
    const hash = firmando
      ? createHash('sha256')
          .update(`${sol.document_type}|${sol.document_id}|${sol.document_label}|${sol.signer_email}|${new Date().toISOString()}`)
          .digest('hex')
      : null

    await tx`
      update public.signature_requests
      set status = ${siguiente}, updated_at = now(),
          sent_at = case when ${siguiente === 'sent'} then now() else sent_at end,
          signed_at = case when ${firmando} then now() else signed_at end,
          declined_reason = case when ${siguiente === 'declined'} then ${declinedReason} else declined_reason end,
          ip_address = case when ${firmando} then ${ip} else ip_address end,
          signed_hash = case when ${firmando} then ${hash} else signed_hash end
      where id = ${requestId} and tenant_id = ${ctx.tenantId}`

    await tx`
      insert into public.signature_events (tenant_id, request_id, event_type, ip_address)
      values (${ctx.tenantId}, ${requestId}, ${siguiente}, ${ip})`

    if (siguiente === 'signed' || siguiente === 'declined') {
      await tx`
        select public.emit_event(${`e-sign.request.${siguiente === 'signed' ? 'signed' : 'declined'}`},
          ${JSON.stringify({ requestId })}::text::jsonb, 'e-sign')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa solicitud no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/firma-electronica/${requestId}`)
  revalidatePath('/firma-electronica')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearSolicitudForm(fd: FormData): Promise<void> {
  await crearSolicitud(fd)
}
export async function transicionarSolicitudForm(fd: FormData): Promise<void> {
  await transicionarSolicitud(fd)
}
