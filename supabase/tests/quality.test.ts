import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Control de calidad (modulo 58, F8.5) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un criterio, una inspeccion, un resultado, una
 *     no conformidad, un CAPA o un certificado con referencias de A
 *     usando su PROPIO tenant_id. Mismo patron que 0031-0074.
 *  3. Una inspeccion y sus resultados son inmutables desde el primer
 *     insert. Una no conformidad se congela en 'closed'/'dismissed'.
 *     Un CAPA se congela en 'closed'.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let productoA: string
let productoB: string
let planA: string
let planB: string
let inspeccionA: string

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
    values (${`qa-a-${RUN}`}, 'Calidad QA A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`qa-b-${RUN}`}, 'Calidad QA B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'quality', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`PRD-${RUN}`}, 'Producto A') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`PRD2-${RUN}`}, 'Producto B') returning id`
  productoA = pa!.id
  productoB = pb!.id

  const [pla] = await sql`
    insert into public.inspection_plans (tenant_id, name, scope, product_id)
    values (${tenantA}, 'Plan A', 'receiving', ${productoA}) returning id`
  const [plb] = await sql`
    insert into public.inspection_plans (tenant_id, name, scope, product_id)
    values (${tenantB}, 'Plan B', 'receiving', ${productoB}) returning id`
  planA = pla!.id
  planB = plb!.id

  const [ia] = await sql`
    insert into public.inspections (tenant_id, plan_id, product_id, result)
    values (${tenantA}, ${planA}, ${productoA}, 'passed') returning id`
  inspeccionA = ia!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.capas disable trigger no_editar_capa_cerrado')
  await sql.unsafe('alter table public.non_conformances disable trigger no_editar_no_conformidad_resuelta')
  await sql.unsafe('alter table public.inspection_results disable trigger no_editar_resultado')
  await sql.unsafe('alter table public.inspections disable trigger no_editar_inspeccion')
  await sql`delete from public.capas where tenant_id in ${sql(ts)}`
  await sql`delete from public.non_conformances where tenant_id in ${sql(ts)}`
  await sql`delete from public.inspection_results where tenant_id in ${sql(ts)}`
  await sql`delete from public.inspections where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.capas enable trigger no_editar_capa_cerrado')
  await sql.unsafe('alter table public.non_conformances enable trigger no_editar_no_conformidad_resuelta')
  await sql.unsafe('alter table public.inspection_results enable trigger no_editar_resultado')
  await sql.unsafe('alter table public.inspections enable trigger no_editar_inspeccion')
  await sql`delete from public.inspection_plan_criteria where tenant_id in ${sql(ts)}`
  await sql`delete from public.quality_certificates where tenant_id in ${sql(ts)}`
  await sql`delete from public.inspection_plans where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio plan normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.inspection_plans`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve el plan de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.inspection_plans where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un criterio con el plan de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.inspection_plan_criteria (plan_id, tenant_id, criterion)
          values (${planA}, ${tenantB}, 'Un criterio')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una inspeccion con el plan o el producto de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.inspections (tenant_id, plan_id, product_id, result)
          values (${tenantB}, ${planA}, ${productoB}, 'passed')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.inspections (tenant_id, plan_id, product_id, result)
          values (${tenantB}, ${planB}, ${productoA}, 'passed')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un resultado con la inspeccion de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.inspection_results (inspection_id, tenant_id, criterion, passed)
          values (${inspeccionA}, ${tenantB}, 'Criterio', true)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una no conformidad con la inspeccion de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.non_conformances (tenant_id, description, severity, inspection_id)
          values (${tenantB}, 'Defecto', 'minor', ${inspeccionA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un CAPA con la no conformidad de A usando su PROPIO tenant_id', async () => {
    const [ncA] = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`
        insert into public.non_conformances (tenant_id, description, severity)
        values (${tenantA}, 'Defecto A', 'major') returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.capas (tenant_id, non_conformance_id, root_cause, corrective_action)
          values (${tenantB}, ${ncA!.id}, 'Causa', 'Accion')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un certificado con el producto de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.quality_certificates (tenant_id, product_id, cert_number, issuing_body, issued_at)
          values (${tenantB}, ${productoA}, 'CERT-1', 'INDOCAL', current_date)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Inmutabilidad', () => {
  it('una inspeccion nunca se puede editar', async () => {
    const [i] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.inspections (tenant_id, plan_id, product_id, result)
        values (${tenantB}, ${planB}, ${productoB}, 'failed') returning id`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.inspections set result = 'passed' where id = ${i!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('un resultado de inspeccion nunca se puede editar', async () => {
    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`
        insert into public.inspection_results (inspection_id, tenant_id, criterion, passed)
        values (${inspeccionA}, ${tenantA}, 'Criterio', false) returning id`,
    )
    await expect(
      as(userA, tenantA, (tx) => tx`update public.inspection_results set passed = true where id = ${r!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('una no conformidad abierta SI se puede editar; cerrada, no', async () => {
    const [nc] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.non_conformances (tenant_id, description, severity)
        values (${tenantB}, 'Defecto B', 'minor') returning id`,
    )
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.non_conformances set status = 'investigating' where id = ${nc!.id}`,
    )
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.non_conformances set status = 'dismissed' where id = ${nc!.id}`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.non_conformances set description = 'x' where id = ${nc!.id}`,
      ),
    ).rejects.toThrow(/ya se resolvio y no se edita/)
  })

  it('un CAPA abierto SI se puede editar; cerrado, no', async () => {
    const [nc] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.non_conformances (tenant_id, description, severity)
        values (${tenantB}, 'Defecto C', 'critical') returning id`,
    )
    const [capa] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.capas (tenant_id, non_conformance_id, root_cause, corrective_action)
        values (${tenantB}, ${nc!.id}, 'Causa', 'Accion') returning id`,
    )
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.capas set status = 'in_progress' where id = ${capa!.id}`,
    )
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.capas set status = 'verified' where id = ${capa!.id}`,
    )
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.capas set status = 'closed' where id = ${capa!.id}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.capas set root_cause = 'otra' where id = ${capa!.id}`),
    ).rejects.toThrow(/ya esta cerrado y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'quality', true))

  it('sin el modulo, los planes dan cero filas', async () => {
    await modulo(tenantB, 'quality', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.inspection_plans`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un scope de plan inventado se rechaza', async () => {
    await expect(
      sql`insert into public.inspection_plans (tenant_id, name, scope) values (${tenantA}, 'Plan X', 'invalido')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un resultado de inspeccion inventado se rechaza', async () => {
    await expect(
      sql`insert into public.inspections (tenant_id, plan_id, result) values (${tenantA}, ${planA}, 'invalido')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una severidad inventada se rechaza', async () => {
    await expect(
      sql`insert into public.non_conformances (tenant_id, description, severity) values (${tenantA}, 'x', 'invalido')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
