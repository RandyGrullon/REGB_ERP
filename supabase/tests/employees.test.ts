import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Empleados (modulo 61, F7) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un empleado con sucursal o jefe de A, ni un
 *     contrato con un empleado de A, usando su PROPIO tenant_id. Mismo
 *     patron que 0040, 0041, 0044-0048 y 0050.
 *  3. crear_contrato_empleado() desactiva el contrato anterior sin
 *     editarlo, y actualiza el salario vigente del empleado.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let sucursalA: string
let empleadoA: string
let empleadoB: string

const claims = (userId: string, tenantId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { tenant_id: tenantId, is_provider: false } })

async function as<T>(
  userId: string,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenantId)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

async function modulo(tenant: string, id: string, encendido: boolean) {
  await sql`
    update regb.tenant_modules set enabled = ${encendido}
    where tenant_id = ${tenant} and module_id = ${id}`
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`emp-a-${RUN}`}, 'Ferreteria EMP A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`emp-b-${RUN}`}, 'Distribuidora EMP B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'employees', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [c1] = await sql`
    insert into public.companies (tenant_id, legal_name, currency, is_default)
    values (${tenantA}, 'Ferreteria EMP A SRL', 'DOP', true) returning id`
  const [suc] = await sql`
    insert into public.branches (tenant_id, company_id, name, code)
    values (${tenantA}, ${c1!.id}, 'Principal', ${`PPAL-${RUN}`}) returning id`
  sucursalA = suc!.id

  const [ea] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantA}, ${`E1-${RUN}`}, 'Maria', 'Rosario', current_date - 365, 'Cajera', 25000)
    returning id`
  const [eb] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantB}, ${`E1-${RUN}`}, 'Juan', 'Perez', current_date - 100, 'Vendedor', 22000)
    returning id`
  empleadoA = ea!.id
  empleadoB = eb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.employee_contracts where tenant_id in ${sql(ts)}`
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from public.branches where tenant_id in ${sql(ts)}`
  await sql`delete from public.companies where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio empleado normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.employees`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve el empleado de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.employees where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un empleado con la sucursal de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.employees
            (tenant_id, code, first_name, last_name, hire_date, position, salary, branch_id)
          values (${tenantB}, ${`E2-${RUN}`}, 'Pedro', 'Gomez', current_date, 'Ayudante', 15000, ${sucursalA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un empleado con jefe de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.employees
            (tenant_id, code, first_name, last_name, hire_date, position, salary, manager_id)
          values (${tenantB}, ${`E3-${RUN}`}, 'Luis', 'Diaz', current_date, 'Ayudante', 15000, ${empleadoA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un contrato con un empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.employee_contracts
            (tenant_id, employee_id, contract_type, start_date, salary, position)
          values (${tenantB}, ${empleadoA}, 'indefinido', current_date, 20000, 'Cajera')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Historial de contratos', () => {
  it('un contrato nuevo desactiva el anterior y actualiza el salario vigente', async () => {
    await as(userA, tenantA, (tx) =>
      tx`select public.crear_contrato_empleado(${empleadoA}, 'indefinido', current_date, 28000, 'Supervisora de caja')`,
    )
    const [emp] = await sql<{ salary: string; position: string }[]>`
      select salary::text, position from public.employees where id = ${empleadoA}`
    expect(emp).toMatchObject({ salary: '28000.00', position: 'Supervisora de caja' })

    const contratos = await sql<{ is_active: boolean }[]>`
      select is_active from public.employee_contracts where employee_id = ${empleadoA} order by created_at`
    expect(contratos).toHaveLength(1)
    expect(contratos[0]!.is_active).toBe(true)

    await as(userA, tenantA, (tx) =>
      tx`select public.crear_contrato_empleado(${empleadoA}, 'indefinido', current_date, 30000, 'Encargada de tienda')`,
    )
    const historial = await sql<{ is_active: boolean; salary: string }[]>`
      select is_active, salary::text from public.employee_contracts
      where employee_id = ${empleadoA} order by created_at`
    expect(historial).toHaveLength(2)
    expect(historial[0]!.is_active).toBe(false)
    expect(historial[1]!.is_active).toBe(true)
  })

  it('B no puede crear un contrato para el empleado de A llamando a la funcion', async () => {
    await expect(
      as(userB, tenantB, (tx) =>
        tx`select public.crear_contrato_empleado(${empleadoA}, 'indefinido', current_date, 1, 'Intento ajeno')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'employees', true))

  it('sin el modulo, los empleados dan cero filas', async () => {
    await modulo(tenantB, 'employees', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.employees`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un empleado no puede ser su propio jefe', async () => {
    await expect(
      sql`update public.employees set manager_id = id where id = ${empleadoB}`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('dar de baja sin motivo se rechaza', async () => {
    await expect(
      sql`update public.employees set status = 'terminated' where id = ${empleadoB}`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo codigo no se repite para el mismo cliente', async () => {
    await expect(
      sql`
        insert into public.employees
          (tenant_id, code, first_name, last_name, hire_date, position, salary)
        values (${tenantB}, ${`E1-${RUN}`}, 'Otro', 'Duplicado', current_date, 'X', 1000)`,
    ).rejects.toThrow(/duplicate key/)
  })
})
