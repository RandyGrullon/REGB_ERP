'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Costeo de proyectos (modulo 73, F10/S68).
 *
 * Un costo real es un hecho historico: se registra y no cambia de
 * monto nunca -`impedir_editar_costo()` solo deja mover `billed`,
 * porque eso es informacion NUEVA, no una correccion del pasado-.
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

export async function agregarPresupuesto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'project-costing', 'project-costing.manage')
  if (!permiso.ok) return permiso

  const projectId = String(fd.get('projectId') ?? '')
  const concept = String(fd.get('concept') ?? '').trim()
  const category = String(fd.get('category') ?? 'general')
  const amount = num(String(fd.get('amount') ?? ''))

  if (!concept) return { ok: false, error: 'Falta el concepto.' }
  if (!['general', 'labor', 'materials', 'equipment', 'subcontract'].includes(category)) {
    return { ok: false, error: 'Elige una categoria valida.' }
  }
  if (amount === null || amount < 0) return { ok: false, error: 'El monto no puede ser negativo.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.project_budgets (tenant_id, project_id, concept, category, amount, created_by)
    values (${ctx.tenantId}, ${projectId}, ${concept}, ${category}, ${amount}, ${ctx.userId})`)

  revalidatePath(`/costeo-proyectos/${projectId}`)
  return { ok: true }
}

export async function registrarCosto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'project-costing', 'project-costing.manage')
  if (!permiso.ok) return permiso

  const projectId = String(fd.get('projectId') ?? '')
  const budgetId = String(fd.get('budgetId') ?? '') || null
  const concept = String(fd.get('concept') ?? '').trim()
  const amount = num(String(fd.get('amount') ?? ''))
  const incurredOn = String(fd.get('incurredOn') ?? '') || null

  if (!concept) return { ok: false, error: 'Falta el concepto.' }
  if (amount === null || amount <= 0) return { ok: false, error: 'El monto debe ser mayor que cero.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.project_costs (tenant_id, project_id, budget_id, concept, amount, incurred_on, created_by)
    values (${ctx.tenantId}, ${projectId}, ${budgetId}, ${concept}, ${amount},
            coalesce(${incurredOn}::date, current_date), ${ctx.userId})`)

  revalidatePath(`/costeo-proyectos/${projectId}`)
  return { ok: true }
}

/** Marcar facturado SI se permite: es informacion nueva, no una correccion del monto. */
export async function marcarFacturado(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'project-costing', 'project-costing.manage')
  if (!permiso.ok) return permiso

  const costId = String(fd.get('costId') ?? '')
  const projectId = String(fd.get('projectId') ?? '')

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    update public.project_costs set billed = true
    where id = ${costId} and tenant_id = ${ctx.tenantId} and not billed`)

  revalidatePath(`/costeo-proyectos/${projectId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function agregarPresupuestoForm(fd: FormData): Promise<void> {
  await agregarPresupuesto(fd)
}
export async function registrarCostoForm(fd: FormData): Promise<void> {
  await registrarCosto(fd)
}
export async function marcarFacturadoForm(fd: FormData): Promise<void> {
  await marcarFacturado(fd)
}
