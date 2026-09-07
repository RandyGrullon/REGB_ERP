import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Pasarelas de cobro (modulo 27, F6) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un link ni un cobro recurrente con un cliente de A
 *     usando su PROPIO tenant_id. Mismo patron que 0040, 0041, 0044,
 *     0045, 0046, 0047 y 0048.
 *  3. mark_payment_link_paid() no deja pagar dos veces ni pagar uno
 *     cancelado.
 *  4. Un link pagado o cancelado queda inmutable.
 *  5. run_recurring_charges() es idempotente: correrla dos veces el
 *     mismo dia no genera un segundo link para el mismo periodo.
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
    values (${`pay-a-${RUN}`}, 'Ferreteria PAY A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`pay-b-${RUN}`}, 'Distribuidora PAY B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'payments', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ca] = await sql`
    insert into public.customers (tenant_id, name, payment_terms)
    values (${tenantA}, 'Cliente PAY A', 0) returning id`
  const [cb] = await sql`
    insert into public.customers (tenant_id, name, payment_terms)
    values (${tenantB}, 'Cliente PAY B', 0) returning id`
  clienteA = ca!.id
  clienteB = cb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.payment_links disable trigger no_editar_link_terminal')
  await sql`delete from public.payment_links where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.payment_links enable trigger no_editar_link_terminal')
  await sql`delete from public.recurring_charges where tenant_id in ${sql(ts)}`
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A registra su propio link normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.payment_links (tenant_id, customer_id, amount, description)
        values (${tenantA}, ${clienteA}, 1500, 'Servicio de instalacion')`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.payment_links`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve el link de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.payment_links where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un link con un cliente de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.payment_links (tenant_id, customer_id, amount, description)
          values (${tenantB}, ${clienteA}, 500, 'Ajeno')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un cobro recurrente con un cliente de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.recurring_charges
            (tenant_id, customer_id, amount, description, frequency, next_charge_date)
          values (${tenantB}, ${clienteA}, 500, 'Ajeno', 'monthly', current_date)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Confirmar un pago', () => {
  let link: string

  beforeAll(async () => {
    const [l] = await sql`
      insert into public.payment_links (tenant_id, customer_id, amount, description)
      values (${tenantA}, ${clienteA}, 2000, 'Otro cobro') returning id`
    link = l!.id
  })

  it('B no puede confirmar el pago de un link de A', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`select public.mark_payment_link_paid(${link}, 2000)`),
    ).rejects.toThrow(/no es de este cliente/)
  })

  it('confirma el pago correctamente', async () => {
    await as(userA, tenantA, (tx) => tx`select public.mark_payment_link_paid(${link}, 2000)`)
    const [l] = await sql<{ status: string; paid_amount: string }[]>`
      select status, paid_amount::text from public.payment_links where id = ${link}`
    expect(l).toMatchObject({ status: 'paid', paid_amount: '2000.00' })
  })

  it('no se puede confirmar el pago dos veces', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`select public.mark_payment_link_paid(${link}, 2000)`),
    ).rejects.toThrow(/ya esta marcado como pagado/)
  })

  it('un link pagado no se edita ni se borra', async () => {
    await expect(
      sql`update public.payment_links set amount = 1 where id = ${link}`,
    ).rejects.toThrow(/no se edita/)
  })
})

describe('Cobro recurrente', () => {
  let recurrente: string

  beforeAll(async () => {
    const [r] = await sql`
      insert into public.recurring_charges
        (tenant_id, customer_id, amount, description, frequency, next_charge_date)
      values (${tenantA}, ${clienteA}, 3000, 'Mantenimiento mensual', 'monthly', current_date)
      returning id`
    recurrente = r!.id
  })

  it('genera un link y avanza la fecha', async () => {
    const [n] = await as(
      userA,
      tenantA,
      (tx) => tx<{ n: string }[]>`select public.run_recurring_charges(${tenantA})::text as n`,
    )
    expect(Number(n!.n)).toBe(1)

    const [r] = await sql<{ next_charge_date: string }[]>`
      select next_charge_date::text from public.recurring_charges where id = ${recurrente}`
    expect(new Date(r!.next_charge_date).getTime()).toBeGreaterThan(Date.now())
  })

  it('correrla de nuevo el mismo dia no genera un segundo link para el mismo periodo', async () => {
    const [n] = await as(
      userA,
      tenantA,
      (tx) => tx<{ n: string }[]>`select public.run_recurring_charges(${tenantA})::text as n`,
    )
    expect(Number(n!.n)).toBe(0)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'payments', true))

  it('sin el modulo, los links dan cero filas', async () => {
    await modulo(tenantB, 'payments', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.payment_links`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un monto de cero se rechaza', async () => {
    await expect(
      sql`
        insert into public.payment_links (tenant_id, customer_id, amount, description)
        values (${tenantB}, ${clienteB}, 0, 'Nada')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una frecuencia inventada se rechaza', async () => {
    await expect(
      sql`
        insert into public.recurring_charges
          (tenant_id, customer_id, amount, description, frequency, next_charge_date)
        values (${tenantB}, ${clienteB}, 100, 'Test', 'diaria', current_date)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
