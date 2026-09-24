'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'
import { calcularNomina, ErrorNomina } from './calculo'

/**
 * Acciones de nomina (modulo 62, F7/S37-38; periodos, prorrateo, topes,
 * prestamos y reembolsos: 0132).
 *
 * procesarPeriodo() es la unica forma de generar lineas: calcula con
 * calcularNomina() -la misma que previsualiza /payroll/run- y guarda una
 * foto de los parametros usados en el propio periodo, para que un cambio
 * de ISR el ano que viene no recalcule nominas ya procesadas. Las tasas
 * NO estan en el codigo: salen de `payroll_tax_params`.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Crea un periodo de nomina en borrador. Cada periodo le paga a todos los
 * empleados, asi que uno que se cruce con otro pagaria dos veces los
 * mismos dias: se rechaza aqui con las fechas del que choca. La base lo
 * impide igual, por empleado, al procesar (0132).
 */
export async function crearPeriodo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'payroll', 'payroll.run')
  if (!permiso.ok) return permiso

  const periodStart = String(fd.get('periodStart') ?? '').trim()
  const periodEnd = String(fd.get('periodEnd') ?? '').trim()
  const payDate = String(fd.get('payDate') ?? '').trim()

  if (!periodStart || !periodEnd || !payDate)
    return { ok: false, error: 'Faltan las fechas del periodo.' }
  if (![periodStart, periodEnd, payDate].every((f) => FECHA.test(f))) {
    return { ok: false, error: 'Las fechas no son validas.' }
  }
  if (periodEnd < periodStart) {
    return { ok: false, error: 'La fecha final no puede ser antes que la inicial.' }
  }

  try {
    const choque = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [c] = await tx<{ desde: string; hasta: string }[]>`
        select period_start::text as desde, period_end::text as hasta
        from public.payroll_periods
        where tenant_id = ${ctx.tenantId}
          and daterange(period_start, period_end, '[]')
              && daterange(${periodStart}::date, ${periodEnd}::date, '[]')
        order by period_start
        limit 1`
      if (c) return c

      await tx`
        insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date, created_by)
        values (${ctx.tenantId}, ${periodStart}, ${periodEnd}, ${payDate}, ${ctx.userId})`
      return null
    })
    if (choque) {
      return {
        ok: false,
        error: `Ese periodo se cruza con el del ${choque.desde} al ${choque.hasta}: cada empleado cobraria dos veces esos dias.`,
      }
    }
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
 * Calcula y guarda la linea de cada empleado que cobra en este periodo, y
 * lo marca 'processed'. En la misma transaccion registra los pagos de
 * prestamo que descuenta (y salda el prestamo que llega a cero). Todo o
 * nada: si algo falla, no queda ni una linea.
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
      // `for update`: dos clics a la vez no procesan el mismo periodo dos veces.
      const [periodo] = await tx<
        { id: string; status: string; period_start: string; period_end: string }[]
      >`
        select id, status, period_start::text, period_end::text
        from public.payroll_periods
        where id = ${periodId} and tenant_id = ${ctx.tenantId}
        for update`
      if (!periodo) throw new ErrorNomina('Ese periodo no existe.')
      if (periodo.status !== 'draft') throw new ErrorNomina('Ese periodo ya fue procesado.')

      const calculo = await calcularNomina(tx, ctx.tenantId, periodo)
      // Un periodo procesado no se reabre: procesarlo vacio lo congela sin
      // pagarle a nadie. Pasa si nadie estaba contratado esos dias, o si el
      // rol no ve los expedientes (la RLS de employees pide employees.view).
      if (calculo.lineas.length === 0) {
        throw new ErrorNomina(
          'No hay a quien pagarle en este periodo: nadie estuvo contratado esos dias, o tu rol no ve los expedientes de empleados.',
        )
      }

      for (const l of calculo.lineas) {
        await tx`
          insert into public.payroll_lines
            (tenant_id, period_id, employee_id, paid_days, gross_salary, reimbursements,
             tss_deduction, income_tax, other_deductions, net_salary)
          values (${ctx.tenantId}, ${periodId}, ${l.employeeId}, ${l.dias}, ${l.bruto}, ${l.reembolsos},
                  ${l.tss}, ${l.isr}, ${l.otros}, ${l.neto})`

        for (const p of l.prestamosNuevos) {
          await tx`
            insert into public.benefit_loan_payments
              (tenant_id, loan_id, amount, source, payroll_period_id)
            values (${ctx.tenantId}, ${p.loanId}, ${p.monto}, 'payroll', ${periodId})`
          if (p.saldoDespues <= 0) {
            await tx`
              update public.benefit_loans set status = 'paid', updated_at = now()
              where id = ${p.loanId} and tenant_id = ${ctx.tenantId} and status = 'active'`
          }
        }
      }

      await tx`
        update public.payroll_periods
        set status = 'processed', tax_params = ${JSON.stringify(calculo.params)}::text::jsonb
        where id = ${periodId}`

      const prestamos = calculo.lineas.reduce(
        (a, l) => a + l.prestamosNuevos.reduce((b, p) => b + p.monto, 0) + l.prestamosAsignados,
        0,
      )
      const reembolsos = calculo.lineas.reduce((a, l) => a + l.reembolsos, 0)
      await tx`
        select public.emit_event('payroll.period.closed',
          ${JSON.stringify({
            periodId,
            empleados: calculo.lineas.length,
            prestamosDescontados: Math.round(prestamos * 100) / 100,
            reembolsosPagados: Math.round(reembolsos * 100) / 100,
          })}::text::jsonb, 'payroll')`
    })
  } catch (e) {
    if (e instanceof ErrorNomina) return { ok: false, error: e.message }
    const codigo = (e as { code?: string } | null)?.code
    if (codigo === '23P01') {
      return {
        ok: false,
        error:
          'Un empleado ya cobro dias de este periodo en otra nomina. Un dia se paga una sola vez: corrige las fechas.',
      }
    }
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/payroll')
  revalidatePath('/payroll/reports')
  revalidatePath('/portal')
  return { ok: true }
}

/**
 * Borra un periodo en BORRADOR (0138). Sin esto, un periodo creado con las
 * fechas equivocadas -un mes cuando se queria la quincena- no tenia
 * vuelta: no se podia editar ni borrar, y como los periodos no se cruzan,
 * bloqueaba para siempre crear el correcto. Uno procesado sigue fijo (la
 * base lo impide: impedir_editar_periodo_procesado).
 *
 * Si ya tiene reembolsos o pagos de prestamo apuntados, no se borra: esos
 * los tendria que pagar otra nomina y eso lo decide una persona.
 */
export async function eliminarPeriodo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'payroll', 'payroll.run')
  if (!permiso.ok) return permiso

  const periodId = String(fd.get('periodId') ?? '')
  if (!periodId) return { ok: false, error: 'Falta el periodo.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [p] = await tx<{ status: string }[]>`
        select status from public.payroll_periods
        where id = ${periodId} and tenant_id = ${ctx.tenantId}
        for update`
      if (!p) throw new ErrorNomina('Ese periodo no existe.')
      if (p.status !== 'draft') {
        throw new ErrorNomina(
          'Ese periodo ya se procesó: queda fijo y se corrige con el siguiente.',
        )
      }

      const [uso] = await tx<{ gastos: number; pagos: number }[]>`
        select
          (select count(*) from public.expenses
            where tenant_id = ${ctx.tenantId} and payroll_period_id = ${periodId})::int as gastos,
          (select count(*) from public.benefit_loan_payments
            where tenant_id = ${ctx.tenantId} and payroll_period_id = ${periodId})::int as pagos`
      if (uso && (uso.gastos > 0 || uso.pagos > 0)) {
        throw new ErrorNomina(
          'Este borrador ya tiene reembolsos de gastos o pagos de préstamo asignados: procésalo, o crea el periodo correcto antes de borrarlo.',
        )
      }

      await tx`
        delete from public.payroll_periods
        where id = ${periodId} and tenant_id = ${ctx.tenantId} and status = 'draft'`
    })
  } catch (e) {
    if (e instanceof ErrorNomina) return { ok: false, error: e.message }
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/payroll')
  revalidatePath('/payroll/run')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function eliminarPeriodoForm(fd: FormData): Promise<void> {
  await anotarAviso(await eliminarPeriodo(fd), 'eliminarPeriodo')
}
export async function crearPeriodoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearPeriodo(fd), 'crearPeriodo')
}
export async function procesarPeriodoForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await procesarPeriodo(fd),
    'procesarPeriodo',
    'Listo, la nómina quedó procesada: ya están los volantes.',
  )
}
