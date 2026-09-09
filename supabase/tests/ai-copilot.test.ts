import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Copiloto IA (modulo 90, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes -el requisito de seguridad
 *     mas importante de este modulo, senalado explicitamente en el
 *     documento maestro-.
 *  2. Una consulta es inmutable desde el primer insert.
 *  3. No existe ningun camino para guardar un `matched_key` fuera del
 *     catalogo fijo -la fuga entre tenants queda eliminada por
 *     construccion, no hay SQL libre que probar-.
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
    values (${`ai-a-${RUN}`}, 'Copiloto A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ai-b-${RUN}`}, 'Copiloto B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'ai-copilot', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  await sql`
    insert into public.copilot_queries (tenant_id, user_id, question, matched_key, answer_summary)
    values (${tenantA}, ${userA}, '¿Cuanto vendimos hoy?', 'sales_by_day', 'RD$0.00 en ventas hoy')`
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.copilot_queries disable trigger no_editar_consulta_copiloto')
  await sql`delete from public.copilot_queries where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.copilot_queries enable trigger no_editar_consulta_copiloto')
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia consulta normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.copilot_queries`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve la consulta de A ni apuntando a su tenant_id -el requisito de seguridad clave de este modulo-', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.copilot_queries where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede insertar una fila apuntando al tenant_id de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.copilot_queries (tenant_id, user_id, question, matched_key)
          values (${tenantA}, ${userB}, 'x', 'no_match')`,
      ),
    ).rejects.toThrow(/row-level security|new row violates/)
  })
})

describe('Una consulta es inmutable desde el primer insert', () => {
  it('se registra normalmente pero nunca se puede editar', async () => {
    const [q] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.copilot_queries (tenant_id, user_id, question, matched_key, answer_summary)
        values (${tenantB}, ${userB}, '¿Que facturas estan vencidas?', 'overdue_invoices', 'Ninguna vencida') returning id`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.copilot_queries set answer_summary = 'x' where id = ${q!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'ai-copilot', true))

  it('sin el modulo, las consultas dan cero filas', async () => {
    await modulo(tenantB, 'ai-copilot', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.copilot_queries`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un matched_key fuera del catalogo fijo se rechaza -no existe SQL libre que probar-', async () => {
    await expect(
      sql`insert into public.copilot_queries (tenant_id, user_id, question, matched_key)
        values (${tenantA}, ${userA}, 'x', 'select * from otra_tabla')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
