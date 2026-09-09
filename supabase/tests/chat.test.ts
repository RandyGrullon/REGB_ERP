import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Chat interno (modulo 92, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un mensaje con el canal/hilo de A usando su
 *     PROPIO tenant_id. Mismo patron que 0031-0091.
 *  3. Un mensaje es inmutable desde el primer insert.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let canalA: string
let canalB: string
let mensajeA: string

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
    values (${`chat-a-${RUN}`}, 'Chat A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`chat-b-${RUN}`}, 'Chat B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'chat', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ca] = await sql`
    insert into public.chat_channels (tenant_id, name) values (${tenantA}, 'General A') returning id`
  const [cb] = await sql`
    insert into public.chat_channels (tenant_id, name) values (${tenantB}, 'General B') returning id`
  canalA = ca!.id
  canalB = cb!.id

  const [ma] = await sql`
    insert into public.chat_messages (tenant_id, channel_id, author_id, body) values (${tenantA}, ${canalA}, ${userA}, 'Hola A') returning id`
  mensajeA = ma!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.chat_messages disable trigger no_editar_mensaje_chat')
  await sql`delete from public.chat_messages where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.chat_messages enable trigger no_editar_mensaje_chat')
  await sql`delete from public.chat_channels where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio canal normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.chat_channels`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve el canal de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.chat_channels where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un mensaje con el canal de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.chat_messages (tenant_id, channel_id, author_id, body)
          values (${tenantB}, ${canalA}, ${userB}, 'x')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un mensaje con el hilo de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.chat_messages (tenant_id, channel_id, author_id, body, parent_message_id)
          values (${tenantB}, ${canalB}, ${userB}, 'x', ${mensajeA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Un mensaje es inmutable desde el primer insert', () => {
  it('se registra normalmente pero nunca se puede editar', async () => {
    const [m] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.chat_messages (tenant_id, channel_id, author_id, body)
        values (${tenantB}, ${canalB}, ${userB}, 'Hola B') returning id`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.chat_messages set body = 'x' where id = ${m!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('un hilo real -responder dentro de un mensaje- funciona', async () => {
    const [respuesta] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string; parent_message_id: string }[]>`
        insert into public.chat_messages (tenant_id, channel_id, author_id, body, parent_message_id)
        values (${tenantB}, ${canalB}, ${userB}, 'Respondiendo', (select id from public.chat_messages where tenant_id = ${tenantB} and body = 'Hola B'))
        returning id, parent_message_id`,
    )
    expect(respuesta!.parent_message_id).not.toBeNull()
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'chat', true))

  it('sin el modulo, los canales dan cero filas', async () => {
    await modulo(tenantB, 'chat', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.chat_channels`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un ambito de canal inventado se rechaza', async () => {
    await expect(
      sql`insert into public.chat_channels (tenant_id, name, scope_type) values (${tenantA}, 'x', 'equipo')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo nombre de canal no se repite dentro del mismo tenant', async () => {
    await expect(
      sql`insert into public.chat_channels (tenant_id, name) values (${tenantA}, 'General A')`,
    ).rejects.toThrow(/duplicate key/)
  })
})
