import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Portal del Empleado (modulo 70, F7) contra Postgres real.
 *
 * `hr_announcements` no referencia ninguna otra tabla de tenant -no hay
 * employee_id ni branch_id que pueda ser de otro cliente-, asi que no
 * hay un trigger de referencia cruzada que probar (patron 0031 no
 * aplica aqui). Lo que si hace falta cubrir es el aislamiento normal
 * entre clientes y el modulo apagado.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string

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
    values (${`hr-a-${RUN}`}, 'Ferreteria HR A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`hr-b-${RUN}`}, 'Distribuidora HR B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'employees', 'active', true), (${t}, 'hr-portal', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.hr_announcements where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A publica su propio anuncio normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.hr_announcements (tenant_id, title, body, published_by)
        values (${tenantA}, 'Cierre por feriado', 'El lunes no abrimos.', ${userA})`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.hr_announcements`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve el anuncio de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.hr_announcements where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un anuncio con el tenant_id de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.hr_announcements (tenant_id, title, body)
          values (${tenantA}, 'Intento ajeno', 'esto no deberia insertarse')`,
      ),
    ).rejects.toThrow()
  })

  it('B publica normalmente en SU propio tenant: aislar no rompe lo propio', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        insert into public.hr_announcements (tenant_id, title, body, published_by)
        values (${tenantB}, 'Bienvenida', 'Bienvenidos al equipo.', ${userB})`,
    )
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.hr_announcements`,
    )
    expect(filas).toHaveLength(1)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'hr-portal', true))

  it('sin el modulo, los anuncios dan cero filas', async () => {
    await modulo(tenantB, 'hr-portal', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.hr_announcements`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un anuncio sin titulo se rechaza', async () => {
    await expect(
      sql`insert into public.hr_announcements (tenant_id, title, body) values (${tenantA}, null, 'cuerpo')`,
    ).rejects.toThrow(/null value|violates not-null/)
  })

  it('un anuncio sin cuerpo se rechaza', async () => {
    await expect(
      sql`insert into public.hr_announcements (tenant_id, title, body) values (${tenantA}, 'titulo', null)`,
    ).rejects.toThrow(/null value|violates not-null/)
  })
})
