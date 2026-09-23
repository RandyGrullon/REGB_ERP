import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { parametrosDesdeFila, type FilaParametrosNomina } from '@regb/operations'

/**
 * 0132 contra Postgres real: el volante es de quien es, un dia se paga una
 * sola vez, y las tasas viven en una tabla.
 *
 *  1. PRIVACIDAD. Hasta 0132 el portal emparejaba cuenta y expediente por
 *     CORREO, sin unicidad: en la demo, Maria Rosario veia el salario y el
 *     volante de Rafael Encarnacion. Ahora el vinculo es `employees.user_id`,
 *     unico por cliente, con guarda de cliente en la propia llave, y solo lo
 *     escribe RRHH con `vincular_empleado_usuario()`.
 *  2. RLS por PostgREST: un empleado lee SUS volantes y ninguno mas, aunque
 *     vaya directo a la tabla con su token.
 *  3. DOBLE PAGO. Un empleado no puede tener dos lineas en periodos que se
 *     cruzan -restriccion de exclusion, no una comprobacion en la app-.
 *  4. Topes de TSS separados, en una tabla por vigencia.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const CORREO = `compartido-${RUN}@prueba.do`

const uAna = crypto.randomUUID()
const uLuis = crypto.randomUUID()
const uSinVinculo = crypto.randomUUID()
const uRrhh = crypto.randomUUID()
const uAjeno = crypto.randomUUID()

let tenantA: string
let tenantB: string
const rol: Record<string, string> = {}
let empAna: string
let empLuis: string
let empCarla: string
let empB: string
let periodoCerrado: string

const claims = (userId: string, tenantId: string, roleId: string | null) =>
  JSON.stringify({
    sub: userId,
    app_metadata: { tenant_id: tenantId, role_id: roleId, is_provider: false },
  })

async function as<T>(
  userId: string,
  roleId: string | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
  tenantId: string = tenantA,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenantId, roleId)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

const vincular = (empleado: string, usuario: string | null, quien = uRrhh, rolId = rol.RRHH!) =>
  as(quien, rolId, (tx) => tx`select public.vincular_empleado_usuario(${empleado}, ${usuario})`)

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`nom-a-${RUN}`}, 'Ferreteria Nomina A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`nom-b-${RUN}`}, 'Colmado Nomina B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const [t, mods] of [
    [tenantA, ['employees', 'payroll', 'hr-portal', 'time-off', 'expenses', 'benefits']],
    [tenantB, ['employees', 'payroll']],
  ] as const) {
    for (const m of mods) {
      await sql`
        insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
        values (${t}, ${m}, 'active', true)
        on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
    }
  }

  const roles: Record<string, Record<string, boolean>> = {
    Empleado: { 'payroll.view.own': true, 'hr-portal.view': true, 'hr-portal.edit-profile': true },
    RRHH: { 'employees.*': true, 'payroll.*': true },
    SoloEmpleados: { 'employees.view': true },
    MiraNomina: { 'payroll.view': true },
  }
  for (const [nombre, permisos] of Object.entries(roles)) {
    const [r] = await sql`
      insert into public.roles (tenant_id, name, visible_modules, permissions, scope)
      values (${tenantA}, ${`${nombre} ${RUN}`}, '{*}', ${JSON.stringify(permisos)}::text::jsonb, '{}'::jsonb)
      returning id`
    rol[nombre] = r!.id
  }
  const [rb] = await sql`
    insert into public.roles (tenant_id, name, visible_modules, permissions, scope)
    values (${tenantB}, ${`Owner B ${RUN}`}, '{*}', '{"*": true}'::jsonb, '{}'::jsonb) returning id`

  const miembro = async (t: string, u: string, r: string, nombre: string, correo: string) => {
    await sql`
      insert into public.memberships (tenant_id, user_id, role_id, is_active, accepted_at)
      values (${t}, ${u}, ${r}, true, now())`
    await sql`
      insert into public.user_profiles (tenant_id, user_id, display_name, email)
      values (${t}, ${u}, ${nombre}, ${correo})`
  }
  // Los TRES con el mismo correo: es el caso que rompia el portal.
  await miembro(tenantA, uAna, rol.Empleado!, 'Ana Prueba', CORREO)
  await miembro(tenantA, uLuis, rol.Empleado!, 'Luis Prueba', CORREO)
  await miembro(tenantA, uSinVinculo, rol.SoloEmpleados!, 'Sin Vinculo', CORREO)
  await miembro(tenantA, uRrhh, rol.RRHH!, 'Recursos Humanos', `rrhh-${RUN}@prueba.do`)
  await miembro(tenantB, uAjeno, rb!.id, 'Ajeno', `ajeno-${RUN}@prueba.do`)

  const empleado = async (t: string, codigo: string, nombre: string, salario: number) => {
    const [e] = await sql`
      insert into public.employees
        (tenant_id, code, first_name, last_name, hire_date, position, salary, email)
      values (${t}, ${`${codigo}-${RUN}`}, ${nombre}, 'Prueba', '2020-01-15', 'Vendedor', ${salario}, ${CORREO})
      returning id`
    return e!.id as string
  }
  empAna = await empleado(tenantA, 'ANA', 'Ana', 30_000)
  empLuis = await empleado(tenantA, 'LUIS', 'Luis', 45_000)
  empCarla = await empleado(tenantA, 'CARLA', 'Carla', 25_000)
  empB = await empleado(tenantB, 'B', 'Bernardo', 20_000)

  await vincular(empAna, uAna)
  await vincular(empLuis, uLuis)

  // Un mes ya procesado, con un volante para cada uno.
  const [p] = await sql`
    insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
    values (${tenantA}, '2026-08-01', '2026-08-31', '2026-08-31') returning id`
  periodoCerrado = p!.id
  await sql`
    insert into public.payroll_lines
      (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
    values (${tenantA}, ${periodoCerrado}, ${empAna}, 30000, 1773, 0, 28227),
           (${tenantA}, ${periodoCerrado}, ${empLuis}, 45000, 2659.50, 0, 42340.50)`
  await sql`
    update public.payroll_periods set status = 'processed', tax_params = '{"prueba": true}'::jsonb
    where id = ${periodoCerrado}`
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.payroll_lines disable trigger no_editar_linea_procesada')
  await sql.unsafe('alter table public.payroll_periods disable trigger no_editar_periodo_procesado')
  await sql`delete from public.payroll_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.payroll_periods where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.payroll_lines enable trigger no_editar_linea_procesada')
  await sql.unsafe('alter table public.payroll_periods enable trigger no_editar_periodo_procesado')
  await sql`delete from public.time_off_requests where tenant_id in ${sql(ts)}`
  await sql`delete from public.expenses where tenant_id in ${sql(ts)}`
  await sql`delete from public.benefit_loans where tenant_id in ${sql(ts)}`
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from public.memberships where tenant_id in ${sql(ts)}`
  await sql`delete from public.user_profiles where tenant_id in ${sql(ts)}`
  await sql`delete from public.event_outbox where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

// ═══════════════════════════════════════════════════════════════════════
describe('El vinculo cuenta-expediente lo asigna RRHH, explicito', () => {
  it('nadie escribe user_id directo con su token, ni con employees.view', async () => {
    await expect(
      as(
        uSinVinculo,
        rol.SoloEmpleados!,
        (tx) => tx`
        update public.employees set user_id = ${uSinVinculo} where id = ${empCarla}`,
      ),
    ).rejects.toThrow(/vincular_empleado_usuario/)
    await expect(
      as(
        uSinVinculo,
        rol.SoloEmpleados!,
        (tx) => tx`
        insert into public.employees (tenant_id, code, first_name, last_name, hire_date, position, salary, user_id)
        values (${tenantA}, ${`X-${RUN}`}, 'Colado', 'Prueba', '2024-01-01', 'Nada', 1, ${uSinVinculo})`,
      ),
    ).rejects.toThrow(/vincular_empleado_usuario/)
    const [e] = await sql`select user_id from public.employees where id = ${empCarla}`
    expect(e!.user_id).toBeNull()
  })

  it('sin employees.employee.link no se vincula', async () => {
    await expect(vincular(empCarla, uSinVinculo, uSinVinculo, rol.SoloEmpleados!)).rejects.toThrow(
      /no permite vincular/,
    )
  })

  it('una cuenta de OTRO cliente no se vincula', async () => {
    await expect(vincular(empCarla, uAjeno)).rejects.toThrow(/no es parte de tu equipo/)
  })

  it('un expediente de OTRO cliente tampoco', async () => {
    await expect(vincular(empB, uSinVinculo)).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('la llave compuesta lo impide aunque se salte la funcion', async () => {
    // Como dueño, sin RLS ni trigger de por medio: la guarda de cliente
    // vive en la propia llave (tenant_id, user_id) -> memberships.
    await expect(
      sql`update public.employees set user_id = ${uAna} where id = ${empB}`,
    ).rejects.toThrow(/foreign key|llave foranea|violates/)
  })

  it('una cuenta, un expediente', async () => {
    await expect(vincular(empCarla, uAna)).rejects.toThrow(/ya esta vinculada/)
  })

  it('RRHH vincula y desvincula, y queda en la bitacora', async () => {
    await vincular(empCarla, uSinVinculo)
    let [e] = await sql`select user_id from public.employees where id = ${empCarla}`
    expect(e!.user_id).toBe(uSinVinculo)
    await vincular(empCarla, null)
    ;[e] = await sql`select user_id from public.employees where id = ${empCarla}`
    expect(e!.user_id).toBeNull()

    const log = await sql`
      select after ->> 'user_id' as despues from audit.log
      where tenant_id = ${tenantA} and entity_id = ${empCarla} and action = 'update'
      order by at`
    expect(log.map((l) => l.despues)).toEqual([uSinVinculo, null])
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Dos usuarios con el mismo correo: ninguno ve el volante del otro', () => {
  it('mi_expediente() devuelve el vinculado, no el primero con ese correo', async () => {
    const ana = await as(
      uAna,
      null,
      (tx) => tx<{ id: string }[]>`select id from public.mi_expediente()`,
    )
    const luis = await as(
      uLuis,
      null,
      (tx) => tx<{ id: string }[]>`select id from public.mi_expediente()`,
    )
    expect(ana.map((r) => r.id)).toEqual([empAna])
    expect(luis.map((r) => r.id)).toEqual([empLuis])
  })

  it('mis_volantes() solo trae los suyos', async () => {
    const ana = await as(
      uAna,
      null,
      (tx) => tx<{ gross_salary: string }[]>`
      select gross_salary::text from public.mis_volantes()`,
    )
    const luis = await as(
      uLuis,
      null,
      (tx) => tx<{ gross_salary: string }[]>`
      select gross_salary::text from public.mis_volantes()`,
    )
    expect(ana.map((r) => r.gross_salary)).toEqual(['30000.00'])
    expect(luis.map((r) => r.gross_salary)).toEqual(['45000.00'])
  })

  it('con el mismo correo pero SIN vinculo: nada, no se adivina', async () => {
    const yo = await as(uSinVinculo, null, (tx) => tx`select id from public.mi_expediente()`)
    const volantes = await as(uSinVinculo, null, (tx) => tx`select * from public.mis_volantes()`)
    expect(yo).toHaveLength(0)
    expect(volantes).toHaveLength(0)
  })

  it('pedir vacaciones desde el telefono tampoco adivina por correo', async () => {
    await expect(
      as(
        uSinVinculo,
        null,
        (tx) => tx`
        select public.pedir_vacaciones('2026-10-05'::date, '2026-10-09'::date)`,
      ),
    ).rejects.toThrow(/expediente vinculado/)

    const [r] = await as(
      uAna,
      null,
      (tx) => tx<{ id: string }[]>`
      select public.pedir_vacaciones('2026-10-05'::date, '2026-10-09'::date) as id`,
    )
    const [f] = await sql`select employee_id from public.time_off_requests where id = ${r!.id}`
    expect(f!.employee_id).toBe(empAna)
  })

  it('y reportar un gasto tampoco', async () => {
    await expect(
      as(
        uSinVinculo,
        null,
        (tx) => tx`
        select public.reportar_gasto('meals', '2026-09-01'::date, 500)`,
      ),
    ).rejects.toThrow(/expediente vinculado/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('RLS directo a la tabla, con el token del telefono', () => {
  it('directo a la tabla, sin payroll.view, el empleado no lee NINGUNA linea -ni la de otro-', async () => {
    const filas = await as(uAna, rol.Empleado!, (tx) => tx`select id from public.payroll_lines`)
    expect(filas).toHaveLength(0)
  })

  it('por la RPC, con su token y su rol, lee la suya y solo la suya', async () => {
    const ana = await as(
      uAna,
      rol.Empleado!,
      (tx) => tx<{ gross_salary: string }[]>`
      select gross_salary::text from public.mis_volantes()`,
    )
    expect(ana.map((r) => r.gross_salary)).toEqual(['30000.00'])
  })

  it('sin vinculo y sin permiso de nomina: cero lineas', async () => {
    const filas = await as(
      uSinVinculo,
      rol.SoloEmpleados!,
      (tx) => tx`select id from public.payroll_lines`,
    )
    expect(filas).toHaveLength(0)
  })

  it('con payroll.view se leen todas las del cliente', async () => {
    const filas = await as(uRrhh, rol.MiraNomina!, (tx) => tx`select id from public.payroll_lines`)
    expect(filas).toHaveLength(2)
  })

  it('ver no es escribir: ni el empleado ni payroll.view insertan lineas ni periodos', async () => {
    const [borrador] = await sql`
      insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
      values (${tenantA}, '2026-12-01', '2026-12-31', '2026-12-31') returning id`
    for (const [u, r] of [
      [uAna, rol.Empleado!],
      [uRrhh, rol.MiraNomina!],
    ] as const) {
      await expect(
        as(
          u,
          r,
          (tx) => tx`
          insert into public.payroll_lines
            (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
          values (${tenantA}, ${borrador!.id}, ${empAna}, 999999, 0, 0, 999999)`,
        ),
      ).rejects.toThrow(/row-level security/)
      await expect(
        as(
          u,
          r,
          (tx) => tx`
          insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
          values (${tenantA}, '2027-01-01', '2027-01-31', '2027-01-31')`,
        ),
      ).rejects.toThrow(/row-level security/)
    }
    await sql`delete from public.payroll_periods where id = ${borrador!.id}`
  })

  it('con payroll.view tampoco se edita ni se borra: sale el error, no "0 filas"', async () => {
    const [borrador] = await sql`
      insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
      values (${tenantA}, '2026-12-01', '2026-12-31', '2026-12-31') returning id`
    await sql`
      insert into public.payroll_lines
        (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
      values (${tenantA}, ${borrador!.id}, ${empLuis}, 45000, 2659.50, 0, 42340.50)`
    await expect(
      as(
        uRrhh,
        rol.MiraNomina!,
        (tx) => tx`
        update public.payroll_lines set gross_salary = 1, net_salary = 1 - 2659.50 + 2659.50
        where period_id = ${borrador!.id}`,
      ),
    ).rejects.toThrow(/row-level security/)
    await expect(
      as(
        uRrhh,
        rol.MiraNomina!,
        (tx) => tx`
        delete from public.payroll_lines where period_id = ${borrador!.id}`,
      ),
    ).rejects.toThrow(/payroll\.run/)
    await expect(
      as(
        uRrhh,
        rol.MiraNomina!,
        (tx) => tx`delete from public.payroll_periods where id = ${borrador!.id}`,
      ),
    ).rejects.toThrow(/payroll\.run/)
    // RRHH (payroll.*) si puede quitar el borrador.
    await as(
      uRrhh,
      rol.RRHH!,
      (tx) => tx`delete from public.payroll_lines where period_id = ${borrador!.id}`,
    )
    await as(
      uRrhh,
      rol.RRHH!,
      (tx) => tx`delete from public.payroll_periods where id = ${borrador!.id}`,
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('El telefono del portal: el suyo, por el token', () => {
  it('Ana cambia SU telefono; el de Luis, con el mismo correo, no se toca', async () => {
    await sql`update public.employees set phone = '809-555-0000' where id in (${empAna}, ${empLuis})`
    await as(uAna, rol.Empleado!, (tx) => tx`select public.editar_mi_telefono('809-555-1111')`)
    const filas = await sql<{ id: string; phone: string }[]>`
      select id, phone from public.employees where id in (${empAna}, ${empLuis})`
    const tel = new Map(filas.map((f) => [f.id, f.phone]))
    expect(tel.get(empAna)).toBe('809-555-1111')
    expect(tel.get(empLuis)).toBe('809-555-0000')
  })

  it('sin vinculo no edita nada, y sin hr-portal.edit-profile tampoco', async () => {
    await expect(
      as(uSinVinculo, null, (tx) => tx`select public.editar_mi_telefono('809-555-2222')`),
    ).rejects.toThrow(/no esta vinculada/)
    await expect(
      as(uLuis, rol.MiraNomina!, (tx) => tx`select public.editar_mi_telefono('809-555-2222')`),
    ).rejects.toThrow(/no permite editar/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Un dia se paga una sola vez por empleado', () => {
  let q1: string
  let q2: string
  let mes: string

  beforeAll(async () => {
    const periodo = async (desde: string, hasta: string) => {
      const [p] = await sql`
        insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
        values (${tenantA}, ${desde}, ${hasta}, ${hasta}) returning id`
      return p!.id as string
    }
    q1 = await periodo('2026-09-01', '2026-09-15')
    q2 = await periodo('2026-09-16', '2026-09-30')
    mes = await periodo('2026-09-01', '2026-09-30')
  })

  const linea = (periodo: string, empleado: string) => sql`
    insert into public.payroll_lines
      (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
    values (${tenantA}, ${periodo}, ${empleado}, 15000, 886.50, 0, 14113.50)`

  it('dos quincenas contiguas: bien', async () => {
    await linea(q1, empAna)
    await linea(q2, empAna)
  })

  it('el mes entero encima de esas quincenas: rechazado', async () => {
    await expect(linea(mes, empAna)).rejects.toThrow(/payroll_lines_un_dia_se_paga_una_vez/)
  })

  it('es POR EMPLEADO: otro empleado si cobra en el periodo mensual', async () => {
    await linea(mes, empLuis)
  })

  it('mover las fechas de un borrador para que se cruce: rechazado', async () => {
    await expect(
      sql`update public.payroll_periods set period_end = '2026-09-20' where id = ${q1}`,
    ).rejects.toThrow(/payroll_lines_un_dia_se_paga_una_vez/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Topes de TSS e ISR: una tabla por vigencia, no el codigo', () => {
  const vigente = async (fecha: string) => {
    const filas = await as(
      uAna,
      null,
      (tx) => tx<FilaParametrosNomina[]>`
      select * from public.parametros_nomina(${fecha}::date)`,
    )
    return filas[0]
  }

  it('septiembre 2026 usa la fila del 1-feb-2026: SFS y AFP con topes distintos', async () => {
    const f = await vigente('2026-09-15')
    expect(f).toBeDefined()
    expect(Number(f!.min_contribution_wage)).toBe(23_223)
    const p = parametrosDesdeFila(f!)
    expect(p.sfsCap).toBe(232_230)
    expect(p.afpCap).toBe(464_460)
    expect(f!.verified).toBe(true)
  })

  it('una nomina de 2025 usa la fila de 2025, y una de 2024 la suya', async () => {
    expect(Number((await vigente('2025-06-01'))!.min_contribution_wage)).toBe(21_674.8)
    expect(Number((await vigente('2024-03-01'))!.min_contribution_wage)).toBe(19_352.5)
  })

  it('antes de la primera vigencia cargada no hay parametros: no se inventan', async () => {
    expect(await vigente('2023-12-31')).toBeUndefined()
  })

  it('cualquiera las lee, nadie con token las cambia', async () => {
    await expect(
      as(
        uRrhh,
        rol.RRHH!,
        (tx) => tx`
        insert into public.payroll_tax_params
          (valid_from, min_contribution_wage, sfs_cap_multiple, afp_cap_multiple,
           sfs_employee_rate, afp_employee_rate, income_tax_brackets, source)
        values ('2030-01-01', 1, 10, 20, 0, 0, '[]'::jsonb, 'colado')`,
      ),
    ).rejects.toThrow(/row-level security|permission denied/)
    await expect(
      as(uRrhh, rol.RRHH!, (tx) => tx`update public.payroll_tax_params set sfs_employee_rate = 0`),
    ).rejects.toThrow(/row-level security|permission denied/)
    const [f] =
      await sql`select count(*)::int as n from public.payroll_tax_params where sfs_employee_rate = 0`
    expect(f!.n).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Nada se le cuelga a una nomina ya procesada', () => {
  it('un reembolso por nomina no apunta a un periodo cerrado: nunca se pagaria', async () => {
    const [g] = await sql`
      insert into public.expenses (tenant_id, employee_id, category, expense_date, amount, status)
      values (${tenantA}, ${empAna}, 'meals', '2026-08-10', 800, 'approved') returning id`
    await expect(
      sql`
        update public.expenses
        set status = 'reimbursed', reimbursement_method = 'payroll',
            payroll_period_id = ${periodoCerrado}, reimbursed_at = now()
        where id = ${g!.id}`,
    ).rejects.toThrow(/ya se proceso/)
  })

  it('un pago de prestamo tampoco', async () => {
    const [l] = await sql`
      insert into public.benefit_loans
        (tenant_id, employee_id, loan_type, principal, installments, installment_amount, start_date)
      values (${tenantA}, ${empAna}, 'loan', 10000, 10, 1000, '2026-08-01') returning id`
    await expect(
      sql`
        insert into public.benefit_loan_payments (tenant_id, loan_id, amount, source, payroll_period_id)
        values (${tenantA}, ${l!.id}, 1000, 'payroll', ${periodoCerrado})`,
    ).rejects.toThrow(/ya se proceso/)
  })
})
