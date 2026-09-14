import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { diasLaborablesEntre } from '@regb/operations'

/**
 * `public.pedir_vacaciones()` (0112) contra Postgres real.
 *
 * Lo que se vigila aqui son las dos cosas que NO pueden venir del
 * cliente:
 *
 *   · QUIEN pide. Con el `employee_id` por parametro, cualquiera con la
 *     app pide vacaciones a nombre de otro, o se las pide a un compañero
 *     para dejarlo sin saldo.
 *   · CUANTOS DIAS son. `business_days` es lo que descuenta del saldo
 *     legal: si lo pone el cliente, se piden tres semanas declarando un
 *     dia.
 *
 * Y que el conteo de dias coincida con el de TypeScript. Si divergen, la
 * misma solicitud vale distinto segun por donde se pida.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userAna = crypto.randomUUID()
const userPedro = crypto.randomUUID()
let tenant: string
let empAna: string
let empPedro: string

const claims = (userId: string, tenantId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { tenant_id: tenantId, is_provider: false } })

async function as<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenant)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

beforeAll(async () => {
  const [t] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`vac-${RUN}`}, 'Vacaciones SRL', 'pyme', 'active') returning id`
  tenant = t!.id

  for (const m of ['time-off', 'employees']) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${tenant}, ${m}, 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const alta = async (userId: string, nombre: string, correo: string) => {
    await sql`
      insert into public.user_profiles (tenant_id, user_id, email, display_name)
      values (${tenant}, ${userId}, ${correo}, ${nombre})`
    const [e] = await sql`
      insert into public.employees
        (tenant_id, code, first_name, last_name, position, salary, email, hire_date, status)
      values (${tenant}, ${`E-${nombre}-${RUN}`}, ${nombre}, 'Prueba', 'Vendedor', 30000,
              ${correo}, '2020-01-15', 'active')
      returning id`
    return e!.id as string
  }
  empAna = await alta(userAna, 'Ana', `ana-${RUN}@prueba.do`)
  empPedro = await alta(userPedro, 'Pedro', `pedro-${RUN}@prueba.do`)
})

afterAll(async () => {
  await sql`delete from public.time_off_requests where tenant_id = ${tenant}`
  await sql`delete from public.employees where tenant_id = ${tenant}`
  await sql`delete from public.user_profiles where tenant_id = ${tenant}`
  await sql`delete from regb.tenant_modules where tenant_id = ${tenant}`
  await sql`delete from audit.log where tenant_id = ${tenant}`
  await sql`delete from regb.tenants where id = ${tenant}`
  await sql.end()
})

describe('Quien pide sale del token, no de un parametro', () => {
  it('la solicitud de Ana queda a nombre de Ana', async () => {
    const id = await as(userAna, async (tx) => {
      const [r] = await tx<{ pedir_vacaciones: string }[]>`
        select public.pedir_vacaciones('2026-10-05'::date, '2026-10-09'::date) as pedir_vacaciones`
      return r!.pedir_vacaciones
    })

    const [fila] = await sql<{ employee_id: string; business_days: number }[]>`
      select employee_id, business_days from public.time_off_requests where id = ${id}`
    expect(fila!.employee_id).toBe(empAna)
    expect(fila!.employee_id).not.toBe(empPedro)
  })

  it('la funcion NO acepta un empleado por argumento', async () => {
    // Si algun dia alguien le agrega ese parametro "para que RRHH pueda
    // pedir por otro", esta prueba se cae y obliga a pensarlo.
    const [f] = await sql<{ args: string }[]>`
      select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'pedir_vacaciones'`
    expect(f!.args).not.toMatch(/employee/i)
    expect(f!.args).toBe('p_inicio date, p_fin date, p_tipo text, p_motivo text')
  })

  it('un usuario sin expediente no puede pedir', async () => {
    await expect(
      as(crypto.randomUUID(), (tx) => tx`
        select public.pedir_vacaciones('2026-10-05'::date, '2026-10-09'::date)`),
    ).rejects.toThrow(/expediente vinculado/)
  })
})

describe('Los dias los cuenta la base, no el telefono', () => {
  it('una semana de lunes a viernes son 5', async () => {
    const id = await as(userPedro, async (tx) => {
      const [r] = await tx<{ pedir_vacaciones: string }[]>`
        select public.pedir_vacaciones('2026-10-12'::date, '2026-10-16'::date) as pedir_vacaciones`
      return r!.pedir_vacaciones
    })
    const [f] = await sql<{ business_days: number }[]>`
      select business_days from public.time_off_requests where id = ${id}`
    expect(f!.business_days).toBe(5)
  })

  it('y coincide con diasLaborablesEntre() de TypeScript', async () => {
    // Es la trampa de replicar logica: si divergen, la misma solicitud
    // vale distinto segun por donde se pida.
    //
    // OJO con como se construye la fecha. `diasLaborablesEntre` lee
    // `getFullYear/getMonth/getDate`, que son LOCALES. Pasarle
    // `new Date('2026-09-14T00:00:00Z')` en Republica Dominicana -UTC-4-
    // le entrega el 13 de septiembre, y el conteo sale distinto.
    //
    // La app construye `new Date(\`${'$'}{fecha}T00:00:00\`)`, sin Z: medianoche
    // local. Aqui se hace igual, porque lo que se compara es lo que de
    // verdad corre. El primer intento uso Z y dio 4 contra 5 — una
    // discrepancia de la PRUEBA, no de las dos implementaciones.
    const casos: [string, string][] = [
      ['2026-09-14', '2026-09-18'],
      ['2026-09-01', '2026-09-30'],
      ['2026-12-24', '2027-01-05'],
      ['2024-02-01', '2024-02-29'],
      ['2026-09-14', '2026-09-14'],
    ]
    for (const [a, b] of casos) {
      const [r] = await sql<{ n: number }[]>`
        select public.dias_laborables(${a}::date, ${b}::date) as n`
      const ts = diasLaborablesEntre(new Date(`${a}T00:00:00`), new Date(`${b}T00:00:00`))
      expect(r!.n, `${a} → ${b}`).toBe(ts)
    }
  })

  it('un fin de semana entero no tiene dias laborables y se rechaza', async () => {
    // Sabado y domingo. La tabla exige `business_days > 0`, asi que sin
    // esta comprobacion el error que veria el usuario seria el de una
    // restriccion de base de datos.
    await expect(
      as(userAna, (tx) => tx`
        select public.pedir_vacaciones('2026-09-12'::date, '2026-09-13'::date)`),
    ).rejects.toThrow(/ningun dia laborable/)
  })

  it('las fechas al reves se rechazan con su motivo', async () => {
    await expect(
      as(userAna, (tx) => tx`
        select public.pedir_vacaciones('2026-10-09'::date, '2026-10-05'::date)`),
    ).rejects.toThrow(/antes que la de inicio/)
  })
})

describe('Lo que la solicitud guarda', () => {
  it('nace pendiente, que es lo que la pone delante del supervisor', async () => {
    const id = await as(userAna, async (tx) => {
      const [r] = await tx<{ pedir_vacaciones: string }[]>`
        select public.pedir_vacaciones('2026-11-02'::date, '2026-11-04'::date, 'personal', '  ') as pedir_vacaciones`
      return r!.pedir_vacaciones
    })
    const [f] = await sql<{ status: string; leave_type: string; reason: string | null }[]>`
      select status, leave_type, reason from public.time_off_requests where id = ${id}`
    expect(f!.status).toBe('pending')
    expect(f!.leave_type).toBe('personal')
    // Un motivo de solo espacios se guarda como nulo, no como "  ".
    expect(f!.reason).toBeNull()
  })
})
