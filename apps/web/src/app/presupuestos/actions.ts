'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de presupuestos (modulo 22, F6/S35).
 *
 * Poner o cambiar el monto de una linea es un simple upsert -a diferencia
 * de un movimiento de dinero, una linea de presupuesto SI se edita
 * libremente mientras el presupuesto no este cerrado; la base (0047) es
 * la que impone el congelamiento, no esta capa-.
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

/** Crea un presupuesto vacio para un ano fiscal. */
export async function crearPresupuesto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'budgets', 'budgets.budget.create')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const fiscalYear = Number.parseInt(String(fd.get('fiscalYear') ?? ''), 10)

  if (name.length < 2) return { ok: false, error: 'Escribe el nombre del presupuesto.' }
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2020 || fiscalYear > 2100) {
    return { ok: false, error: 'El ano fiscal no es valido.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.budgets (tenant_id, name, fiscal_year)
        values (${ctx.tenantId}, ${name}, ${fiscalYear})`

      await tx`
        select public.emit_event('budgets.budget.created',
          ${JSON.stringify({ name, fiscalYear })}::text::jsonb, 'budgets')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key')) {
      return { ok: false, error: 'Ya existe un presupuesto con ese nombre para ese ano.' }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/presupuestos')
  return { ok: true }
}

/** Pone o cambia el monto planeado de una cuenta en un mes. */
export async function ponerLineaPresupuesto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'budgets', 'budgets.line.set')
  if (!permiso.ok) return permiso

  const budgetId = String(fd.get('budgetId') ?? '')
  const accountId = String(fd.get('accountId') ?? '')
  const month = Number.parseInt(String(fd.get('month') ?? ''), 10)
  const amount = num(String(fd.get('amount') ?? ''))

  if (!budgetId || !accountId) return { ok: false, error: 'Faltan datos.' }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, error: 'El mes no es valido.' }
  }
  if (amount === null || amount < 0) return { ok: false, error: 'El monto no puede ser negativo.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.budget_lines (tenant_id, budget_id, account_id, period_month, amount)
      values (${ctx.tenantId}, ${budgetId}, ${accountId}, ${month}, ${amount})
      on conflict (tenant_id, budget_id, account_id, period_month)
      do update set amount = excluded.amount`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('no se edita')) {
      return { ok: false, error: 'Este presupuesto esta cerrado: no se puede editar.' }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/presupuestos/${budgetId}`)
  return { ok: true }
}

/** Cierra el presupuesto: de aqui en adelante queda congelado. */
export async function cerrarPresupuesto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'budgets', 'budgets.budget.close')
  if (!permiso.ok) return permiso

  const budgetId = String(fd.get('budgetId') ?? '')
  if (!budgetId) return { ok: false, error: 'Falta el presupuesto.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    await tx`
      update public.budgets set status = 'closed'
      where id = ${budgetId} and tenant_id = ${ctx.tenantId} and status <> 'closed'`
    await tx`
      select public.emit_event('budgets.budget.closed',
        ${JSON.stringify({ budgetId })}::text::jsonb, 'budgets')`
  })

  revalidatePath('/presupuestos')
  revalidatePath(`/presupuestos/${budgetId}`)
  return { ok: true }
}

/** Activa un presupuesto en borrador. */
export async function activarPresupuesto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'budgets', 'budgets.budget.create')
  if (!permiso.ok) return permiso

  const budgetId = String(fd.get('budgetId') ?? '')
  if (!budgetId) return { ok: false, error: 'Falta el presupuesto.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    update public.budgets set status = 'active'
    where id = ${budgetId} and tenant_id = ${ctx.tenantId} and status = 'draft'`)

  revalidatePath('/presupuestos')
  revalidatePath(`/presupuestos/${budgetId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearPresupuestoForm(fd: FormData): Promise<void> {
  await crearPresupuesto(fd)
}
export async function ponerLineaPresupuestoForm(fd: FormData): Promise<void> {
  await ponerLineaPresupuesto(fd)
}
export async function cerrarPresupuestoForm(fd: FormData): Promise<void> {
  await cerrarPresupuesto(fd)
}
export async function activarPresupuestoForm(fd: FormData): Promise<void> {
  await activarPresupuesto(fd)
}
