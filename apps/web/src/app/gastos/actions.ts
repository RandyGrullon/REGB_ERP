'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de gastos y reembolsos (modulo 68, F7/S40).
 *
 * Sin OCR real: el monto, la fecha y el proveedor los escribe quien
 * reporta el gasto -no se procesa ninguna foto-.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const CATEGORIAS = ['travel', 'meals', 'transport', 'supplies', 'lodging', 'other']
const METODOS_REEMBOLSO = ['payroll', 'transfer', 'cash']

const num = (raw: string): number | null => {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Reporta un gasto -queda en `submitted` hasta que alguien lo resuelva-. */
export async function reportarGasto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'expenses', 'expenses.submit')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const category = String(fd.get('category') ?? '')
  const expenseDate = String(fd.get('expenseDate') ?? '')
  const amount = num(String(fd.get('amount') ?? ''))
  const vendorName = String(fd.get('vendorName') ?? '').trim() || null
  const vendorTaxId = String(fd.get('vendorTaxId') ?? '').trim() || null
  const ncf = String(fd.get('ncf') ?? '').trim().toUpperCase() || null
  const receiptNote = String(fd.get('receiptNote') ?? '').trim() || null

  if (!employeeId) return { ok: false, error: 'Elige el empleado.' }
  if (!CATEGORIAS.includes(category)) return { ok: false, error: 'Elige una categoria valida.' }
  if (!expenseDate) return { ok: false, error: 'Elige la fecha del gasto.' }
  if (amount === null || amount <= 0) return { ok: false, error: 'El monto debe ser mayor que cero.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.expenses
          (tenant_id, employee_id, category, expense_date, amount, vendor_name, vendor_tax_id, ncf, receipt_note)
        values (${ctx.tenantId}, ${employeeId}, ${category}, ${expenseDate}, ${amount},
                ${vendorName}, ${vendorTaxId}, ${ncf}, ${receiptNote})`

      await tx`
        select public.emit_event('expenses.expense.submitted',
          ${JSON.stringify({ employeeId, category, amount })}::text::jsonb, 'expenses')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/gastos')
  return { ok: true }
}

/** Aprueba o rechaza un gasto reportado. */
export async function resolverGasto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'expenses', 'expenses.approve')
  if (!permiso.ok) return permiso

  const recordId = String(fd.get('recordId') ?? '')
  const decision = String(fd.get('decision') ?? '')
  const note = String(fd.get('note') ?? '').trim() || null
  if (!recordId) return { ok: false, error: 'Falta el gasto.' }
  if (decision !== 'approved' && decision !== 'rejected') return { ok: false, error: 'Decision invalida.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [row] = await tx<{ status: string }[]>`
        select status from public.expenses where id = ${recordId} and tenant_id = ${ctx.tenantId}`
      if (!row) throw new Error('Ese gasto no existe.')
      if (row.status !== 'submitted') throw new Error('Ese gasto ya fue resuelto.')

      await tx`
        update public.expenses
        set status = ${decision}, decided_by = ${ctx.userId}, decided_at = now(),
            decision_note = ${note}, updated_at = now()
        where id = ${recordId} and tenant_id = ${ctx.tenantId}`

      await tx`
        select public.emit_event(${`expenses.expense.${decision}`},
          ${JSON.stringify({ recordId })}::text::jsonb, 'expenses')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/gastos')
  revalidatePath('/gastos/aprobar')
  return { ok: true }
}

/** Marca un gasto aprobado como reembolsado -registra el hecho, no toca la nomina-. */
export async function reembolsarGasto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'expenses', 'expenses.reimburse')
  if (!permiso.ok) return permiso

  const recordId = String(fd.get('recordId') ?? '')
  const method = String(fd.get('method') ?? '')
  const payrollPeriodId = String(fd.get('payrollPeriodId') ?? '') || null
  if (!recordId) return { ok: false, error: 'Falta el gasto.' }
  if (!METODOS_REEMBOLSO.includes(method)) return { ok: false, error: 'Elige un metodo de reembolso valido.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [row] = await tx<{ status: string }[]>`
        select status from public.expenses where id = ${recordId} and tenant_id = ${ctx.tenantId}`
      if (!row) throw new Error('Ese gasto no existe.')
      if (row.status !== 'approved') throw new Error('Solo un gasto aprobado se puede reembolsar.')

      await tx`
        update public.expenses
        set status = 'reimbursed', reimbursed_at = now(), reimbursement_method = ${method},
            payroll_period_id = ${payrollPeriodId}, updated_at = now()
        where id = ${recordId} and tenant_id = ${ctx.tenantId}`

      await tx`
        select public.emit_event('expenses.expense.reimbursed',
          ${JSON.stringify({ recordId, method })}::text::jsonb, 'expenses')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/gastos')
  revalidatePath('/gastos/aprobar')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function reportarGastoForm(fd: FormData): Promise<void> {
  await reportarGasto(fd)
}
export async function resolverGastoForm(fd: FormData): Promise<void> {
  await resolverGasto(fd)
}
export async function reembolsarGastoForm(fd: FormData): Promise<void> {
  await reembolsarGasto(fd)
}
