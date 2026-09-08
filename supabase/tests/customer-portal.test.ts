import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Portal de clientes (modulo 39, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un acceso con la invitacion de A usando su
 *     PROPIO tenant_id. Mismo patron que 0031-0083.
 *  3. Una invitacion es editable hasta revocarse; un acceso es
 *     inmutable desde el primer insert.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let clienteA: string
let clienteB: string
let invitacionA: string

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
    values (${`cp-a-${RUN}`}, 'Portal CP A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`cp-b-${RUN}`}, 'Portal CP B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'customer-portal', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ca] = await sql`
    insert into public.customers (tenant_id, name, payment_terms) values (${tenantA}, 'Cliente A', 30) returning id`
  const [cb] = await sql`
    insert into public.customers (tenant_id, name, payment_terms) values (${tenantB}, 'Cliente B', 30) returning id`
  clienteA = ca!.id
  clienteB = cb!.id

  const [ia] = await sql`
    insert into public.portal_invites (tenant_id, customer_id, email, token)
    values (${tenantA}, ${clienteA}, 'a@example.do', ${`tok-a-${RUN}`}) returning id`
  invitacionA = ia!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.portal_access_log disable trigger no_editar_acceso')
  await sql`delete from public.portal_access_log where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.portal_access_log enable trigger no_editar_acceso')
  await sql.unsafe('alter table public.portal_invites disable trigger no_editar_invitacion_revocada')
  await sql`delete from public.portal_invites where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.portal_invites enable trigger no_editar_invitacion_revocada')
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia invitacion normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.portal_invites`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve la invitacion de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.portal_invites where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una invitacion con el cliente de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.portal_invites (tenant_id, customer_id, email, token)
          values (${tenantB}, ${clienteA}, 'x@x.do', ${`tok-x-${RUN}`})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un acceso con la invitacion de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`insert into public.portal_access_log (tenant_id, invite_id) values (${tenantB}, ${invitacionA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Invitacion editable hasta revocarse; acceso inmutable desde el insert', () => {
  let invitacion: string

  it('pendiente, se puede activar', async () => {
    const [i] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.portal_invites (tenant_id, customer_id, email, token)
        values (${tenantB}, ${clienteB}, 'b@example.do', ${`tok-b-${RUN}`}) returning id`,
    )
    invitacion = i!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.portal_invites set status = 'active', activated_at = now() where id = ${invitacion}`,
    )
    const [row] = await sql`select status from public.portal_invites where id = ${invitacion}`
    expect(row!.status).toBe('active')
  })

  it('un acceso se registra normalmente pero nunca se puede editar', async () => {
    const [acc] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.portal_access_log (tenant_id, invite_id) values (${tenantB}, ${invitacion}) returning id`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.portal_access_log set ip_address = 'x' where id = ${acc!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('revocada, la invitacion ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.portal_invites set status = 'revoked', revoked_at = now() where id = ${invitacion}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.portal_invites set email = 'otro@x.do' where id = ${invitacion}`),
    ).rejects.toThrow(/ya se revoco y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'customer-portal', true))

  it('sin el modulo, las invitaciones dan cero filas', async () => {
    await modulo(tenantB, 'customer-portal', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.portal_invites`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un estado inventado se rechaza', async () => {
    await expect(
      sql`insert into public.portal_invites (tenant_id, customer_id, email, token, status)
        values (${tenantA}, ${clienteA}, 'x@x.do', ${`tok-y-${RUN}`}, 'invalido')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo token no se repite -es la llave de acceso-', async () => {
    await expect(
      sql`insert into public.portal_invites (tenant_id, customer_id, email, token)
        values (${tenantA}, ${clienteA}, 'x@x.do', ${`tok-a-${RUN}`})`,
    ).rejects.toThrow(/duplicate key/)
  })
})
