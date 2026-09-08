'use server'

import { revalidatePath } from 'next/cache'
import { transicionValidaTicket, type EstadoTicket } from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'
import { SLA_HORAS_POR_PRIORIDAD } from './estados'

/**
 * Acciones de Mesa de ayuda (modulo 40, F9/S58).
 *
 * El SLA se fija una sola vez al crear el ticket -segun la prioridad
 * elegida ese dia-, no se recalcula si la prioridad cambia despues.
 * Resuelto SI se puede reabrir; cerrado es terminal de verdad
 * (`transicionValidaTicket()` lo exige).
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function crearTicket(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'helpdesk', 'helpdesk.manage')
  if (!permiso.ok) return permiso

  const subject = String(fd.get('subject') ?? '').trim()
  const description = String(fd.get('description') ?? '').trim()
  const priority = String(fd.get('priority') ?? 'normal')
  const customerId = String(fd.get('customerId') ?? '') || null

  if (!subject) return { ok: false, error: 'Falta el asunto.' }
  if (!description) return { ok: false, error: 'Falta la descripcion.' }
  const horas = SLA_HORAS_POR_PRIORIDAD[priority]
  if (horas === undefined) return { ok: false, error: 'Elige una prioridad valida.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.tickets (tenant_id, customer_id, subject, description, priority, sla_due_at, created_by)
    values (${ctx.tenantId}, ${customerId}, ${subject}, ${description}, ${priority}, now() + (${horas} || ' hours')::interval, ${ctx.userId})`)

  revalidatePath('/mesa-de-ayuda')
  return { ok: true }
}

/** Avanza el estado del ticket -resuelto SI se puede reabrir, cerrado no-. */
export async function transicionarTicket(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'helpdesk', 'helpdesk.manage')
  if (!permiso.ok) return permiso

  const ticketId = String(fd.get('ticketId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoTicket
  const satisfactionRaw = String(fd.get('satisfaction') ?? '')
  const satisfaction = satisfactionRaw ? Number(satisfactionRaw) : null

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [t] = await tx<{ status: EstadoTicket }[]>`
      select status from public.tickets where id = ${ticketId} and tenant_id = ${ctx.tenantId} for update`
    if (!t) return 'no-existe'
    if (!transicionValidaTicket(t.status, siguiente)) return 'Esa transicion no esta permitida.'
    if (satisfaction !== null && (satisfaction < 1 || satisfaction > 5)) return 'La satisfaccion debe ser de 1 a 5.'

    const resolviendo = siguiente === 'resolved'
    const cerrando = siguiente === 'closed'
    await tx`
      update public.tickets
      set status = ${siguiente}, updated_at = now(),
          resolved_at = case when ${resolviendo} then now() else resolved_at end,
          closed_at = case when ${cerrando} then now() else closed_at end,
          satisfaction_rating = coalesce(${satisfaction}, satisfaction_rating)
      where id = ${ticketId} and tenant_id = ${ctx.tenantId}`

    if (cerrando) {
      await tx`
        select public.emit_event('helpdesk.ticket.closed',
          ${JSON.stringify({ ticketId })}::text::jsonb, 'helpdesk')`
    } else if (resolviendo) {
      await tx`
        select public.emit_event('helpdesk.ticket.resolved',
          ${JSON.stringify({ ticketId })}::text::jsonb, 'helpdesk')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese ticket no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/mesa-de-ayuda/${ticketId}`)
  revalidatePath('/mesa-de-ayuda')
  return { ok: true }
}

export async function agregarMensaje(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'helpdesk', 'helpdesk.manage')
  if (!permiso.ok) return permiso

  const ticketId = String(fd.get('ticketId') ?? '')
  const body = String(fd.get('body') ?? '').trim()
  if (!body) return { ok: false, error: 'Escribe un mensaje.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.ticket_messages (tenant_id, ticket_id, author_type, body)
    values (${ctx.tenantId}, ${ticketId}, 'agent', ${body})`)

  revalidatePath(`/mesa-de-ayuda/${ticketId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearTicketForm(fd: FormData): Promise<void> {
  await crearTicket(fd)
}
export async function transicionarTicketForm(fd: FormData): Promise<void> {
  await transicionarTicket(fd)
}
export async function agregarMensajeForm(fd: FormData): Promise<void> {
  await agregarMensaje(fd)
}
