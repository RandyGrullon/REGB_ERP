import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Requisiciones (modulo 43, F8) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una requisicion con el empleado de A usando su
 *     PROPIO tenant_id. Mismo patron que 0031-0064. `approved_by` NO se
 *     valida asi -es el usuario autenticado (user_profiles), no una fila
 *     de employees; no tiene FK ni trigger de aislamiento propio, igual
 *     que decided_by en time-off (0054) y expenses (0055)-.
 *  3. Una requisicion resuelta (rejected/converted) es inmutable;
 *     'approved' NO es terminal -todavia puede pasar a 'converted'-.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let empleadoA: string
let empleadoB: string
let aprobadorB: string

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
    values (${`rq-a-${RUN}`}, 'Ferreteria RQ A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`rq-b-${RUN}`}, 'Distribuidora RQ B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'employees', 'active', true), (${t}, 'requisitions', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ea] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantA}, ${`E1-${RUN}`}, 'Maria', 'Rosario', current_date - 400, 'Cajera', 25000)
    returning id`
  const [eb] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantB}, ${`E1-${RUN}`}, 'Juan', 'Perez', current_date - 400, 'Vendedor', 22000)
    returning id`
  const [ab] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantB}, ${`E2-${RUN}`}, 'Ana', 'Gomez', current_date - 800, 'Gerente', 60000)
    returning id`
  empleadoA = ea!.id
  empleadoB = eb!.id
  aprobadorB = ab!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.purchase_requisitions disable trigger no_editar_requisicion_resuelta')
  await sql`delete from public.purchase_requisitions where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.purchase_requisitions enable trigger no_editar_requisicion_resuelta')
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A registra su propia requisicion normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.purchase_requisitions (tenant_id, employee_id, description, estimated_amount)
        values (${tenantA}, ${empleadoA}, 'Papeleria de oficina', 5000)`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.purchase_requisitions`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la requisicion de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.purchase_requisitions where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una requisicion con el empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.purchase_requisitions (tenant_id, employee_id, description, estimated_amount)
          values (${tenantB}, ${empleadoA}, 'x', 1000)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('approved_by acepta cualquier uuid -es el usuario autenticado, no se valida como empleado-', async () => {
    const idUsuarioCualquiera = crypto.randomUUID()
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.purchase_requisitions
          (tenant_id, employee_id, description, estimated_amount, approved_by)
        values (${tenantB}, ${empleadoB}, 'x', 1000, ${idUsuarioCualquiera}) returning id`,
    )
    expect(r!.id).toBeDefined()
  })
})

describe('El ciclo completo: aprobada NO es terminal, convertida SI', () => {
  let requisicion: string

  it('se aprueba normalmente', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.purchase_requisitions
          (tenant_id, employee_id, description, estimated_amount, status)
        values (${tenantB}, ${empleadoB}, 'Herramientas', 15000, 'pending') returning id`,
    )
    requisicion = r!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`
        update public.purchase_requisitions
        set status = 'approved', approved_by = ${aprobadorB}, approved_at = now()
        where id = ${requisicion}`,
    )
    const [row] = await sql`select status from public.purchase_requisitions where id = ${requisicion}`
    expect(row!.status).toBe('approved')
  })

  it('aprobada SI se puede seguir editando -por ejemplo, agregar la referencia de la orden-', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.purchase_requisitions set po_reference = 'OC-2026-00042' where id = ${requisicion}`,
    )
    const [row] = await sql`select po_reference from public.purchase_requisitions where id = ${requisicion}`
    expect(row!.po_reference).toBe('OC-2026-00042')
  })

  it('al marcarla convertida, ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.purchase_requisitions set status = 'converted' where id = ${requisicion}`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.purchase_requisitions set po_reference = 'otro' where id = ${requisicion}`,
      ),
    ).rejects.toThrow(/ya quedo resuelta/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'requisitions', true))

  it('sin el modulo, las requisiciones dan cero filas', async () => {
    await modulo(tenantB, 'requisitions', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.purchase_requisitions`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un monto de cero o negativo se rechaza', async () => {
    await expect(
      sql`
        insert into public.purchase_requisitions (tenant_id, employee_id, description, estimated_amount)
        values (${tenantA}, ${empleadoA}, 'x', 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un estado inventado se rechaza', async () => {
    await expect(
      sql`
        insert into public.purchase_requisitions (tenant_id, employee_id, description, estimated_amount, status)
        values (${tenantA}, ${empleadoA}, 'x', 100, 'en_revision_legal')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
