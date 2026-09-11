import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Costeo de proyectos (modulo 73, F10) contra Postgres real.
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un presupuesto/costo con el proyecto de A
 *     usando su PROPIO tenant_id. Mismo patron que 0031-0095.
 *  3. Un costo se puede marcar facturado -informacion nueva- pero
 *     nunca cambia de monto, fecha ni proyecto.
 *  4. El presupuesto, lo gastado y el WIP se DERIVAN.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let proyectoA: string
let proyectoB: string

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
    values (${`pc-a-${RUN}`}, 'Costeo A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`pc-b-${RUN}`}, 'Costeo B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'projects', 'active', true), (${t}, 'project-costing', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`insert into public.projects (tenant_id, name) values (${tenantA}, 'Obra A') returning id`
  const [pb] = await sql`insert into public.projects (tenant_id, name) values (${tenantB}, 'Obra B') returning id`
  proyectoA = pa!.id
  proyectoB = pb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.project_costs disable trigger no_editar_costo')
  await sql`delete from public.project_costs where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.project_costs enable trigger no_editar_costo')
  await sql`delete from public.project_budgets where tenant_id in ${sql(ts)}`
  await sql`delete from public.projects where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio presupuesto normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`insert into public.project_budgets (tenant_id, project_id, concept, amount) values (${tenantA}, ${proyectoA}, 'Mano de obra', 100000)`,
    )
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.project_budgets`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve el presupuesto de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.project_budgets where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un presupuesto con el proyecto de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`insert into public.project_budgets (tenant_id, project_id, concept, amount) values (${tenantB}, ${proyectoA}, 'x', 1)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un costo con el proyecto de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`insert into public.project_costs (tenant_id, project_id, concept, amount) values (${tenantB}, ${proyectoA}, 'x', 1)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('El presupuesto, lo gastado y el WIP se derivan', () => {
  it('suman del historial, no de un campo guardado', async () => {
    await as(userB, tenantB, async (tx) => {
      await tx`insert into public.project_budgets (tenant_id, project_id, concept, amount) values (${tenantB}, ${proyectoB}, 'Materiales', 60000)`
      await tx`insert into public.project_budgets (tenant_id, project_id, concept, amount) values (${tenantB}, ${proyectoB}, 'Equipos', 40000)`
      await tx`insert into public.project_costs (tenant_id, project_id, concept, amount, billed) values (${tenantB}, ${proyectoB}, 'Cemento', 25000, true)`
      await tx`insert into public.project_costs (tenant_id, project_id, concept, amount, billed) values (${tenantB}, ${proyectoB}, 'Alquiler mezcladora', 15000, false)`
    })

    const [row] = await sql`
      select public.project_budget_total(${proyectoB})::text as presupuesto,
             public.project_cost_total(${proyectoB})::text as gastado,
             public.project_wip(${proyectoB})::text as wip`
    expect(row!.presupuesto).toBe('100000.00')
    expect(row!.gastado).toBe('40000.00')
    expect(row!.wip).toBe('15000.00')
  })
})

describe('Un costo es un hecho historico', () => {
  let costo: string

  it('marcarlo facturado SI se permite -es informacion nueva-', async () => {
    const [c] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`insert into public.project_costs (tenant_id, project_id, concept, amount) values (${tenantB}, ${proyectoB}, 'Flete', 5000) returning id`,
    )
    costo = c!.id
    await as(userB, tenantB, (tx) => tx`update public.project_costs set billed = true where id = ${costo}`)
    const [row] = await sql`select billed from public.project_costs where id = ${costo}`
    expect(row!.billed).toBe(true)
  })

  it('pero nunca cambia de monto', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.project_costs set amount = 99999 where id = ${costo}`),
    ).rejects.toThrow(/no cambia de monto, fecha ni proyecto/)
  })

  it('ni se borra', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.project_costs where id = ${costo}`),
    ).rejects.toThrow(/no se borra/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'project-costing', true))

  it('sin el modulo, los presupuestos dan cero filas', async () => {
    await modulo(tenantB, 'project-costing', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.project_budgets`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una categoria inventada se rechaza', async () => {
    await expect(
      sql`insert into public.project_budgets (tenant_id, project_id, concept, amount, category) values (${tenantA}, ${proyectoA}, 'x', 1, 'inventada')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un costo de cero se rechaza', async () => {
    await expect(
      sql`insert into public.project_costs (tenant_id, project_id, concept, amount) values (${tenantA}, ${proyectoA}, 'x', 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
