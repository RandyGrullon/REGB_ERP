import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TransactionSql } from 'postgres'
import { asUser, db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { vincularUsuario } from '../empleados/actions'
import { editarMiTelefono, solicitarDesdePortal } from './actions'
import { misVolantes, resolverMiEmpleado } from './mi-empleado'

/**
 * El portal llamado DE VERDAD (acciones y los mismos lectores que usa la
 * pagina), contra la base.
 *
 * Reproduce el hallazgo tal cual estaba en la demo: la cuenta de Maria
 * Rosario (maria.rosario@demo.do) y DOS expedientes con ese correo, el
 * suyo y el de Rafael Encarnacion. Hasta 0132 el portal tomaba "el
 * primero con ese correo" y Maria veia el salario y el volante de Rafael.
 *
 * En modo demostracion la sesion es siempre la misma cuenta
 * (00000000-...-0001), asi que aqui se prueba "esta cuenta ve lo suyo y
 * solo lo suyo". El caso de DOS cuentas distintas con el mismo correo
 * esta en supabase/tests/nomina-vinculo-y-periodos.test.ts.
 */

const DEMO = '00000000-0000-0000-0000-000000000001'
const CORREO = 'maria.rosario@demo.do'

let c: ClientePrueba
let maria: string
let rafael: string

const ctxDemo = <T>(fn: (tx: TransactionSql) => Promise<T>) => asUser(DEMO, c.tenantId, fn)

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-portal',
    nombre: 'Distribuidora Portal SRL',
    modulos: ['employees', 'payroll', 'hr-portal', 'time-off'],
    roles: {
      Empleado: {
        'hr-portal.view': true,
        'hr-portal.edit-profile': true,
        'hr-portal.request-time-off': true,
      },
      RRHH: { 'employees.*': true, 'hr-portal.*': true },
      Supervisor: { 'employees.view': true, 'hr-portal.view': true },
    },
  })
  const sql = db()
  // La membresia de la cuenta de demostracion es de RRHH: en modo demo la
  // MISMA cuenta pide su telefono y vincula (asUser pone el rol real de la
  // membresia en el token). Una persona de RRHH que ademas es empleada.
  const [rol] = await sql<{ id: string }[]>`
    select id from public.roles where tenant_id = ${c.tenantId} and name = 'RRHH'`
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id, accepted_at)
    values (${c.tenantId}, ${DEMO}, ${rol!.id}, now())`
  await sql`
    insert into public.user_profiles (tenant_id, user_id, display_name, email)
    values (${c.tenantId}, ${DEMO}, 'Maria Rosario', ${CORREO})`

  const expediente = async (codigo: string, nombre: string, apellido: string, salario: number) => {
    const [e] = await sql<{ id: string }[]>`
      insert into public.employees
        (tenant_id, code, first_name, last_name, hire_date, position, salary, email, phone)
      values (${c.tenantId}, ${codigo}, ${nombre}, ${apellido}, '2023-09-23', 'Gerente', ${salario},
              ${CORREO}, '809-555-0000')
      returning id`
    return e!.id
  }
  // Rafael PRIMERO: era el que el portal viejo encontraba.
  rafael = await expediente('E-001', 'Rafael', 'Encarnacion', 85_000)
  maria = await expediente('E-009', 'Maria', 'Rosario', 60_000)

  const [p] = await sql<{ id: string }[]>`
    insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
    values (${c.tenantId}, '2026-08-01', '2026-08-31', '2026-08-31') returning id`
  await sql`
    insert into public.payroll_lines
      (tenant_id, period_id, employee_id, paid_days, gross_salary, tss_deduction, income_tax, net_salary)
    values (${c.tenantId}, ${p!.id}, ${rafael}, 30, 85000, 5023.50, 8577.06, 71399.44),
           (${c.tenantId}, ${p!.id}, ${maria}, 30, 60000, 3546, 3486.65, 52967.35)`
  await sql`
    update public.payroll_periods set status = 'processed', tax_params = '{"prueba": true}'::jsonb
    where id = ${p!.id}`
})

afterAll(async () => {
  const sql = db()
  await sql.unsafe('alter table public.payroll_lines disable trigger no_editar_linea_procesada')
  await sql.unsafe('alter table public.payroll_periods disable trigger no_editar_periodo_procesado')
  try {
    await c.limpiar([
      'public.payroll_lines',
      'public.payroll_periods',
      'public.time_off_requests',
      'public.employees',
      'public.memberships',
      'public.user_profiles',
    ])
  } finally {
    await sql.unsafe('alter table public.payroll_lines enable trigger no_editar_linea_procesada')
    await sql.unsafe(
      'alter table public.payroll_periods enable trigger no_editar_periodo_procesado',
    )
    await cerrarBase()
  }
})

// ═══════════════════════════════════════════════════════════════════════
describe('Sin vinculo, el portal no adivina por correo', () => {
  it('dos expedientes con el correo de la cuenta: no se muestra NINGUNO', async () => {
    expect(await ctxDemo((tx) => resolverMiEmpleado(tx))).toBeNull()
    expect(await ctxDemo((tx) => misVolantes(tx))).toEqual([])
  })

  it('y las acciones del portal no tocan el expediente de nadie', async () => {
    const r = await editarMiTelefono(c.fd({ phone: '809-555-9999' }))
    expect(r).toEqual({
      ok: false,
      error:
        'Tu cuenta no esta vinculada a ningun expediente. Pide a RRHH que la vincule desde Empleados.',
    })
    const [e] = await db()`select phone from public.employees where id = ${rafael}`
    expect(e!.phone).toBe('809-555-0000')
    expect(
      (await solicitarDesdePortal(c.fd({ startDate: '2026-10-05', endDate: '2026-10-09' }))).ok,
    ).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('RRHH vincula; la cuenta ve lo suyo y solo lo suyo', () => {
  it('sin employees.employee.link no se vincula', async () => {
    const r = await vincularUsuario(c.fd({ employeeId: maria, userId: DEMO }, 'Supervisor'))
    expect(r.ok).toBe(false)
    expect(await ctxDemo((tx) => resolverMiEmpleado(tx))).toBeNull()
  })

  it('RRHH vincula la cuenta de Maria con el expediente de Maria', async () => {
    expect(await vincularUsuario(c.fd({ employeeId: maria, userId: DEMO }, 'RRHH'))).toEqual({
      ok: true,
    })
    const yo = await ctxDemo((tx) => resolverMiEmpleado(tx))
    expect(yo).toMatchObject({ id: maria, first_name: 'Maria' })
  })

  it('el volante que ve es el SUYO, no el de Rafael', async () => {
    const v = await ctxDemo((tx) => misVolantes(tx))
    expect(v.map((x) => x.net_salary)).toEqual(['52967.35'])
    expect(v.map((x) => x.gross_salary)).not.toContain('85000.00')
  })

  it('editar el telefono cambia el suyo y deja el de Rafael como estaba', async () => {
    expect(await editarMiTelefono(c.fd({ phone: '809-555-1234' }))).toEqual({ ok: true })
    const filas = await db()<{ id: string; phone: string }[]>`
      select id, phone from public.employees where id in (${maria}, ${rafael})`
    const tel = new Map(filas.map((f) => [f.id, f.phone]))
    expect(tel.get(maria)).toBe('809-555-1234')
    expect(tel.get(rafael)).toBe('809-555-0000')
  })

  it('la misma cuenta no puede quedar tambien en el expediente de Rafael', async () => {
    const r = await vincularUsuario(c.fd({ employeeId: rafael, userId: DEMO }, 'RRHH'))
    expect(r).toEqual({
      ok: false,
      error: 'Esa cuenta ya esta vinculada al expediente de Maria Rosario. Quitala de ahi primero.',
    })
  })

  it('quitar el vinculo deja el portal vacio otra vez', async () => {
    expect(await vincularUsuario(c.fd({ employeeId: maria, userId: '' }, 'RRHH'))).toEqual({
      ok: true,
    })
    expect(await ctxDemo((tx) => resolverMiEmpleado(tx))).toBeNull()
  })
})
