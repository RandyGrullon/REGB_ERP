'use server'

import { revalidatePath } from 'next/cache'
import {
  PROBABILIDAD_POR_ETAPA,
  transicionValidaEtapa,
  type EstadoOportunidad,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Oportunidades / Pipeline (modulo 30, F9/S55).
 *
 * `transicionValidaEtapa()` valida la maquina de estados antes de
 * escribir. Al avanzar de etapa, la probabilidad se actualiza sola al
 * valor por defecto de la nueva etapa -no queda un numero viejo de la
 * etapa anterior olvidado en el forecast-.
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

export async function crearOportunidad(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'pipeline', 'pipeline.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const amount = num(String(fd.get('amount') ?? ''))
  const leadId = String(fd.get('leadId') ?? '') || null

  if (!name) return { ok: false, error: 'Ponle un nombre a la oportunidad.' }
  if (amount === null || amount < 0) return { ok: false, error: 'El monto debe ser un numero valido.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.opportunities (tenant_id, lead_id, name, amount, probability)
    values (${ctx.tenantId}, ${leadId}, ${name}, ${amount}, ${PROBABILIDAD_POR_ETAPA.prospecting})`)

  revalidatePath('/pipeline')
  return { ok: true }
}

/** Avanza una oportunidad a la siguiente etapa -o a perdida, desde cualquier etapa no terminal-. */
export async function transicionarEtapa(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'pipeline', 'pipeline.manage')
  if (!permiso.ok) return permiso

  const oportunidadId = String(fd.get('oportunidadId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoOportunidad
  const lostReason = String(fd.get('lostReason') ?? '').trim() || null

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [op] = await tx<{ stage: EstadoOportunidad }[]>`
      select stage from public.opportunities where id = ${oportunidadId} and tenant_id = ${ctx.tenantId} for update`
    if (!op) return 'no-existe'
    if (!transicionValidaEtapa(op.stage, siguiente)) return 'Esa transicion no esta permitida.'
    if (siguiente === 'lost' && !lostReason) return 'Explica el motivo de la perdida.'

    await tx`
      update public.opportunities
      set stage = ${siguiente}, probability = ${PROBABILIDAD_POR_ETAPA[siguiente]},
          lost_reason = ${siguiente === 'lost' ? lostReason : null}, updated_at = now()
      where id = ${oportunidadId} and tenant_id = ${ctx.tenantId}`

    if (siguiente === 'won' || siguiente === 'lost') {
      await tx`
        select public.emit_event(${`pipeline.opportunity.${siguiente}`},
          ${JSON.stringify({ opportunityId: oportunidadId })}::text::jsonb, 'pipeline')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa oportunidad no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/pipeline')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearOportunidadForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearOportunidad(fd), 'crearOportunidad')
}
export async function transicionarEtapaForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarEtapa(fd), 'transicionarEtapa')
}
