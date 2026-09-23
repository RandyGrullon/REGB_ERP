import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { crearPeriodo, procesarPeriodo } from './actions'

/**
 * crearPeriodo() y procesarPeriodo() llamadas DE VERDAD, contra la base.
 *
 * Lo que fija este archivo es el hallazgo 10 del analisis de flujo:
 *  - dos quincenas pagaban el salario mensual completo CADA UNA
 *    (E-001: 142,798.88 netos en vez de 71,399.44);
 *  - un periodo que se cruza con otro pagaba dos veces los mismos dias;
 *  - quien entraba a mitad de periodo cobraba el mes entero;
 *  - los prestamos "por nomina" y los reembolsos "por nomina" nunca
 *    llegaban al volante.
 */

let c: ClientePrueba
let rafael: string
let anthony: string
let yolanda: string
let carmen: string
let prestamo: string

type Linea = {
  employee_id: string
  paid_days: string
  gross_salary: string
  reimbursements: string
  tss_deduction: string
  income_tax: string
  other_deductions: string
  net_salary: string
}

async function periodo(desde: string, hasta: string): Promise<string> {
  const [p] = await db()<{ id: string }[]>`
    select id from public.payroll_periods
    where tenant_id = ${c.tenantId} and period_start = ${desde}::date and period_end = ${hasta}::date`
  return p!.id
}

async function lineas(periodId: string): Promise<Map<string, Linea>> {
  const filas = await db()<Linea[]>`
    select employee_id, paid_days::text, gross_salary::text, reimbursements::text,
           tss_deduction::text, income_tax::text, other_deductions::text, net_salary::text
    from public.payroll_lines where period_id = ${periodId}`
  return new Map(filas.map((f) => [f.employee_id, f]))
}

async function empleado(
  codigo: string,
  nombre: string,
  salario: number,
  ingreso: string,
  baja?: string,
) {
  const [e] = await db()<{ id: string }[]>`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary,
       status, termination_date, termination_reason)
    values (${c.tenantId}, ${codigo}, ${nombre}, 'Prueba', ${ingreso}, 'Vendedor', ${salario},
            ${baja ? 'terminated' : 'active'}, ${baja ?? null}, ${baja ? 'Renuncia voluntaria' : null})
    returning id`
  return e!.id
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-nom',
    nombre: 'Distribuidora Nomina Accion SRL',
    modulos: ['employees', 'payroll', 'benefits', 'expenses'],
    roles: {
      RRHH: { 'employees.*': true, 'payroll.*': true, 'benefits.*': true, 'expenses.*': true },
      Cajero: { 'pos.sell': true, 'payroll.view': true },
    },
  })
  rafael = await empleado('E-001', 'Rafael', 85_000, '2023-09-23')
  anthony = await empleado('E-003', 'Anthony', 18_000, '2026-09-16')
  yolanda = await empleado('E-002', 'Yolanda', 32_000, '2024-09-23', '2026-09-10')
  carmen = await empleado('E-004', 'Carmen', 24_000, '2026-10-16')

  // Un prestamo de 10,000 en dos cuotas MENSUALES de 5,000.
  const [l] = await db()<{ id: string }[]>`
    insert into public.benefit_loans
      (tenant_id, employee_id, loan_type, principal, installments, installment_amount, start_date)
    values (${c.tenantId}, ${rafael}, 'loan', 10000, 2, 5000, '2026-09-01') returning id`
  prestamo = l!.id
})

afterAll(async () => {
  const sql = db()
  // Lineas procesadas, pagos de prestamo y gastos reembolsados son
  // inmutables a proposito: se apartan sus candados solo para limpiar.
  const candados = [
    ['public.payroll_lines', 'no_editar_linea_procesada'],
    ['public.payroll_periods', 'no_editar_periodo_procesado'],
    ['public.benefit_loan_payments', 'no_editar_pago_prestamo'],
    ['public.benefit_loans', 'no_editar_prestamo_resuelto'],
    ['public.expenses', 'no_editar_gasto_resuelto'],
  ]
  for (const [t, g] of candados) await sql.unsafe(`alter table ${t} disable trigger ${g}`)
  try {
    await c.limpiar([
      'public.payroll_lines',
      'public.benefit_loan_payments',
      'public.benefit_loans',
      'public.expenses',
      'public.payroll_periods',
      'public.employees',
    ])
  } finally {
    for (const [t, g] of candados) await sql.unsafe(`alter table ${t} enable trigger ${g}`)
    await cerrarBase()
  }
})

// ═══════════════════════════════════════════════════════════════════════
describe('Crear periodos: quincenas si, periodos que se cruzan no', () => {
  it('las dos quincenas de septiembre', async () => {
    expect(
      await crearPeriodo(
        c.fd({ periodStart: '2026-09-01', periodEnd: '2026-09-15', payDate: '2026-09-15' }),
      ),
    ).toEqual({ ok: true })
    expect(
      await crearPeriodo(
        c.fd({ periodStart: '2026-09-16', periodEnd: '2026-09-30', payDate: '2026-09-30' }),
      ),
    ).toEqual({ ok: true })
  })

  it('el mes entero encima de las quincenas: rechazado, y dice con cual choca', async () => {
    const r = await crearPeriodo(
      c.fd({ periodStart: '2026-09-01', periodEnd: '2026-09-30', payDate: '2026-09-30' }),
    )
    expect(r).toEqual({
      ok: false,
      error:
        'Ese periodo se cruza con el del 2026-09-01 al 2026-09-15: cada empleado cobraria dos veces esos dias.',
    })
    const [n] = await db()<{ n: number }[]>`
      select count(*)::int as n from public.payroll_periods where tenant_id = ${c.tenantId}`
    expect(n!.n).toBe(2)
  })

  it('sin payroll.run no se crea ni se procesa', async () => {
    const r = await crearPeriodo(
      c.fd({ periodStart: '2026-11-01', periodEnd: '2026-11-30', payDate: '2026-11-30' }, 'Cajero'),
    )
    expect(r.ok).toBe(false)
    const q1 = await periodo('2026-09-01', '2026-09-15')
    expect((await procesarPeriodo(c.fd({ periodId: q1 }, 'Cajero'))).ok).toBe(false)
    expect((await lineas(q1)).size).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Procesar: cada quincena paga medio mes, no el mes entero', () => {
  it('primera quincena: Rafael cobra 42,500 de bruto, y la cuota del prestamo va a medias', async () => {
    const q1 = await periodo('2026-09-01', '2026-09-15')
    expect(await procesarPeriodo(c.fd({ periodId: q1 }))).toEqual({ ok: true })

    const l = (await lineas(q1)).get(rafael)!
    expect(l.paid_days).toBe('15.00')
    expect(l.gross_salary).toBe('42500.00')
    expect(l.tss_deduction).toBe('2511.75')
    expect(l.income_tax).toBe('4288.53')
    // 35,699.72 menos media cuota mensual (2,500).
    expect(l.other_deductions).toBe('2500.00')
    expect(l.net_salary).toBe('33199.72')

    const pagos = await db()<{ amount: string; source: string }[]>`
      select amount::text, source from public.benefit_loan_payments
      where loan_id = ${prestamo} and payroll_period_id = ${q1}`
    expect(pagos).toEqual([{ amount: '2500.00', source: 'payroll' }])
  })

  it('quien salio el dia 10 cobra 10 dias, y quien todavia no entraba no cobra', async () => {
    const q1 = await periodo('2026-09-01', '2026-09-15')
    const ls = await lineas(q1)
    expect(ls.get(yolanda)).toMatchObject({ paid_days: '10.00', gross_salary: '10666.67' })
    expect(ls.has(anthony)).toBe(false)
    expect(ls.has(carmen)).toBe(false)
  })

  it('la foto de las tasas: SFS y AFP con topes distintos, y de donde salieron', async () => {
    const q1 = await periodo('2026-09-01', '2026-09-15')
    const [p] = await db()<{ tax_params: Record<string, unknown> }[]>`
      select tax_params from public.payroll_periods where id = ${q1}`
    expect(p!.tax_params).toMatchObject({
      sfsCap: 232_230,
      afpCap: 464_460,
      vigencia: { desde: '2026-02-01', verificado: true },
    })
  })

  it('segunda quincena: el reembolso por nomina llega al volante y no paga TSS', async () => {
    const q2 = await periodo('2026-09-16', '2026-09-30')
    const [g] = await db()<{ id: string }[]>`
      insert into public.expenses (tenant_id, employee_id, category, expense_date, amount, status)
      values (${c.tenantId}, ${anthony}, 'transport', '2026-09-20', 1250, 'approved') returning id`
    await db()`
      update public.expenses
      set status = 'reimbursed', reimbursement_method = 'payroll', payroll_period_id = ${q2},
          reimbursed_at = now()
      where id = ${g!.id}`

    expect(await procesarPeriodo(c.fd({ periodId: q2 }))).toEqual({ ok: true })
    const ls = await lineas(q2)
    // Entro el 16: la segunda quincena es suya entera.
    expect(ls.get(anthony)).toMatchObject({
      paid_days: '15.00',
      gross_salary: '9000.00',
      reimbursements: '1250.00',
      tss_deduction: '531.90',
      income_tax: '0.00',
      net_salary: '9718.10',
    })
    // Yolanda salio el 10: en la segunda quincena no cobra.
    expect(ls.has(yolanda)).toBe(false)
  })

  it('las dos quincenas de Rafael suman UN mes: 85,000 de bruto y 71,399.44 antes del prestamo', async () => {
    const q1 = (await lineas(await periodo('2026-09-01', '2026-09-15'))).get(rafael)!
    const q2 = (await lineas(await periodo('2026-09-16', '2026-09-30'))).get(rafael)!
    expect(Number(q1.gross_salary) + Number(q2.gross_salary)).toBe(85_000)
    const netoSinPrestamo = (l: Linea) => Number(l.net_salary) + Number(l.other_deductions)
    expect(netoSinPrestamo(q1) + netoSinPrestamo(q2)).toBeCloseTo(71_399.44, 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Prorrateo y cierre del prestamo en un periodo mensual', () => {
  it('ingreso el dia 16 de un mes: cobra medio mes, no el mes entero', async () => {
    expect(
      await crearPeriodo(
        c.fd({ periodStart: '2026-10-01', periodEnd: '2026-10-31', payDate: '2026-10-31' }),
      ),
    ).toEqual({ ok: true })
    const oct = await periodo('2026-10-01', '2026-10-31')
    expect(await procesarPeriodo(c.fd({ periodId: oct }))).toEqual({ ok: true })

    const ls = await lineas(oct)
    expect(ls.get(carmen)).toMatchObject({ paid_days: '15.00', gross_salary: '12000.00' })
    expect(ls.get(rafael)).toMatchObject({ paid_days: '30.00', gross_salary: '85000.00' })
  })

  it('la ultima cuota salda el prestamo: nunca se descuenta mas que el saldo', async () => {
    const oct = await periodo('2026-10-01', '2026-10-31')
    expect((await lineas(oct)).get(rafael)!.other_deductions).toBe('5000.00')
    const [l] = await db()<{ status: string; pagado: string }[]>`
      select l.status, (select sum(amount) from public.benefit_loan_payments p where p.loan_id = l.id)::text as pagado
      from public.benefit_loans l where l.id = ${prestamo}`
    expect(l).toEqual({ status: 'paid', pagado: '10000.00' })
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Un periodo que se cruza con uno ya pagado no se procesa', () => {
  it('aunque se cuele por fuera de la accion, procesar lo rechaza y no deja ni una linea', async () => {
    const [p] = await db()<{ id: string }[]>`
      insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
      values (${c.tenantId}, '2026-09-10', '2026-09-25', '2026-09-25') returning id`
    const r = await procesarPeriodo(c.fd({ periodId: p!.id }))
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toMatch(
        /ya cobro dias de este periodo en la nomina del 2026-09-01 al 2026-09-15/,
      )
    expect((await lineas(p!.id)).size).toBe(0)
    const [s] = await db()<
      { status: string }[]
    >`select status from public.payroll_periods where id = ${p!.id}`
    expect(s!.status).toBe('draft')
  })
})
