import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Mesa de ayuda (modulo 40, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un mensaje con el ticket de A usando su
 *     PROPIO tenant_id. Mismo patron que 0031-0084.
 *  3. Un ticket es editable hasta cerrarse -incluso resuelto se puede
 *     reabrir-; un mensaje es inmutable desde el primer insert.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let ticketA: string

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
    values (${`hd-a-${RUN}`}, 'Soporte HD A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`hd-b-${RUN}`}, 'Soporte HD B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'helpdesk', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ta] = await sql`
    insert into public.tickets (tenant_id, subject, description) values (${tenantA}, 'Asunto A', 'Descripcion A') returning id`
  ticketA = ta!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.ticket_messages disable trigger no_editar_mensaje')
  await sql`delete from public.ticket_messages where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.ticket_messages enable trigger no_editar_mensaje')
  await sql.unsafe('alter table public.tickets disable trigger no_editar_ticket_cerrado')
  await sql`delete from public.tickets where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.tickets enable trigger no_editar_ticket_cerrado')
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio ticket normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.tickets`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve el ticket de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.tickets where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un mensaje con el ticket de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.ticket_messages (tenant_id, ticket_id, author_type, body)
          values (${tenantB}, ${ticketA}, 'agent', 'x')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Editable hasta cerrarse; resuelto SI se puede reabrir; mensaje inmutable', () => {
  let ticket: string

  it('open a in_progress y editar la prioridad: ambos funcionan', async () => {
    const [t] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.tickets (tenant_id, subject, description) values (${tenantB}, 'Asunto B', 'Descripcion B') returning id`,
    )
    ticket = t!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.tickets set status = 'in_progress', priority = 'high' where id = ${ticket}`,
    )
    const [row] = await sql`select status, priority from public.tickets where id = ${ticket}`
    expect(row!.status).toBe('in_progress')
    expect(row!.priority).toBe('high')
  })

  it('un mensaje se registra normalmente pero nunca se puede editar', async () => {
    const [m] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.ticket_messages (tenant_id, ticket_id, author_type, body)
        values (${tenantB}, ${ticket}, 'agent', 'Primera respuesta') returning id`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.ticket_messages set body = 'x' where id = ${m!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('resuelto SI se puede reabrir a in_progress', async () => {
    await as(userB, tenantB, (tx) => tx`update public.tickets set status = 'resolved', resolved_at = now() where id = ${ticket}`)
    await as(userB, tenantB, (tx) => tx`update public.tickets set status = 'in_progress' where id = ${ticket}`)
    const [row] = await sql`select status from public.tickets where id = ${ticket}`
    expect(row!.status).toBe('in_progress')
  })

  it('cerrado, ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.tickets set status = 'closed', closed_at = now() where id = ${ticket}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.tickets set priority = 'low' where id = ${ticket}`),
    ).rejects.toThrow(/ya esta cerrado y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'helpdesk', true))

  it('sin el modulo, los tickets dan cero filas', async () => {
    await modulo(tenantB, 'helpdesk', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.tickets`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una prioridad inventada se rechaza', async () => {
    await expect(
      sql`insert into public.tickets (tenant_id, subject, description, priority) values (${tenantA}, 'x', 'x', 'invalido')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una satisfaccion fuera de 1-5 se rechaza', async () => {
    await expect(
      sql`insert into public.tickets (tenant_id, subject, description, satisfaction_rating) values (${tenantA}, 'x', 'x', 6)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
