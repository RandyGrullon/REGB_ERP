import 'server-only'

import type { TransactionSql } from 'postgres'
import { roundBankers } from '@regb/core'
import {
  calculatePayrollLine,
  descuentosDePrestamos,
  fraccionDeMes,
  parametrosDesdeFila,
  saldoPrestamo,
  salarioDelPeriodo,
  type FilaParametrosNomina,
  type PayrollTaxParams,
} from '@regb/operations'

/**
 * El calculo de UN periodo de nomina, compartido por la previsualizacion
 * (/payroll/run) y por procesarPeriodo(): lo que se ve antes de procesar
 * es exactamente lo que se guarda.
 *
 * Reglas (docs/modules/payroll.md, 0132):
 *  · Las tasas salen de `payroll_tax_params` vigente al FIN del periodo.
 *    Sin fila, no se calcula: no se inventan tasas.
 *  · Cada empleado cobra la parte del mes que vale el periodo (quincena =
 *    1/2) y, si entro o salio dentro del periodo, solo sus dias.
 *  · Entra quien estuvo contratado algun dia del periodo: activos y dados
 *    de baja dentro del periodo (su ultimo salario tambien se paga). Los
 *    que estan de licencia (`on_leave`) siguen fuera, como antes de 0132.
 *  · Reembolsos de gastos asignados a ESTE periodo (metodo nomina) suman
 *    al neto sin ser base de TSS ni ISR.
 *  · Prestamos: lo que alguien ya asigno a mano a este periodo se
 *    descuenta tal cual; a los demas prestamos activos se les descuenta la
 *    cuota por la fraccion del periodo, sin dejar el neto en negativo.
 *  · Si alguien ya cobro dias de este periodo en otra nomina, se detiene
 *    todo: la base lo rechazaria igual (payroll_lines_un_dia_se_paga_una_vez).
 */

export class ErrorNomina extends Error {}

export interface PeriodoACalcular {
  id: string
  period_start: string
  period_end: string
}

export interface PrestamoDescontado {
  loanId: string
  monto: number
  /** Saldo del prestamo despues de este descuento. */
  saldoDespues: number
}

export interface LineaCalculada {
  employeeId: string
  nombre: string
  dias: number
  completo: boolean
  bruto: number
  reembolsos: number
  sfs: number
  afp: number
  tss: number
  isr: number
  /** Pagos que este proceso CREA en benefit_loan_payments. */
  prestamosNuevos: PrestamoDescontado[]
  /** Pagos que ya estaban asignados a mano a este periodo: se descuentan, no se vuelven a crear. */
  prestamosAsignados: number
  otros: number
  neto: number
}

export interface NominaCalculada {
  params: PayrollTaxParams
  fraccionPeriodo: number
  lineas: LineaCalculada[]
}

const n = (v: string | number | null | undefined) => Number(v ?? 0)

export async function calcularNomina(
  tx: TransactionSql,
  tenantId: string,
  periodo: PeriodoACalcular,
): Promise<NominaCalculada> {
  const inicio = periodo.period_start.slice(0, 10)
  const fin = periodo.period_end.slice(0, 10)

  const [fila] = await tx<FilaParametrosNomina[]>`
    select valid_from::text, min_contribution_wage::text, sfs_cap_multiple::text,
           afp_cap_multiple::text, sfs_employee_rate::text, afp_employee_rate::text,
           income_tax_brackets, source, verified
    from public.parametros_nomina(${fin}::date)`
  if (!fila) {
    throw new ErrorNomina(
      `No hay tasas de TSS e ISR cargadas para ${fin}. Hay que agregar la fila de esa vigencia (resolucion de la TSS y escala de la DGII) antes de procesar.`,
    )
  }
  const params = parametrosDesdeFila(fila)
  const fraccionPeriodo = fraccionDeMes(inicio, fin)
  if (fraccionPeriodo <= 0) throw new ErrorNomina('El periodo no tiene ningun dia que pagar.')

  const empleados = await tx<
    {
      id: string
      nombre: string
      salary: string
      hire_date: string
      termination_date: string | null
    }[]
  >`
    select e.id, e.first_name || ' ' || e.last_name as nombre, e.salary::text,
           e.hire_date::text, e.termination_date::text
    from public.employees e
    where e.tenant_id = ${tenantId}
      and e.status in ('active', 'terminated')
      and e.hire_date <= ${fin}::date
      and (e.termination_date is null or e.termination_date >= ${inicio}::date)
      and not exists (
        select 1 from public.payroll_lines l
        where l.period_id = ${periodo.id} and l.employee_id = e.id)
    order by e.last_name, e.first_name`

  // Reembolsos que el aprobador mando a pagar en ESTE periodo. Con el
  // modulo de gastos apagado, la RLS devuelve cero filas: nada que pagar.
  const reembolsos = await tx<{ employee_id: string; nombre: string; total: string }[]>`
    select x.employee_id, e.first_name || ' ' || e.last_name as nombre, sum(x.amount)::text as total
    from public.expenses x
    join public.employees e on e.id = x.employee_id
    where x.tenant_id = ${tenantId} and x.payroll_period_id = ${periodo.id}
      and x.reimbursement_method = 'payroll' and x.status = 'reimbursed'
      and not exists (
        select 1 from public.payroll_lines l
        where l.period_id = ${periodo.id} and l.employee_id = x.employee_id)
    group by x.employee_id, e.first_name, e.last_name`

  const ids = [...new Set([...empleados.map((e) => e.id), ...reembolsos.map((r) => r.employee_id)])]
  if (ids.length === 0) return { params, fraccionPeriodo, lineas: [] }

  // El mismo dia no se paga dos veces. La restriccion de exclusion lo
  // impide igual; esto es para decir QUIEN y EN QUE nomina.
  const [cruce] = await tx<{ nombre: string; desde: string; hasta: string }[]>`
    select e.first_name || ' ' || e.last_name as nombre,
           p.period_start::text as desde, p.period_end::text as hasta
    from public.payroll_lines l
    join public.payroll_periods p on p.id = l.period_id
    join public.employees e on e.id = l.employee_id
    where l.tenant_id = ${tenantId} and l.period_id <> ${periodo.id}
      and l.employee_id = any(${ids}::uuid[])
      and l.period_range && daterange(${inicio}::date, ${fin}::date, '[]')
    order by p.period_start
    limit 1`
  if (cruce) {
    throw new ErrorNomina(
      `${cruce.nombre} ya cobro dias de este periodo en la nomina del ${cruce.desde} al ${cruce.hasta}. Un dia se paga una sola vez: corrige las fechas del periodo.`,
    )
  }

  // Pagos de prestamo que alguien ya asigno a este periodo (a mano, desde
  // /beneficios): se descuentan tal cual, sin crearlos otra vez.
  const asignados = await tx<{ employee_id: string; total: string }[]>`
    select l.employee_id, sum(p.amount)::text as total
    from public.benefit_loan_payments p
    join public.benefit_loans l on l.id = p.loan_id
    where p.tenant_id = ${tenantId} and p.payroll_period_id = ${periodo.id}
      and l.employee_id = any(${ids}::uuid[])
    group by l.employee_id`

  // Prestamos activos SIN pago en este periodo: se les descuenta la cuota.
  const prestamos = await tx<
    { id: string; employee_id: string; cuota: string; principal: string; pagado: string }[]
  >`
    select l.id, l.employee_id, l.installment_amount::text as cuota, l.principal::text,
           coalesce((select sum(p.amount) from public.benefit_loan_payments p
                      where p.loan_id = l.id), 0)::text as pagado
    from public.benefit_loans l
    where l.tenant_id = ${tenantId} and l.status = 'active'
      and l.start_date <= ${fin}::date
      and l.employee_id = any(${ids}::uuid[])
      and not exists (
        select 1 from public.benefit_loan_payments p
        where p.loan_id = l.id and p.payroll_period_id = ${periodo.id})
    order by l.start_date, l.created_at`

  const reembolsoDe = new Map(reembolsos.map((r) => [r.employee_id, n(r.total)]))
  const asignadoDe = new Map(asignados.map((a) => [a.employee_id, n(a.total)]))
  const nombreDe = new Map([
    ...reembolsos.map((r) => [r.employee_id, r.nombre] as const),
    ...empleados.map((e) => [e.id, e.nombre] as const),
  ])
  const empleadoDe = new Map(empleados.map((e) => [e.id, e]))

  const lineas: LineaCalculada[] = []
  for (const id of ids) {
    const emp = empleadoDe.get(id)
    const salario = emp
      ? salarioDelPeriodo(
          n(emp.salary),
          { desde: inicio, hasta: fin },
          {
            ingreso: emp.hire_date.slice(0, 10),
            salida: emp.termination_date?.slice(0, 10) ?? null,
          },
        )
      : null
    const bruto = salario?.bruto ?? 0
    const reemb = reembolsoDe.get(id) ?? 0
    const fijo = asignadoDe.get(id) ?? 0
    const nombre = nombreDe.get(id) ?? id

    const antes = calculatePayrollLine(bruto, params, {
      fraccionPeriodo,
      ingresosNoGravados: reemb,
    })
    if (fijo > antes.netSalary) {
      throw new ErrorNomina(
        `Los pagos de prestamo ya asignados a ${nombre} en este periodo (${fijo.toFixed(2)}) superan su neto (${antes.netSalary.toFixed(2)}).`,
      )
    }

    const suyos = prestamos
      .filter((p) => p.employee_id === id)
      .map((p) => ({
        id: p.id,
        cuota: n(p.cuota),
        saldo: saldoPrestamo(n(p.principal), [{ amount: n(p.pagado) }]),
      }))
    const descuentos = descuentosDePrestamos(suyos, fraccionPeriodo, antes.netSalary - fijo)
    const prestamosNuevos = descuentos.map((d) => ({
      loanId: d.id,
      monto: d.monto,
      saldoDespues: roundBankers(suyos.find((s) => s.id === d.id)!.saldo - d.monto, 2),
    }))
    const otros = roundBankers(fijo + descuentos.reduce((a, d) => a + d.monto, 0), 2)

    const r = calculatePayrollLine(bruto, params, {
      fraccionPeriodo,
      ingresosNoGravados: reemb,
      otrosDescuentos: otros,
    })
    lineas.push({
      employeeId: id,
      nombre,
      dias: salario?.dias ?? 0,
      completo: salario?.completo ?? false,
      bruto: r.grossSalary,
      reembolsos: r.nonTaxableIncome,
      sfs: r.sfsDeduction,
      afp: r.afpDeduction,
      tss: r.tssDeduction,
      isr: r.incomeTax,
      prestamosNuevos,
      prestamosAsignados: fijo,
      otros: r.otherDeductions,
      neto: r.netSalary,
    })
  }

  lineas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return { params, fraccionPeriodo, lineas }
}
