import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * `public.reportar_gasto()` (0113) contra Postgres real.
 *
 * Mismo principio que 0112: QUIEN reporta sale del token. Un
 * `employee_id` que viaje desde el cliente convierte el reembolso de
 * gastos en un formulario para cobrarle a la empresa a nombre de otro.
 *
 * Y el RNC se limpia en la base, no en la pantalla: si cada cliente lo
 * guarda a su manera, la 606 del mes sale con el mismo proveedor
 * repetido en dos formatos.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userAna = crypto.randomUUID()
const userPedro = crypto.randomUUID()
let tenant: string
let rolConPermiso: string
let rolSinPermiso: string
let empAna: string
let empPedro: string

async function as<T>(
  userId: string,
  roleId: string | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({
    sub: userId,
    app_metadata: { tenant_id: tenant, role_id: roleId, is_provider: false },
  })
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

beforeAll(async () => {
  const [t] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`gas-${RUN}`}, 'Gastos SRL', 'pyme', 'active') returning id`
  tenant = t!.id

  for (const m of ['expenses', 'employees']) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${tenant}, ${m}, 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [rc] = await sql`
    insert into public.roles (tenant_id, name, visible_modules, permissions, scope)
    values (${tenant}, ${`Puede ${RUN}`}, '{*}', '{"expenses.submit": true}'::jsonb, '{}'::jsonb)
    returning id`
  rolConPermiso = rc!.id

  const [rs] = await sql`
    insert into public.roles (tenant_id, name, visible_modules, permissions, scope)
    values (${tenant}, ${`Mira ${RUN}`}, '{*}', '{"expenses.view": true}'::jsonb, '{}'::jsonb)
    returning id`
  rolSinPermiso = rs!.id

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
  empAna = await alta(userAna, 'Ana', `ana-g-${RUN}@prueba.do`)
  empPedro = await alta(userPedro, 'Pedro', `pedro-g-${RUN}@prueba.do`)
})

afterAll(async () => {
  await sql`delete from public.expenses where tenant_id = ${tenant}`
  await sql`delete from public.employees where tenant_id = ${tenant}`
  await sql`delete from public.user_profiles where tenant_id = ${tenant}`
  await sql`delete from public.roles where tenant_id = ${tenant}`
  await sql`delete from regb.tenant_modules where tenant_id = ${tenant}`
  await sql`delete from audit.log where tenant_id = ${tenant}`
  await sql`delete from regb.tenants where id = ${tenant}`
  await sql.end()
})

const reportar = (userId: string, roleId: string | null, args: string) =>
  as(userId, roleId, async (tx) => {
    const [r] = await tx<{ reportar_gasto: string }[]>`
      select public.reportar_gasto(${sql.unsafe(args)}) as reportar_gasto`
    return r!.reportar_gasto
  })

describe('Quien reporta sale del token', () => {
  it('el gasto de Ana queda a nombre de Ana', async () => {
    const id = await reportar(userAna, rolConPermiso, `'meals', current_date, 850`)
    const [f] = await sql<{ employee_id: string }[]>`
      select employee_id from public.expenses where id = ${id}`
    expect(f!.employee_id).toBe(empAna)
    expect(f!.employee_id).not.toBe(empPedro)
  })

  it('la funcion NO acepta un empleado por argumento', async () => {
    const [f] = await sql<{ args: string }[]>`
      select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'reportar_gasto'`
    expect(f!.args).not.toMatch(/employee/i)
  })

  it('un usuario sin expediente no puede reportar', async () => {
    await expect(
      reportar(crypto.randomUUID(), rolConPermiso, `'meals', current_date, 100`),
    ).rejects.toThrow(/expediente vinculado/)
  })

  it('y un rol sin expenses.submit tampoco', async () => {
    await expect(
      reportar(userAna, rolSinPermiso, `'meals', current_date, 100`),
    ).rejects.toThrow(/no permite reportar/)
  })
})

describe('El RNC se guarda como lo quiere la 606', () => {
  it('sin guiones, aunque se escriba con ellos', async () => {
    // Si cada cliente lo guarda a su manera, la declaracion del mes sale
    // con el mismo proveedor repetido en dos formatos.
    const id = await reportar(
      userAna,
      rolConPermiso,
      `'transport', current_date, 500, '  Taxi Seguro  ', '131-22334-5', ' e310000000001 '`,
    )
    const [f] = await sql<{ vendor_tax_id: string; vendor_name: string; ncf: string }[]>`
      select vendor_tax_id, vendor_name, ncf from public.expenses where id = ${id}`
    expect(f!.vendor_tax_id).toBe('131223345')
    // El nombre se recorta, y el NCF va en mayusculas.
    expect(f!.vendor_name).toBe('Taxi Seguro')
    expect(f!.ncf).toBe('E310000000001')
  })

  it('un RNC vacio o de puros guiones queda nulo, no en blanco', async () => {
    const id = await reportar(userAna, rolConPermiso, `'other', current_date, 75, null, '---'`)
    const [f] = await sql<{ vendor_tax_id: string | null }[]>`
      select vendor_tax_id from public.expenses where id = ${id}`
    expect(f!.vendor_tax_id).toBeNull()
  })
})

describe('Lo que no se acepta', () => {
  it('un monto de cero o negativo', async () => {
    for (const m of [0, -500]) {
      await expect(
        reportar(userAna, rolConPermiso, `'meals', current_date, ${m}`),
      ).rejects.toThrow(/mayor que cero/)
    }
  })

  it('una fecha del futuro: un gasto que no ocurrio no se reembolsa', async () => {
    await expect(
      reportar(userAna, rolConPermiso, `'meals', current_date + 1, 100`),
    ).rejects.toThrow(/futuro/)
  })

  it('una categoria inventada', async () => {
    await expect(
      reportar(userAna, rolConPermiso, `'sobornos', current_date, 100`),
    ).rejects.toThrow()
  })
})

describe('El gasto nace esperando aprobacion', () => {
  it('status submitted, que es lo que lo pone delante del supervisor', async () => {
    const id = await reportar(userAna, rolConPermiso, `'supplies', current_date, 1200`)
    const [f] = await sql<{ status: string; decided_by: string | null }[]>`
      select status, decided_by from public.expenses where id = ${id}`
    expect(f!.status).toBe('submitted')
    expect(f!.decided_by).toBeNull()
  })
})
