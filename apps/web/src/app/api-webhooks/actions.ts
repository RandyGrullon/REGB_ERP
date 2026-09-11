'use server'

import { createHash, createHmac, randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { tipoEventoValido } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de API & Webhooks (modulo 89, F9/S64).
 *
 * La llave se genera con `crypto.randomBytes` y solo se guarda su
 * hash SHA-256 -el mismo `createHash('sha256')` de `node:crypto` que
 * ya uso `e-sign` para su rastro de firma-. `enviarPrueba()` SI hace
 * una llamada HTTP real, a diferencia de `ecommerce`/`marketing` que
 * deliberadamente no llaman a ningun proveedor externo.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export type CrearLlaveResult = { ok: true; key: string } | { ok: false; error: string }

/** Devuelve la llave COMPLETA una sola vez -de aqui en adelante solo se guarda su hash-. */
export async function crearLlave(_prevState: unknown, fd: FormData): Promise<CrearLlaveResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'api-webhooks', 'api-webhooks.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const scopes = fd.getAll('scopes').map(String)
  const rateLimit = Number(fd.get('rateLimit') ?? '60') || 60

  if (!name) return { ok: false, error: 'Falta el nombre de la llave.' }
  if (scopes.length === 0) return { ok: false, error: 'Elige al menos un permiso.' }

  const key = `regb_${randomBytes(24).toString('base64url')}`
  const keyPrefix = key.slice(0, 12)
  const keyHash = createHash('sha256').update(key).digest('hex')

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.api_keys (tenant_id, name, key_prefix, key_hash, scopes, rate_limit_per_minute, created_by)
    values (${ctx.tenantId}, ${name}, ${keyPrefix}, ${keyHash}, ${scopes}, ${rateLimit}, ${ctx.userId})`)

  revalidatePath('/api-webhooks')
  return { ok: true, key }
}

export async function revocarLlave(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'api-webhooks', 'api-webhooks.manage')
  if (!permiso.ok) return permiso

  const keyId = String(fd.get('keyId') ?? '')

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    update public.api_keys set status = 'revoked', revoked_at = now()
    where id = ${keyId} and tenant_id = ${ctx.tenantId} and status = 'active'`)

  revalidatePath('/api-webhooks')
  return { ok: true }
}

export async function crearEndpoint(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'api-webhooks', 'api-webhooks.manage')
  if (!permiso.ok) return permiso

  const url = String(fd.get('url') ?? '').trim()
  const eventTypesRaw = String(fd.get('eventTypes') ?? '').trim()
  const eventTypes = eventTypesRaw.split(',').map((s) => s.trim()).filter(Boolean)

  if (!url) return { ok: false, error: 'Falta la URL del endpoint.' }
  try {
    new URL(url)
  } catch {
    return { ok: false, error: 'Esa URL no es valida.' }
  }
  if (eventTypes.length === 0) return { ok: false, error: 'Elige al menos un tipo de evento.' }
  if (!eventTypes.every(tipoEventoValido)) return { ok: false, error: 'Cada tipo de evento debe seguir modulo.entidad.accion.' }

  const secret = randomBytes(24).toString('hex')

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.webhook_endpoints (tenant_id, url, event_types, secret, created_by)
    values (${ctx.tenantId}, ${url}, ${eventTypes}, ${secret}, ${ctx.userId})`)

  revalidatePath('/api-webhooks')
  return { ok: true }
}

export async function alternarEndpoint(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'api-webhooks', 'api-webhooks.manage')
  if (!permiso.ok) return permiso

  const endpointId = String(fd.get('endpointId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '')
  if (!['active', 'paused'].includes(siguiente)) return { ok: false, error: 'Estado invalido.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    update public.webhook_endpoints set status = ${siguiente} where id = ${endpointId} and tenant_id = ${ctx.tenantId}`)

  revalidatePath('/api-webhooks')
  return { ok: true }
}

/** Emite un evento de prueba real y hace una llamada HTTP real al endpoint -no simulada-. */
export async function enviarPrueba(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'api-webhooks', 'api-webhooks.manage')
  if (!permiso.ok) return permiso

  const endpointId = String(fd.get('endpointId') ?? '')

  const { endpoint, eventId } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [e] = await tx<{ url: string; secret: string }[]>`
      select url, secret from public.webhook_endpoints where id = ${endpointId} and tenant_id = ${ctx.tenantId}`
    if (!e) return { endpoint: null, eventId: null }

    const [ev] = await tx<{ id: string }[]>`
      select public.emit_event('api-webhooks.webhook.tested',
        ${JSON.stringify({ endpointId })}::text::jsonb, 'api-webhooks')::text as id`

    return { endpoint: e, eventId: ev!.id }
  })

  if (!endpoint || !eventId) return { ok: false, error: 'Ese endpoint no existe.' }

  const payload = JSON.stringify({ type: 'api-webhooks.webhook.tested', endpointId, sentAt: new Date().toISOString() })
  const signature = createHmac('sha256', endpoint.secret).update(payload).digest('hex')

  let statusCode: number | null = null
  let success = false
  let responseBody: string | null = null

  try {
    const respuesta = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-regb-signature': signature },
      body: payload,
      signal: AbortSignal.timeout(8000),
    })
    statusCode = respuesta.status
    success = respuesta.ok
    responseBody = (await respuesta.text()).slice(0, 500)
  } catch (err) {
    responseBody = err instanceof Error ? err.message : 'Error de red desconocido.'
  }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.webhook_deliveries (tenant_id, endpoint_id, event_id, status_code, success, response_body)
    values (${ctx.tenantId}, ${endpointId}, ${eventId}, ${statusCode}, ${success}, ${responseBody})`)

  revalidatePath('/api-webhooks')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function revocarLlaveForm(fd: FormData): Promise<void> {
  await anotarAviso(await revocarLlave(fd), 'revocarLlave')
}
export async function crearEndpointForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearEndpoint(fd), 'crearEndpoint')
}
export async function alternarEndpointForm(fd: FormData): Promise<void> {
  await anotarAviso(await alternarEndpoint(fd), 'alternarEndpoint')
}
export async function enviarPruebaForm(fd: FormData): Promise<void> {
  await anotarAviso(await enviarPrueba(fd), 'enviarPrueba')
}
