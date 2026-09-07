import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Reclutamiento / ATS (modulo 65, F7) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una aplicacion con la vacante o el candidato de
 *     A usando su PROPIO tenant_id -ni una entrevista con la aplicacion
 *     de A-. Mismo patron que 0031-0057.
 *  3. Una aplicacion resuelta (hired/rejected) no se edita ni se borra.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let posicionA: string
let candidatoA: string
let posicionB: string
let candidatoB: string

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
    values (${`rc-a-${RUN}`}, 'Ferreteria RC A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`rc-b-${RUN}`}, 'Distribuidora RC B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'recruiting', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`
    insert into public.recruiting_positions (tenant_id, title) values (${tenantA}, 'Vendedor') returning id`
  const [ca] = await sql`
    insert into public.recruiting_candidates (tenant_id, first_name, last_name)
    values (${tenantA}, 'Pedro', 'Gomez') returning id`
  posicionA = pa!.id
  candidatoA = ca!.id

  const [pb] = await sql`
    insert into public.recruiting_positions (tenant_id, title) values (${tenantB}, 'Cajero') returning id`
  const [cb] = await sql`
    insert into public.recruiting_candidates (tenant_id, first_name, last_name)
    values (${tenantB}, 'Luis', 'Reyes') returning id`
  posicionB = pb!.id
  candidatoB = cb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.recruiting_applications disable trigger no_editar_aplicacion_resuelta')
  await sql`delete from public.recruiting_interviews where tenant_id in ${sql(ts)}`
  await sql`delete from public.recruiting_applications where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.recruiting_applications enable trigger no_editar_aplicacion_resuelta')
  await sql`delete from public.recruiting_candidates where tenant_id in ${sql(ts)}`
  await sql`delete from public.recruiting_positions where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A registra su propia aplicacion normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.recruiting_applications (tenant_id, position_id, candidate_id)
        values (${tenantA}, ${posicionA}, ${candidatoA})`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.recruiting_applications`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la aplicacion de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.recruiting_applications where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una aplicacion con la vacante de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.recruiting_applications (tenant_id, position_id, candidate_id)
          values (${tenantB}, ${posicionA}, ${candidatoB})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una aplicacion con el candidato de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.recruiting_applications (tenant_id, position_id, candidate_id)
          values (${tenantB}, ${posicionB}, ${candidatoA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una entrevista con la aplicacion de A usando su PROPIO tenant_id', async () => {
    const [aplicacionA] = await sql`
      select id from public.recruiting_applications where tenant_id = ${tenantA}`
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.recruiting_interviews (tenant_id, application_id, scheduled_at)
          values (${tenantB}, ${aplicacionA!.id}, now())`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Una aplicacion resuelta es inmutable', () => {
  let aplicacion: string

  it('avanzar de etapa mientras no esta resuelta funciona normal', async () => {
    const [a] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.recruiting_applications (tenant_id, position_id, candidate_id)
        values (${tenantB}, ${posicionB}, ${candidatoB}) returning id`,
    )
    aplicacion = a!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.recruiting_applications set stage = 'screening' where id = ${aplicacion}`,
    )
    const [row] = await sql`select stage from public.recruiting_applications where id = ${aplicacion}`
    expect(row!.stage).toBe('screening')
  })

  it('una vez marcada "hired", no se puede volver a editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.recruiting_applications set stage = 'hired' where id = ${aplicacion}`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.recruiting_applications set stage = 'rejected' where id = ${aplicacion}`,
      ),
    ).rejects.toThrow(/ya quedo resuelta/)
  })

  it('una vez resuelta, tampoco se puede borrar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.recruiting_applications where id = ${aplicacion}`),
    ).rejects.toThrow(/ya quedo resuelta/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'recruiting', true))

  it('sin el modulo, las vacantes dan cero filas', async () => {
    await modulo(tenantB, 'recruiting', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.recruiting_positions`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un estado de vacante inventado se rechaza', async () => {
    await expect(
      sql`insert into public.recruiting_positions (tenant_id, title, status) values (${tenantA}, 'x', 'en_pausa_larga')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('la misma vacante-candidato no puede aplicar dos veces', async () => {
    await expect(
      sql`
        insert into public.recruiting_applications (tenant_id, position_id, candidate_id)
        values (${tenantA}, ${posicionA}, ${candidatoA})`,
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })
})
