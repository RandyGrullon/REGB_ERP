'use server'

import { revalidatePath } from 'next/cache'
import { transicionValida, type EtapaAplicacion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de reclutamiento (modulo 65, F7/S41).
 *
 * Las transiciones de etapa se validan aqui con transicionValida()
 * (@regb/operations) -no en SQL-: no se puede saltar de "aplico" a
 * "oferta" ni reabrir una aplicacion ya resuelta.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const ESTADOS_VACANTE = ['open', 'closed', 'on_hold']
const FUENTES_CANDIDATO = ['referral', 'website', 'other']
const ETAPAS: EtapaAplicacion[] = [
  'applied',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
]

/** Crea una vacante nueva. */
export async function crearVacante(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'recruiting', 'recruiting.manage-positions')
  if (!permiso.ok) return permiso

  const title = String(fd.get('title') ?? '').trim()
  const department = String(fd.get('department') ?? '').trim() || null
  const description = String(fd.get('description') ?? '').trim() || null

  if (!title) return { ok: false, error: 'Escribe el titulo de la vacante.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.recruiting_positions (tenant_id, title, department, description)
      values (${ctx.tenantId}, ${title}, ${department}, ${description})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/reclutamiento')
  return { ok: true }
}

/** Cierra o pausa una vacante. */
export async function cambiarEstadoVacante(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'recruiting', 'recruiting.manage-positions')
  if (!permiso.ok) return permiso

  const positionId = String(fd.get('positionId') ?? '')
  const status = String(fd.get('status') ?? '')
  if (!positionId) return { ok: false, error: 'Falta la vacante.' }
  if (!ESTADOS_VACANTE.includes(status)) return { ok: false, error: 'Estado invalido.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      update public.recruiting_positions set status = ${status}, updated_at = now()
      where id = ${positionId} and tenant_id = ${ctx.tenantId}`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/reclutamiento')
  return { ok: true }
}

/** Registra un candidato nuevo -sin foto de curriculum, se escribe a mano-. */
export async function crearCandidato(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'recruiting', 'recruiting.manage-candidates')
  if (!permiso.ok) return permiso

  const firstName = String(fd.get('firstName') ?? '').trim()
  const lastName = String(fd.get('lastName') ?? '').trim()
  const email = String(fd.get('email') ?? '').trim() || null
  const phone = String(fd.get('phone') ?? '').trim() || null
  const source = String(fd.get('source') ?? '')
  const notes = String(fd.get('notes') ?? '').trim() || null

  if (!firstName || !lastName) return { ok: false, error: 'Escribe el nombre completo.' }
  if (!FUENTES_CANDIDATO.includes(source)) return { ok: false, error: 'Elige una fuente valida.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.recruiting_candidates (tenant_id, first_name, last_name, email, phone, source, notes)
      values (${ctx.tenantId}, ${firstName}, ${lastName}, ${email}, ${phone}, ${source}, ${notes})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/reclutamiento')
  return { ok: true }
}

/** Aplica un candidato existente a una vacante. */
export async function crearAplicacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'recruiting', 'recruiting.manage-pipeline')
  if (!permiso.ok) return permiso

  const positionId = String(fd.get('positionId') ?? '')
  const candidateId = String(fd.get('candidateId') ?? '')
  const notes = String(fd.get('notes') ?? '').trim() || null

  if (!positionId) return { ok: false, error: 'Falta la vacante.' }
  if (!candidateId) return { ok: false, error: 'Elige el candidato.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.recruiting_applications (tenant_id, position_id, candidate_id, notes)
        values (${ctx.tenantId}, ${positionId}, ${candidateId}, ${notes})`

      await tx`
        select public.emit_event('recruiting.application.created',
          ${JSON.stringify({ positionId, candidateId })}::text::jsonb, 'recruiting')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/reclutamiento/${positionId}`)
  return { ok: true }
}

/** Avanza -o rechaza- una aplicacion en el pipeline. */
export async function cambiarEtapa(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'recruiting', 'recruiting.manage-pipeline')
  if (!permiso.ok) return permiso

  const applicationId = String(fd.get('applicationId') ?? '')
  const positionId = String(fd.get('positionId') ?? '')
  const nuevaEtapa = String(fd.get('stage') ?? '') as EtapaAplicacion

  if (!applicationId) return { ok: false, error: 'Falta la aplicacion.' }
  if (!ETAPAS.includes(nuevaEtapa)) return { ok: false, error: 'Etapa invalida.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [row] = await tx<{ stage: EtapaAplicacion }[]>`
        select stage from public.recruiting_applications where id = ${applicationId} and tenant_id = ${ctx.tenantId}`
      if (!row) throw new Error('Esa aplicacion no existe.')
      if (!transicionValida(row.stage, nuevaEtapa)) {
        throw new Error(`No se puede pasar de "${row.stage}" a "${nuevaEtapa}" directamente.`)
      }

      await tx`
        update public.recruiting_applications set stage = ${nuevaEtapa}, updated_at = now()
        where id = ${applicationId} and tenant_id = ${ctx.tenantId}`

      await tx`
        select public.emit_event('recruiting.application.stage-changed',
          ${JSON.stringify({ applicationId, stage: nuevaEtapa })}::text::jsonb, 'recruiting')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/reclutamiento/${positionId}`)
  return { ok: true }
}

/** Programa una entrevista para una aplicacion. */
export async function programarEntrevista(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'recruiting', 'recruiting.manage-pipeline')
  if (!permiso.ok) return permiso

  const applicationId = String(fd.get('applicationId') ?? '')
  const positionId = String(fd.get('positionId') ?? '')
  const scheduledAt = String(fd.get('scheduledAt') ?? '')
  const interviewerName = String(fd.get('interviewerName') ?? '').trim() || null

  if (!applicationId) return { ok: false, error: 'Falta la aplicacion.' }
  if (!scheduledAt) return { ok: false, error: 'Elige la fecha y hora.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.recruiting_interviews (tenant_id, application_id, scheduled_at, interviewer_name)
        values (${ctx.tenantId}, ${applicationId}, ${scheduledAt}, ${interviewerName})`

      await tx`
        select public.emit_event('recruiting.interview.scheduled',
          ${JSON.stringify({ applicationId })}::text::jsonb, 'recruiting')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/reclutamiento/${positionId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearVacanteForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearVacante(fd), 'crearVacante')
}
export async function cambiarEstadoVacanteForm(fd: FormData): Promise<void> {
  await anotarAviso(await cambiarEstadoVacante(fd), 'cambiarEstadoVacante')
}
export async function crearCandidatoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearCandidato(fd), 'crearCandidato')
}
export async function crearAplicacionForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearAplicacion(fd), 'crearAplicacion')
}
export async function cambiarEtapaForm(fd: FormData): Promise<void> {
  await anotarAviso(await cambiarEtapa(fd), 'cambiarEtapa')
}
export async function programarEntrevistaForm(fd: FormData): Promise<void> {
  await anotarAviso(await programarEntrevista(fd), 'programarEntrevista')
}
