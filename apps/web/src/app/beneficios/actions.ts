'use server'

import { revalidatePath } from 'next/cache'
import {
  cuotaPrestamo,
  saldoPrestamo,
  totalAPagarPrestamo,
  validarPagoPrestamo,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de beneficios (modulo 69, F7/S41).
 *
 * La cuota se calcula UNA vez, aqui, con cuotaPrestamo() (@regb/operations)
 * -nunca en SQL- y se guarda como el compromiso acordado. El saldo, en
 * cambio, NUNCA se guarda: se deriva siempre de saldoPrestamo() sobre los
 * pagos reales.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const TIPOS_PRESTAMO = ['loan', 'advance']
const FUENTES_PAGO = ['payroll', 'cash', 'transfer']

const num = (raw: string): number | null => {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Crea un prestamo o adelanto -la cuota se calcula aqui, no se pide al usuario-. */
export async function crearPrestamo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'benefits', 'benefits.manage-loans')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const loanType = String(fd.get('loanType') ?? '')
  const principal = num(String(fd.get('principal') ?? ''))
  const installments = Number.parseInt(String(fd.get('installments') ?? ''), 10)
  // Se escribe en PORCENTAJE (1.5 = 1.5 % al mes) y se guarda como
  // fraccion. Hasta 0138 el "2" que escribia la gente se guardaba como 2 =
  // 200 % mensual, y la cuota de 12,000 en 6 meses salia en 24,000 al mes.
  const tasaPorcentaje = num(String(fd.get('monthlyRate') ?? '')) ?? 0
  const monthlyRate = tasaPorcentaje / 100
  const startDate = String(fd.get('startDate') ?? '')
  const notes = String(fd.get('notes') ?? '').trim() || null

  if (!employeeId) return { ok: false, error: 'Elige el empleado.' }
  if (!TIPOS_PRESTAMO.includes(loanType)) return { ok: false, error: 'Elige un tipo valido.' }
  if (principal === null || principal <= 0)
    return { ok: false, error: 'El monto debe ser mayor que cero.' }
  if (!Number.isInteger(installments) || installments <= 0) {
    return { ok: false, error: 'Las cuotas deben ser un entero positivo.' }
  }
  if (!startDate) return { ok: false, error: 'Elige la fecha de inicio.' }
  if (tasaPorcentaje < 0 || tasaPorcentaje > 10) {
    return { ok: false, error: 'El interés mensual va de 0 a 10 %.' }
  }

  const installmentAmount = cuotaPrestamo(principal, installments, monthlyRate)

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.benefit_loans
          (tenant_id, employee_id, loan_type, principal, installments, installment_amount,
           monthly_rate, start_date, notes)
        values (${ctx.tenantId}, ${employeeId}, ${loanType}, ${principal}, ${installments},
                ${installmentAmount}, ${monthlyRate}, ${startDate}, ${notes})`

      await tx`
        select public.emit_event('benefits.loan.created',
          ${JSON.stringify({ employeeId, loanType, principal })}::text::jsonb, 'benefits')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/beneficios')
  return { ok: true }
}

/** Registra un pago contra un prestamo -si el saldo llega a cero, el prestamo queda saldado-. */
export async function registrarPago(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'benefits', 'benefits.record-payment')
  if (!permiso.ok) return permiso

  const loanId = String(fd.get('loanId') ?? '')
  const amount = num(String(fd.get('amount') ?? ''))
  const source = String(fd.get('source') ?? '')
  const payrollPeriodId = String(fd.get('payrollPeriodId') ?? '') || null

  if (!loanId) return { ok: false, error: 'Falta el prestamo.' }
  if (amount === null || amount <= 0)
    return { ok: false, error: 'El monto debe ser mayor que cero.' }
  if (!FUENTES_PAGO.includes(source))
    return { ok: false, error: 'Elige una fuente de pago valida.' }
  // "Por nomina" sin nomina bajaba el saldo sin que nadie pagara (0138).
  const porNomina = source === 'payroll' // registry:allow — forma de pago de la cuota, no el modulo
  if (porNomina && !payrollPeriodId) {
    return { ok: false, error: 'Un pago por nómina se registra al procesar la nómina, no a mano.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [loan] = await tx<
        {
          status: string
          principal: string
          installments: number
          installment_amount: string
          monthly_rate: string
        }[]
      >`
        select status, principal::text, installments, installment_amount::text, monthly_rate::text
        from public.benefit_loans
        where id = ${loanId} and tenant_id = ${ctx.tenantId}
        for update`
      if (!loan) throw new Error('Ese prestamo no existe.')
      if (loan.status !== 'active') throw new Error('Ese prestamo ya no esta activo.')

      const total = totalAPagarPrestamo(
        Number(loan.principal),
        loan.installments,
        Number(loan.installment_amount),
        Number(loan.monthly_rate),
      )
      const previos = await tx<{ amount: string }[]>`
        select amount::text from public.benefit_loan_payments
        where tenant_id = ${ctx.tenantId} and loan_id = ${loanId}`
      const regla = validarPagoPrestamo(
        saldoPrestamo(
          total,
          previos.map((p) => ({ amount: Number(p.amount) })),
        ),
        amount,
      )
      if (regla) throw new Error(regla)

      await tx`
        insert into public.benefit_loan_payments (tenant_id, loan_id, amount, source, payroll_period_id)
        values (${ctx.tenantId}, ${loanId}, ${amount}, ${source}, ${payrollPeriodId})`

      const pagos = await tx<{ amount: string }[]>`
        select amount::text from public.benefit_loan_payments
        where tenant_id = ${ctx.tenantId} and loan_id = ${loanId}`
      const saldo = saldoPrestamo(
        total,
        pagos.map((p) => ({ amount: Number(p.amount) })),
      )

      await tx`
        select public.emit_event('benefits.loan.payment-recorded',
          ${JSON.stringify({ loanId, amount })}::text::jsonb, 'benefits')`

      if (saldo === 0) {
        await tx`update public.benefit_loans set status = 'paid', updated_at = now() where id = ${loanId}`
        await tx`
          select public.emit_event('benefits.loan.paid',
            ${JSON.stringify({ loanId })}::text::jsonb, 'benefits')`
      }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/beneficios')
  return { ok: true }
}

/** Inscribe a un empleado en un plan de beneficios. */
export async function crearInscripcion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'benefits', 'benefits.manage-enrollments')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const planName = String(fd.get('planName') ?? '').trim()
  const employeeContribution = num(String(fd.get('employeeContribution') ?? '')) ?? 0
  const employerContribution = num(String(fd.get('employerContribution') ?? '')) ?? 0
  const effectiveDate = String(fd.get('effectiveDate') ?? '')

  if (!employeeId) return { ok: false, error: 'Elige el empleado.' }
  if (!planName) return { ok: false, error: 'Escribe el nombre del plan.' }
  if (!effectiveDate) return { ok: false, error: 'Elige la fecha de vigencia.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.benefit_enrollments
          (tenant_id, employee_id, plan_name, employee_contribution, employer_contribution, effective_date)
        values (${ctx.tenantId}, ${employeeId}, ${planName}, ${employeeContribution},
                ${employerContribution}, ${effectiveDate})`

      await tx`
        select public.emit_event('benefits.enrollment.created',
          ${JSON.stringify({ employeeId, planName })}::text::jsonb, 'benefits')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/beneficios/planes')
  return { ok: true }
}

/** Cancela una inscripcion activa. */
export async function cancelarInscripcion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'benefits', 'benefits.manage-enrollments')
  if (!permiso.ok) return permiso

  const recordId = String(fd.get('recordId') ?? '')
  if (!recordId) return { ok: false, error: 'Falta la inscripcion.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [row] = await tx<{ status: string }[]>`
        select status from public.benefit_enrollments where id = ${recordId} and tenant_id = ${ctx.tenantId}`
      if (!row) throw new Error('Esa inscripcion no existe.')
      if (row.status === 'cancelled') throw new Error('Esa inscripcion ya estaba cancelada.')

      await tx`
        update public.benefit_enrollments set status = 'cancelled', updated_at = now()
        where id = ${recordId} and tenant_id = ${ctx.tenantId}`

      await tx`
        select public.emit_event('benefits.enrollment.cancelled',
          ${JSON.stringify({ recordId })}::text::jsonb, 'benefits')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/beneficios/planes')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearPrestamoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearPrestamo(fd), 'crearPrestamo')
}
export async function registrarPagoForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarPago(fd), 'registrarPago')
}
export async function crearInscripcionForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearInscripcion(fd), 'crearInscripcion')
}
export async function cancelarInscripcionForm(fd: FormData): Promise<void> {
  await anotarAviso(await cancelarInscripcion(fd), 'cancelarInscripcion')
}
