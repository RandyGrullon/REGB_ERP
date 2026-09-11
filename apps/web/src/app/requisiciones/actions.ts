'use server'

import { revalidatePath } from 'next/cache'
import { transicionValidaRequisicion, type EstadoRequisicion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de requisiciones (modulo 43, F8/S44).
 *
 * `resolverRequisicion()` llama `exigir(..., 'requisitions.approve',
 * estimated_amount)` -el mismo mecanismo `max_amount` que ya existe en
 * @regb/permissions-. Si el rol de quien aprueba tiene un limite mas
 * bajo que el monto, el propio `can()` lo rechaza con el motivo
 * "amount-exceeded": no hace falta una tabla de cadena de aprobacion
 * aparte, el sistema de roles ya es la jerarquia.
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

/** Registra una requisicion -queda 'pending' de inmediato, lista para aprobar-. */
export async function crearRequisicion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'requisitions', 'requisitions.request')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const department = String(fd.get('department') ?? '').trim() || null
  const description = String(fd.get('description') ?? '').trim()
  const estimatedAmount = num(String(fd.get('estimatedAmount') ?? ''))

  if (!employeeId) return { ok: false, error: 'Elige el empleado.' }
  if (!description) return { ok: false, error: 'Describe que se necesita.' }
  if (estimatedAmount === null || estimatedAmount <= 0) {
    return { ok: false, error: 'El monto estimado debe ser mayor que cero.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.purchase_requisitions
          (tenant_id, employee_id, department, description, estimated_amount, status)
        values (${ctx.tenantId}, ${employeeId}, ${department}, ${description}, ${estimatedAmount}, 'pending')`

      await tx`
        select public.emit_event('requisitions.requisition.submitted',
          ${JSON.stringify({ employeeId, estimatedAmount })}::text::jsonb, 'requisitions')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/requisiciones')
  return { ok: true }
}

/** Aprueba o rechaza una requisicion pendiente -el limite de monto del rol decide-. */
export async function resolverRequisicion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const requisitionId = String(fd.get('requisitionId') ?? '')
  const decision = String(fd.get('decision') ?? '')
  const note = String(fd.get('note') ?? '').trim() || null
  if (!requisitionId) return { ok: false, error: 'Falta la requisicion.' }
  if (decision !== 'approved' && decision !== 'rejected') return { ok: false, error: 'Decision invalida.' }

  try {
    let amountError: string | null = null
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [row] = await tx<{ status: string; estimated_amount: string }[]>`
        select status, estimated_amount::text from public.purchase_requisitions
        where id = ${requisitionId} and tenant_id = ${ctx.tenantId}`
      if (!row) throw new Error('Esa requisicion no existe.')
      if (!transicionValidaRequisicion(row.status as EstadoRequisicion, decision)) {
        throw new Error('Esa requisicion ya fue resuelta.')
      }

      const permiso = exigir(ctx, 'requisitions', 'requisitions.approve', Number(row.estimated_amount))
      if (!permiso.ok) {
        amountError = permiso.error
        return
      }

      await tx`
        update public.purchase_requisitions
        set status = ${decision}, approved_by = ${ctx.userId}, approved_at = now(),
            decision_note = ${note}, updated_at = now()
        where id = ${requisitionId} and tenant_id = ${ctx.tenantId}`

      await tx`
        select public.emit_event(${`requisitions.requisition.${decision}`},
          ${JSON.stringify({ requisitionId })}::text::jsonb, 'requisitions')`
    })
    if (amountError) return { ok: false, error: amountError }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/requisiciones')
  return { ok: true }
}

/** Marca una requisicion aprobada como convertida -con una referencia de texto a la orden resultante-. */
export async function marcarConvertida(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'requisitions', 'requisitions.approve')
  if (!permiso.ok) return permiso

  const requisitionId = String(fd.get('requisitionId') ?? '')
  const poReference = String(fd.get('poReference') ?? '').trim() || null
  if (!requisitionId) return { ok: false, error: 'Falta la requisicion.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [row] = await tx<{ status: string }[]>`
        select status from public.purchase_requisitions where id = ${requisitionId} and tenant_id = ${ctx.tenantId}`
      if (!row) throw new Error('Esa requisicion no existe.')
      if (!transicionValidaRequisicion(row.status as EstadoRequisicion, 'converted')) {
        throw new Error('Solo una requisicion aprobada se puede convertir.')
      }

      await tx`
        update public.purchase_requisitions
        set status = 'converted', po_reference = ${poReference}, updated_at = now()
        where id = ${requisitionId} and tenant_id = ${ctx.tenantId}`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/requisiciones')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearRequisicionForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearRequisicion(fd), 'crearRequisicion')
}
export async function resolverRequisicionForm(fd: FormData): Promise<void> {
  await anotarAviso(await resolverRequisicion(fd), 'resolverRequisicion')
}
export async function marcarConvertidaForm(fd: FormData): Promise<void> {
  await anotarAviso(await marcarConvertida(fd), 'marcarConvertida')
}
