import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Fidelizacion (modulo 38, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una transaccion/cupon/referido con el cliente
 *     de A usando su PROPIO tenant_id. Mismo patron que 0031-0085.
 *  3. Una transaccion de puntos es inmutable desde el insert; un
 *     cupon y un referido se congelan solo al resolverse.
 *  4. El saldo y el nivel se DERIVAN del historial, nunca se guardan.
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
let clienteB2: string

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
    values (${`loy-a-${RUN}`}, 'Fidelizacion A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`loy-b-${RUN}`}, 'Fidelizacion B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'loyalty', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ca] = await sql`
    insert into public.customers (tenant_id, name, payment_terms) values (${tenantA}, 'Cliente A', 30) returning id`
  const [cb] = await sql`
    insert into public.customers (tenant_id, name, payment_terms) values (${tenantB}, 'Cliente B', 30) returning id`
  const [cb2] = await sql`
    insert into public.customers (tenant_id, name, payment_terms) values (${tenantB}, 'Cliente B2', 30) returning id`
  clienteA = ca!.id
  clienteB = cb!.id
  clienteB2 = cb2!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.loyalty_transactions disable trigger no_editar_transaccion_puntos')
  await sql`delete from public.loyalty_transactions where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.loyalty_transactions enable trigger no_editar_transaccion_puntos')
  await sql.unsafe('alter table public.loyalty_coupons disable trigger no_editar_cupon_resuelto')
  await sql`delete from public.loyalty_coupons where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.loyalty_coupons enable trigger no_editar_cupon_resuelto')
  await sql.unsafe('alter table public.loyalty_referrals disable trigger no_editar_referido_resuelto')
  await sql`delete from public.loyalty_referrals where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.loyalty_referrals enable trigger no_editar_referido_resuelto')
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia transaccion normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.loyalty_transactions (tenant_id, customer_id, points, reason, source_type)
        values (${tenantA}, ${clienteA}, 50, 'Compra', 'purchase')`,
    )
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.loyalty_transactions`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve la transaccion de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.loyalty_transactions where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una transaccion con el cliente de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.loyalty_transactions (tenant_id, customer_id, points, reason, source_type)
          values (${tenantB}, ${clienteA}, 10, 'x', 'manual')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un cupon con el cliente de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.loyalty_coupons (tenant_id, code, customer_id, discount_type, discount_value)
          values (${tenantB}, ${`CUP-X-${RUN}`}, ${clienteA}, 'fixed', 100)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un referido con el cliente de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.loyalty_referrals (tenant_id, referrer_customer_id, referred_customer_id, bonus_points)
          values (${tenantB}, ${clienteA}, ${clienteB}, 100)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('El saldo y el nivel se derivan del historial', () => {
  it('el saldo suma ganado menos redimido', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        insert into public.loyalty_transactions (tenant_id, customer_id, points, reason, source_type)
        values
          (${tenantB}, ${clienteB}, 100, 'Compra 1', 'purchase'),
          (${tenantB}, ${clienteB}, 50, 'Compra 2', 'purchase'),
          (${tenantB}, ${clienteB}, -30, 'Redime premio', 'redemption')`,
    )
    const [saldo] = await sql`select public.loyalty_balance(${clienteB}) as saldo`
    expect(saldo!.saldo).toBe(120)
  })

  it('el nivel de por vida NO baja al redimir -son puntos ganados, no el saldo actual-', async () => {
    const [vida] = await sql`select public.loyalty_lifetime_points(${clienteB}) as vida`
    expect(vida!.vida).toBe(150)
  })
})

describe('Transaccion inmutable; cupon y referido se congelan solo al resolverse', () => {
  let cupon: string
  let referido: string

  it('una transaccion se registra normalmente pero nunca se puede editar', async () => {
    const [t] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.loyalty_transactions (tenant_id, customer_id, points, reason, source_type)
        values (${tenantB}, ${clienteB}, 20, 'Ajuste manual', 'manual') returning id`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.loyalty_transactions set points = 999 where id = ${t!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('un cupon activo es editable; redimido se congela', async () => {
    const [c] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.loyalty_coupons (tenant_id, code, customer_id, discount_type, discount_value)
        values (${tenantB}, ${`CUP-B-${RUN}`}, ${clienteB}, 'percentage', 0.1) returning id`,
    )
    cupon = c!.id
    await as(userB, tenantB, (tx) => tx`update public.loyalty_coupons set discount_value = 0.15 where id = ${cupon}`)
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.loyalty_coupons set status = 'redeemed', redeemed_at = now() where id = ${cupon}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.loyalty_coupons set discount_value = 0.5 where id = ${cupon}`),
    ).rejects.toThrow(/ya se resolvio y no se edita/)
  })

  it('un referido pendiente avanza a completado; completado se congela', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.loyalty_referrals (tenant_id, referrer_customer_id, referred_customer_id, bonus_points)
        values (${tenantB}, ${clienteB}, ${clienteB2}, 100)
        returning id`,
    )
    referido = r!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.loyalty_referrals set status = 'completed', completed_at = now() where id = ${referido}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.loyalty_referrals set status = 'pending' where id = ${referido}`),
    ).rejects.toThrow(/ya se resolvio y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'loyalty', true))

  it('sin el modulo, las transacciones dan cero filas', async () => {
    await modulo(tenantB, 'loyalty', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.loyalty_transactions`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una transaccion de cero puntos se rechaza', async () => {
    await expect(
      sql`insert into public.loyalty_transactions (tenant_id, customer_id, points, reason, source_type)
        values (${tenantA}, ${clienteA}, 0, 'x', 'manual')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un cupon porcentual mayor que 100% se rechaza', async () => {
    await expect(
      sql`insert into public.loyalty_coupons (tenant_id, code, customer_id, discount_type, discount_value)
        values (${tenantA}, ${`CUP-INV-${RUN}`}, ${clienteA}, 'percentage', 1.5)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un referido no puede referirse a si mismo', async () => {
    await expect(
      sql`insert into public.loyalty_referrals (tenant_id, referrer_customer_id, referred_customer_id, bonus_points)
        values (${tenantA}, ${clienteA}, ${clienteA}, 50)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo codigo de cupon no se repite dentro del mismo tenant', async () => {
    const codigo = `CUP-DUP-${RUN}`
    await sql`insert into public.loyalty_coupons (tenant_id, code, discount_type, discount_value)
      values (${tenantA}, ${codigo}, 'fixed', 50)`
    await expect(
      sql`insert into public.loyalty_coupons (tenant_id, code, discount_type, discount_value)
        values (${tenantA}, ${codigo}, 'fixed', 50)`,
    ).rejects.toThrow(/duplicate key/)
  })
})
