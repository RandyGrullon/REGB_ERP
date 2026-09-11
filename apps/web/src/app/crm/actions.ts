'use server'

import { revalidatePath } from 'next/cache'
import { asignarRoundRobin, puntuarLead, transicionValidaLead, type EstadoLead, type FuenteLead } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de CRM / Leads (modulo 29, F9/S55).
 *
 * `puntuarLead()` decide el puntaje al crear el lead -no se recalcula
 * despues, es una foto del momento de captura-. `asignarRoundRobin()`
 * reparte los leads sin asignar, retomando la vuelta desde el ultimo
 * vendedor que recibio uno.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function crearLead(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'crm', 'crm.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const company = String(fd.get('company') ?? '').trim() || null
  const email = String(fd.get('email') ?? '').trim() || null
  const phone = String(fd.get('phone') ?? '').trim() || null
  const source = String(fd.get('source') ?? '') as FuenteLead

  if (!name) return { ok: false, error: 'Ponle un nombre al lead.' }
  if (!['referral', 'event', 'web', 'cold'].includes(source)) {
    return { ok: false, error: 'Elige una fuente valida.' }
  }

  const score = puntuarLead({ tieneEmail: email !== null, tieneTelefono: phone !== null, fuente: source })

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.leads (tenant_id, name, company, email, phone, source, score)
    values (${ctx.tenantId}, ${name}, ${company}, ${email}, ${phone}, ${source}, ${score})`)

  revalidatePath('/crm')
  return { ok: true }
}

/** Avanza el estado de un lead -new/contacted/qualified/disqualified/converted-. */
export async function transicionarLead(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'crm', 'crm.manage')
  if (!permiso.ok) return permiso

  const leadId = String(fd.get('leadId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoLead

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [lead] = await tx<{ status: EstadoLead }[]>`
      select status from public.leads where id = ${leadId} and tenant_id = ${ctx.tenantId} for update`
    if (!lead) return 'no-existe'
    if (!transicionValidaLead(lead.status, siguiente)) return 'Esa transicion no esta permitida.'

    await tx`
      update public.leads set status = ${siguiente}, updated_at = now()
      where id = ${leadId} and tenant_id = ${ctx.tenantId}`

    if (siguiente === 'qualified' || siguiente === 'converted') {
      await tx`
        select public.emit_event(${`crm.lead.${siguiente === 'qualified' ? 'qualified' : 'converted'}`},
          ${JSON.stringify({ leadId })}::text::jsonb, 'crm')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese lead no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/crm/${leadId}`)
  revalidatePath('/crm')
  return { ok: true }
}

export async function registrarActividad(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'crm', 'crm.manage')
  if (!permiso.ok) return permiso

  const leadId = String(fd.get('leadId') ?? '')
  const type = String(fd.get('type') ?? '')
  const notes = String(fd.get('notes') ?? '').trim()

  if (!['call', 'email', 'meeting', 'note'].includes(type)) return { ok: false, error: 'Elige un tipo valido.' }
  if (!notes) return { ok: false, error: 'Escribe que paso.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.lead_activities (tenant_id, lead_id, type, notes, created_by)
    values (${ctx.tenantId}, ${leadId}, ${type}, ${notes}, ${ctx.userId})`)

  revalidatePath(`/crm/${leadId}`)
  return { ok: true }
}

/** Reparte todos los leads nuevos sin asignar entre vendedores activos, en round-robin. */
export async function asignarLeadsPendientes(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'crm', 'crm.manage')
  if (!permiso.ok) return permiso

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const pendientes = await tx<{ id: string }[]>`
      select id from public.leads
      where tenant_id = ${ctx.tenantId} and assigned_to is null and status != 'disqualified'
      order by created_at`
    if (pendientes.length === 0) return

    const vendedores = await tx<{ id: string }[]>`
      select user_id as id from public.user_profiles where tenant_id = ${ctx.tenantId} order by display_name`
    if (vendedores.length === 0) return

    const [ultimo] = await tx<{ assigned_to: string }[]>`
      select assigned_to from public.leads
      where tenant_id = ${ctx.tenantId} and assigned_to is not null
      order by updated_at desc limit 1`
    const vendedorIds = vendedores.map((v) => v.id)
    const ultimoIndice = ultimo ? vendedorIds.indexOf(ultimo.assigned_to) : -1

    const asignaciones = asignarRoundRobin(
      pendientes.map((p) => p.id),
      vendedorIds,
      ultimoIndice,
    )

    for (const a of asignaciones) {
      await tx`
        update public.leads set assigned_to = ${a.vendedorId}, updated_at = now()
        where id = ${a.leadId} and tenant_id = ${ctx.tenantId}`
    }
  })

  revalidatePath('/crm')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearLeadForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearLead(fd), 'crearLead')
}
export async function transicionarLeadForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarLead(fd), 'transicionarLead')
}
export async function registrarActividadForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarActividad(fd), 'registrarActividad')
}
export async function asignarLeadsPendientesForm(fd: FormData): Promise<void> {
  await anotarAviso(await asignarLeadsPendientes(fd), 'asignarLeadsPendientes')
}
