import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * BI & Reportes (modulo 87, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un item de dashboard o un export con el
 *     reporte/dashboard de A usando su PROPIO tenant_id. Mismo patron
 *     que 0031-0088.
 *  3. Reportes, dashboards y exports son configuracion editable en
 *     todo momento -no hay una maquina de estados terminal aqui-.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let reporteA: string
let reporteB: string
let dashboardA: string

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
    values (${`bi-a-${RUN}`}, 'BI A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`bi-b-${RUN}`}, 'BI B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'bi', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ra] = await sql`
    insert into public.report_definitions (tenant_id, name, source_key) values (${tenantA}, 'Ventas A', 'sales_by_day') returning id`
  const [rb] = await sql`
    insert into public.report_definitions (tenant_id, name, source_key) values (${tenantB}, 'Ventas B', 'sales_by_day') returning id`
  reporteA = ra!.id
  reporteB = rb!.id

  const [da] = await sql`
    insert into public.dashboards (tenant_id, name) values (${tenantA}, 'Panel A') returning id`
  dashboardA = da!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.scheduled_exports where tenant_id in ${sql(ts)}`
  await sql`delete from public.dashboard_items where tenant_id in ${sql(ts)}`
  await sql`delete from public.dashboards where tenant_id in ${sql(ts)}`
  await sql`delete from public.report_definitions where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio reporte normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.report_definitions`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve el reporte de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.report_definitions where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un item de dashboard con el reporte de A usando su PROPIO tenant_id', async () => {
    const [dashboardB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`insert into public.dashboards (tenant_id, name) values (${tenantB}, 'Panel B') returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.dashboard_items (tenant_id, dashboard_id, report_id, position)
          values (${tenantB}, ${dashboardB!.id}, ${reporteA}, 0)`,
      ),
    ).rejects.toThrow(/no pertenecen a esta cuenta/)
  })

  it('B no puede colar un item con el dashboard de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.dashboard_items (tenant_id, dashboard_id, report_id, position)
          values (${tenantB}, ${dashboardA}, ${reporteB}, 0)`,
      ),
    ).rejects.toThrow(/no pertenecen a esta cuenta/)
  })

  it('B no puede colar un export con el reporte de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.scheduled_exports (tenant_id, report_id, frequency, recipients, next_run_at)
          values (${tenantB}, ${reporteA}, 'daily', 'x@x.do', now())`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Configuracion editable en todo momento', () => {
  it('un reporte, un dashboard y un export se pueden editar libremente', async () => {
    await as(userB, tenantB, (tx) => tx`update public.report_definitions set name = 'Ventas B v2' where id = ${reporteB}`)
    const [row] = await sql`select name from public.report_definitions where id = ${reporteB}`
    expect(row!.name).toBe('Ventas B v2')
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'bi', true))

  it('sin el modulo, los reportes dan cero filas', async () => {
    await modulo(tenantB, 'bi', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.report_definitions`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una fuente de reporte inventada se rechaza', async () => {
    await expect(
      sql`insert into public.report_definitions (tenant_id, name, source_key) values (${tenantA}, 'x', 'consulta_libre')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una frecuencia de export inventada se rechaza', async () => {
    await expect(
      sql`insert into public.scheduled_exports (tenant_id, report_id, frequency, recipients, next_run_at)
        values (${tenantA}, ${reporteA}, 'hourly', 'x@x.do', now())`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo nombre de dashboard no se repite dentro del mismo tenant', async () => {
    await expect(
      sql`insert into public.dashboards (tenant_id, name) values (${tenantA}, 'Panel A')`,
    ).rejects.toThrow(/duplicate key/)
  })
})
