import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cuotaPrestamo } from '@regb/operations'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { crearEmpleado } from '../empleados/actions'
import { reembolsarGasto, reportarGasto, resolverGasto } from '../gastos/actions'
import { crearPrestamo, registrarPago } from '../beneficios/actions'
import { resolverSolicitud, solicitarAusencia } from '../vacaciones/actions'
import { crearPeriodo, eliminarPeriodo, procesarPeriodo } from './actions'

/**
 * RRHH de punta a punta, llamado DE VERDAD contra la base (0138).
 *
 * Lo que fija este archivo salio de recorrer la demo como RRHH, dueño y
 * empleado de Distribuidora Caribe:
 *  - se podian pedir y aprobar vacaciones sin saldo, y dos ausencias
 *    cruzadas del mismo empleado;
 *  - un gasto "reembolsado por nomina" sin nomina quedaba pagado sin que
 *    nadie lo pagara;
 *  - "Registrar cuota" bajaba el saldo de un prestamo como si lo hubiera
 *    descontado una nomina, y el interes que escribia la gente (2) se
 *    guardaba como 200 % mensual;
 *  - un periodo de nomina en borrador con las fechas equivocadas no tenia
 *    vuelta;
 *  - la cedula no se validaba;
 *  - los roles de fabrica de RRHH, Empleado y Gerente de Sucursal.
 *
 * Las fechas son RELATIVAS a hoy: el saldo de vacaciones depende de la
 * antiguedad, y una fecha fija haria que la prueba cambie de resultado
 * con el calendario.
 */

let c: ClientePrueba
let veterano: string // 3 años cumplidos: 42 dias de vacaciones
let nuevo: string // 10 dias en la empresa: 0

const DIA = 86_400_000
const iso = (d: Date) => d.toISOString().slice(0, 10)
const hoy = new Date()
/** Hoy en RD (UTC-4): la regla de "gasto del futuro" se mide en dias de RD. */
const hoyRD = new Date(Date.now() - 4 * 3_600_000)

/** El lunes de dentro de `semanas` semanas. */
function lunes(semanas: number): Date {
  const d = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()))
  const hastaLunes = (8 - d.getUTCDay()) % 7 || 7
  return new Date(d.getTime() + (hastaLunes + 7 * semanas) * DIA)
}
const mas = (d: Date, dias: number) => new Date(d.getTime() + dias * DIA)

async function empleado(codigo: string, nombre: string, ingreso: string) {
  const [e] = await db()<{ id: string }[]>`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${c.tenantId}, ${codigo}, ${nombre}, 'Prueba', ${ingreso}, 'Vendedor', 40000)
    returning id`
  return e!.id
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-rrhh',
    nombre: 'Distribuidora RRHH Accion SRL',
    modulos: ['employees', 'payroll', 'time-off', 'expenses', 'benefits', 'hr-portal'],
    roles: {
      Personal: {
        'employees.*': true,
        'payroll.*': true,
        'time-off.*': true,
        'expenses.*': true,
        'benefits.*': true,
      },
    },
  })
  // Tres años y 100 dias: el cuarto aniversario queda lejos de las fechas
  // que se piden abajo, sea cual sea el dia en que corra la prueba.
  const ingresoVeterano = new Date(hoy.getTime() - 100 * DIA)
  ingresoVeterano.setFullYear(ingresoVeterano.getFullYear() - 3)
  veterano = await empleado('E-101', 'Rafael', iso(ingresoVeterano))
  nuevo = await empleado('E-102', 'Anthony', iso(new Date(hoy.getTime() - 10 * DIA)))
})

afterAll(async () => {
  const sql = db()
  const candados = [
    ['public.payroll_lines', 'no_editar_linea_procesada'],
    ['public.payroll_periods', 'no_editar_periodo_procesado'],
    ['public.benefit_loan_payments', 'no_editar_pago_prestamo'],
    ['public.benefit_loans', 'no_editar_prestamo_resuelto'],
    ['public.expenses', 'no_editar_gasto_resuelto'],
    ['public.time_off_requests', 'no_editar_solicitud_resuelta'],
  ]
  for (const [t, g] of candados) await sql.unsafe(`alter table ${t} disable trigger ${g}`)
  try {
    await c.limpiar([
      'public.payroll_lines',
      'public.benefit_loan_payments',
      'public.benefit_loans',
      'public.expenses',
      'public.payroll_periods',
      'public.time_off_requests',
      'public.employee_contracts',
      'public.employees',
    ])
  } finally {
    for (const [t, g] of candados) await sql.unsafe(`alter table ${t} enable trigger ${g}`)
    await cerrarBase()
  }
})

// ═══════════════════════════════════════════════════════════════════════
describe('Vacaciones: el saldo manda al pedir y al aprobar', () => {
  it('quien no ha cumplido el año no puede pedir vacaciones', async () => {
    const r = await solicitarAusencia(
      c.fd({
        employeeId: nuevo,
        leaveType: 'vacation',
        startDate: iso(lunes(2)),
        endDate: iso(mas(lunes(2), 4)),
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toMatch(/^No quedan días de vacaciones disponibles y se piden 5 días/)
  })

  it('una licencia por enfermedad no descuenta del saldo: se registra igual', async () => {
    const r = await solicitarAusencia(
      c.fd({
        employeeId: nuevo,
        leaveType: 'sick',
        startDate: iso(lunes(2)),
        endDate: iso(mas(lunes(2), 1)),
      }),
    )
    expect(r).toEqual({ ok: true })
  })

  it('con saldo, se pide; y otra ausencia encima de esas fechas se rechaza', async () => {
    const inicio = lunes(3)
    expect(
      await solicitarAusencia(
        c.fd({
          employeeId: veterano,
          leaveType: 'vacation',
          startDate: iso(inicio),
          endDate: iso(mas(inicio, 11)), // dos semanas: 10 dias laborables
        }),
      ),
    ).toEqual({ ok: true })

    const r = await solicitarAusencia(
      c.fd({
        employeeId: veterano,
        leaveType: 'personal',
        startDate: iso(mas(inicio, 3)),
        endDate: iso(mas(inicio, 3)),
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/^Ya hay una ausencia pendiente del .* que se cruza/)
  })

  it('lo pendiente reserva saldo: 42 - 10 pedidos deja pedir 32, no 33', async () => {
    const inicio = lunes(6)
    const pedir = (hasta: Date) =>
      solicitarAusencia(
        c.fd({
          employeeId: veterano,
          leaveType: 'vacation',
          startDate: iso(inicio),
          endDate: iso(hasta),
        }),
      )
    // Seis semanas completas (30) y lunes a miercoles (3) = 33 laborables.
    const r = await pedir(mas(inicio, 6 * 7 + 2))
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toBe('Se piden 33 días y solo quedan 32 días de vacaciones disponibles.')
  })

  it('una solicitud que entro sin revisar (app movil) no se aprueba si no cabe', async () => {
    const inicio = lunes(12)
    const [s] = await db()<{ id: string }[]>`
      insert into public.time_off_requests
        (tenant_id, employee_id, leave_type, start_date, end_date, business_days)
      values (${c.tenantId}, ${nuevo}, 'vacation', ${iso(inicio)}, ${iso(mas(inicio, 4))}, 5)
      returning id`
    const r = await resolverSolicitud(c.fd({ recordId: s!.id, decision: 'approved' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/^No se puede aprobar\. No quedan días/)

    const [fila] = await db()<{ status: string }[]>`
      select status from public.time_off_requests where id = ${s!.id}`
    expect(fila!.status).toBe('pending')

    // Rechazarla si se puede: no gasta saldo.
    expect(await resolverSolicitud(c.fd({ recordId: s!.id, decision: 'rejected' }))).toEqual({
      ok: true,
    })
  })

  it('las del veterano que caben se aprueban', async () => {
    const [s] = await db()<{ id: string }[]>`
      select id from public.time_off_requests
      where tenant_id = ${c.tenantId} and employee_id = ${veterano} and status = 'pending'`
    expect(await resolverSolicitud(c.fd({ recordId: s!.id, decision: 'approved' }))).toEqual({
      ok: true,
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Gastos: por nomina, con nomina', () => {
  let gasto: string

  it('un gasto con fecha del futuro no se reporta', async () => {
    const r = await reportarGasto(
      c.fd({
        employeeId: veterano,
        category: 'meals',
        expenseDate: iso(mas(hoyRD, 5)),
        amount: '1200',
      }),
    )
    expect(r).toEqual({ ok: false, error: 'La fecha del gasto no puede ser del futuro.' })
  })

  it('reembolsar por nomina sin elegir la nomina se rechaza y el gasto sigue aprobado', async () => {
    expect(
      await reportarGasto(
        c.fd({ employeeId: veterano, category: 'meals', expenseDate: iso(hoyRD), amount: '1200' }),
      ),
    ).toEqual({ ok: true })
    const [g] = await db()<{ id: string }[]>`
      select id from public.expenses where tenant_id = ${c.tenantId} order by created_at desc limit 1`
    gasto = g!.id
    expect(await resolverGasto(c.fd({ recordId: gasto, decision: 'approved' }))).toEqual({
      ok: true,
    })

    const r = await reembolsarGasto(
      c.fd({ recordId: gasto, method: 'payroll', payrollPeriodId: '' }),
    )
    expect(r).toEqual({
      ok: false,
      error: 'Para reembolsar por nómina, elige la nómina en borrador que lo va a pagar.',
    })
    const [f] = await db()<
      { status: string }[]
    >`select status from public.expenses where id = ${gasto}`
    expect(f!.status).toBe('approved')
  })

  it('por transferencia no se apunta a ninguna nomina aunque el formulario mande una', async () => {
    const [p] = await db()<{ id: string }[]>`
      insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
      values (${c.tenantId}, '2030-01-01', '2030-01-15', '2030-01-15') returning id`
    expect(
      await reembolsarGasto(c.fd({ recordId: gasto, method: 'transfer', payrollPeriodId: p!.id })),
    ).toEqual({ ok: true })
    const [f] = await db()<{ status: string; payroll_period_id: string | null }[]>`
      select status, payroll_period_id from public.expenses where id = ${gasto}`
    expect(f).toEqual({ status: 'reimbursed', payroll_period_id: null })
    await db()`delete from public.payroll_periods where id = ${p!.id}`
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Prestamos: el interes en porcentaje y los pagos a mano', () => {
  let prestamo: string
  const cuota = cuotaPrestamo(12000, 6, 0.02)
  const total = Math.round(cuota * 6 * 100) / 100

  it('"2" de interes mensual es 2 %, no 200 %', async () => {
    expect(
      await crearPrestamo(
        c.fd({
          employeeId: veterano,
          loanType: 'loan',
          principal: '12000',
          installments: '6',
          monthlyRate: '2',
          startDate: iso(hoy),
        }),
      ),
    ).toEqual({ ok: true })
    const [l] = await db()<{ id: string; monthly_rate: string; installment_amount: string }[]>`
      select id, monthly_rate::text, installment_amount::text from public.benefit_loans
      where tenant_id = ${c.tenantId} order by created_at desc limit 1`
    prestamo = l!.id
    expect(l!.monthly_rate).toBe('0.0200')
    expect(Number(l!.installment_amount)).toBe(cuota) // 2,142.31, no 24,000
  })

  it('un interes absurdo se rechaza', async () => {
    const r = await crearPrestamo(
      c.fd({
        employeeId: veterano,
        loanType: 'loan',
        principal: '5000',
        installments: '2',
        monthlyRate: '25',
        startDate: iso(hoy),
      }),
    )
    expect(r).toEqual({ ok: false, error: 'El interés mensual va de 0 a 10 %.' })
  })

  it('"por nomina" a mano, sin nomina, se rechaza: eso lo registra la nomina', async () => {
    const r = await registrarPago(
      c.fd({ loanId: prestamo, amount: String(cuota), source: 'payroll' }),
    )
    expect(r).toEqual({
      ok: false,
      error: 'Un pago por nómina se registra al procesar la nómina, no a mano.',
    })
  })

  it('un pago mayor que lo que se debe se rechaza', async () => {
    const r = await registrarPago(
      c.fd({ loanId: prestamo, amount: String(total + 1), source: 'cash' }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/mayor que lo que queda por pagar/)
  })

  it('pagar el principal no salda un prestamo con interes; pagar el total si', async () => {
    expect(
      await registrarPago(c.fd({ loanId: prestamo, amount: '12000', source: 'cash' })),
    ).toEqual({
      ok: true,
    })
    const estado = async () =>
      (
        await db()<
          { status: string }[]
        >`select status from public.benefit_loans where id = ${prestamo}`
      )[0]!.status
    expect(await estado()).toBe('active')

    const resto = Math.round((total - 12000) * 100) / 100
    expect(
      await registrarPago(c.fd({ loanId: prestamo, amount: String(resto), source: 'transfer' })),
    ).toEqual({ ok: true })
    expect(await estado()).toBe('paid')
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Un borrador de nomina con las fechas equivocadas tiene vuelta', () => {
  const periodoId = async (desde: string) =>
    (
      await db()<{ id: string }[]>`
        select id from public.payroll_periods
        where tenant_id = ${c.tenantId} and period_start = ${desde}::date`
    )[0]?.id

  it('el mes entero cuando se queria la quincena: se borra y se crea bien', async () => {
    expect(
      await crearPeriodo(
        c.fd({ periodStart: '2031-03-01', periodEnd: '2031-03-31', payDate: '2031-03-31' }),
      ),
    ).toEqual({ ok: true })
    // Sin borrar, la quincena choca con el mes.
    expect(
      (
        await crearPeriodo(
          c.fd({ periodStart: '2031-03-01', periodEnd: '2031-03-15', payDate: '2031-03-15' }),
        )
      ).ok,
    ).toBe(false)

    expect(await eliminarPeriodo(c.fd({ periodId: (await periodoId('2031-03-01'))! }))).toEqual({
      ok: true,
    })
    expect(
      await crearPeriodo(
        c.fd({ periodStart: '2031-03-01', periodEnd: '2031-03-15', payDate: '2031-03-15' }),
      ),
    ).toEqual({ ok: true })
  })

  it('un borrador con un reembolso asignado no se borra', async () => {
    const p = (await periodoId('2031-03-01'))!
    const [g] = await db()<{ id: string }[]>`
      insert into public.expenses (tenant_id, employee_id, category, expense_date, amount, status)
      values (${c.tenantId}, ${veterano}, 'transport', ${iso(hoyRD)}, 800, 'approved') returning id`
    // Como lo manda la pantalla: un solo campo con el metodo y la nomina.
    expect(await reembolsarGasto(c.fd({ recordId: g!.id, destino: `payroll:${p}` }))).toEqual({
      ok: true,
    })
    const [f] = await db()<{ payroll_period_id: string }[]>`
      select payroll_period_id from public.expenses where id = ${g!.id}`
    expect(f!.payroll_period_id).toBe(p)
    const r = await eliminarPeriodo(c.fd({ periodId: p }))
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toMatch(/ya tiene reembolsos de gastos o pagos de préstamo asignados/)
  })

  it('uno procesado no se borra', async () => {
    const p = (await periodoId('2031-03-01'))!
    expect(await procesarPeriodo(c.fd({ periodId: p }))).toEqual({ ok: true })
    expect(await eliminarPeriodo(c.fd({ periodId: p }))).toEqual({
      ok: false,
      error: 'Ese periodo ya se procesó: queda fijo y se corrige con el siguiente.',
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Alta de empleado: la cedula y el salario', () => {
  const alta = (campos: Record<string, string>) =>
    crearEmpleado(
      c.fd({
        code: 'E-150',
        firstName: 'Carolina',
        lastName: 'Guzman',
        position: 'Auxiliar de almacen',
        hireDate: iso(hoy),
        salary: '28500',
        ...campos,
      }),
    )

  it('una cedula con el digito verificador mal se rechaza', async () => {
    expect(await alta({ nationalId: '001-1234567-8' })).toEqual({
      ok: false,
      error: 'La cédula no es válida: revisa los 11 dígitos.',
    })
  })

  it('un salario de cero se rechaza', async () => {
    expect(await alta({ salary: '0' })).toEqual({ ok: false, error: 'Escribe el salario mensual.' })
  })

  it('la cedula sin guiones se guarda con guiones, y el correo y el telefono tambien', async () => {
    expect(
      await alta({ nationalId: '00112345673', email: 'Carolina@Caribe.do', phone: '809-555-0101' }),
    ).toEqual({ ok: true })
    const [e] = await db()<{ national_id: string; email: string; phone: string }[]>`
      select national_id, email, phone from public.employees
      where tenant_id = ${c.tenantId} and code = 'E-150'`
    expect(e).toEqual({
      national_id: '001-1234567-3',
      email: 'carolina@caribe.do',
      phone: '809-555-0101',
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Roles de fabrica de un cliente nuevo (0138)', () => {
  const permisos = async (rol: string) =>
    (
      await db()<{ permissions: Record<string, boolean>; visible_modules: string[] }[]>`
        select permissions, visible_modules from public.roles
        where tenant_id = ${c.tenantId} and name = ${rol}`
    )[0]!

  it('RRHH abre todo lo que su menu le enseña y publica anuncios', async () => {
    const r = await permisos('RRHH')
    for (const p of [
      'time-off.*',
      'expenses.*',
      'benefits.*',
      'recruiting.*',
      'performance.*',
      'training.*',
    ]) {
      expect(r.permissions[p], p).toBe(true)
    }
    expect(r.permissions['hr-portal.manage-announcements']).toBe(true)
    expect(r.visible_modules).toContain('hr-portal')
  })

  it('el Empleado reporta sus gastos con el permiso que se pide de verdad', async () => {
    expect((await permisos('Empleado')).permissions['expenses.submit']).toBe(true)
  })

  it('el Gerente de Sucursal no ve la nomina de la empresa', async () => {
    const g = await permisos('Gerente de Sucursal')
    expect(g.permissions['payroll.view']).toBe(false)
    expect(g.permissions['payroll.export']).toBe(false)
    expect(g.permissions['*.view']).toBe(true)
  })
})
