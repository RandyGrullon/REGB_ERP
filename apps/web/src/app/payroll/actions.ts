'use server'

import { revalidatePath } from 'next/cache'
import { TASAS_TSS_REFERENCIA_2024, calculatePayrollLine } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de nomina (modulo 62, F7/S37-38).
 *
 * procesarPeriodo() es la unica forma de generar lineas: calcula con
 * calculatePayrollLine() de @regb/operations -las tasas NUNCA se
 * reimplementan aqui ni en SQL, un solo lugar de verdad- y guarda una
 * foto de las tasas usadas en el propio periodo, para que un cambio de
 * ISR el ano que viene no recalcule nominas ya procesadas.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

/** Crea un periodo de nomina en borrador. */
export async function crearPeriodo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'payroll', 'payroll.run')
  if (!permiso.ok) return permiso

  const periodStart = String(fd.get('periodStart') ?? '').trim()
  const periodEnd = String(fd.get('periodEnd') ?? '').trim()
  const payDate = String(fd.get('payDate') ?? '').trim()

  if (!periodStart || !periodEnd || !payDate) return { ok: false, error: 'Faltan las fechas del periodo.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date, created_by)
      values (${ctx.tenantId}, ${periodStart}, ${periodEnd}, ${payDate}, ${ctx.userId})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key')) {
      return { ok: false, error: 'Ya existe un periodo con esas mismas fechas.' }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/payroll')
  return { ok: true }
}

/**
 * Calcula la linea de cada empleado activo sin linea todavia en este
 * periodo, y lo marca 'processed'. Las tasas usadas quedan grabadas en
 * el propio periodo -ver comentario de cabecera-.
 */
export async function procesarPeriodo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'payroll', 'payroll.run')
  if (!permiso.ok) return permiso

  const periodId = String(fd.get('periodId') ?? '')
  if (!periodId) return { ok: false, error: 'Falta el periodo.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [periodo] = await tx<{ status: string }[]>`
        select status from public.payroll_periods where id = ${periodId} and tenant_id = ${ctx.tenantId}`
      if (!periodo) throw new Error('sin-periodo')
      if (periodo.status !== 'draft') throw new Error('ya-procesado')

      const empleados = await tx<{ id: string; salary: string }[]>`
        select e.id, e.salary::text from public.employees e
        where e.tenant_id = ${ctx.tenantId} and e.status = 'active'
          and not exists (
            select 1 from public.payroll_lines l
            where l.period_id = ${periodId} and l.employee_id = e.id)`

      for (const emp of empleados) {
        const r = calculatePayrollLine(Number(emp.salary), TASAS_TSS_REFERENCIA_2024)
        await tx`
          insert into public.payroll_lines
            (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
          values (${ctx.tenantId}, ${periodId}, ${emp.id}, ${r.grossSalary}, ${r.tssDeduction},
                  ${r.incomeTax}, ${r.netSalary})`
      }

      await tx`
        update public.payroll_periods
        set status = 'processed', tax_params = ${JSON.stringify(TASAS_TSS_REFERENCIA_2024)}::jsonb
        where id = ${periodId}`

      await tx`
        select public.emit_event('payroll.period.closed',
          ${JSON.stringify({ periodId, empleados: empleados.length })}::text::jsonb, 'payroll')`
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'sin-periodo') {
      return { ok: false, error: 'Ese periodo no existe.' }
    }
    if (e instanceof Error && e.message === 'ya-procesado') {
      return { ok: false, error: 'Ese periodo ya fue procesado.' }
    }
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/payroll')
  revalidatePath('/payroll/reports')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearPeriodoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearPeriodo(fd), 'crearPeriodo')
}
export async function procesarPeriodoForm(fd: FormData): Promise<void> {
  await anotarAviso(await procesarPeriodo(fd), 'procesarPeriodo')
}
