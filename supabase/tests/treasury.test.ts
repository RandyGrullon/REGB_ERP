import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Tesoreria & Bancos (modulo 19, F6) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un movimiento -ni una transferencia- en una cuenta
 *     de A usando su PROPIO tenant_id. Mismo patron que 0040 tapo en
 *     invoice_late_fees y 0041 en journal_entry_lines.
 *  3. Una transferencia crea SIEMPRE sus dos mitades, nunca una sola.
 *  4. Un movimiento registrado es inmutable: ni update ni delete, ni
 *     siquiera como superusuario.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let cuentaA1: string
let cuentaA2: string
let cuentaB1: string

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
    values (${`tes-a-${RUN}`}, 'Ferreteria Tesoreria A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`tes-b-${RUN}`}, 'Distribuidora Tesoreria B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'treasury', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [a1] = await sql`
    insert into public.bank_accounts
      (tenant_id, bank_name, account_name, account_number, opening_balance)
    values (${tenantA}, 'Banco Popular', 'Operativa', ${`001-${RUN}`}, 50000) returning id`
  const [a2] = await sql`
    insert into public.bank_accounts
      (tenant_id, bank_name, account_name, account_number, account_type, opening_balance)
    values (${tenantA}, 'Banreservas', 'Reserva', ${`002-${RUN}`}, 'savings', 10000) returning id`
  const [b1] = await sql`
    insert into public.bank_accounts
      (tenant_id, bank_name, account_name, account_number, opening_balance)
    values (${tenantB}, 'Banco BHD', 'Unica', ${`003-${RUN}`}, 7000) returning id`
  cuentaA1 = a1!.id
  cuentaA2 = a2!.id
  cuentaB1 = b1!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  // Los triggers de inmutabilidad bloquean el borrado incluso como dueno de
  // la tabla: se apagan SOLO para limpiar datos de prueba desechables.
  await sql.unsafe('alter table public.bank_transactions disable trigger no_editar_movimiento')
  await sql.unsafe('alter table public.bank_transfers disable trigger no_editar_transferencia')
  await sql`delete from public.bank_transactions where tenant_id in ${sql(ts)}`
  await sql`delete from public.bank_transfers where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.bank_transactions enable trigger no_editar_movimiento')
  await sql.unsafe('alter table public.bank_transfers enable trigger no_editar_transferencia')
  await sql`delete from public.bank_accounts where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('B no ve las cuentas de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.bank_accounts where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un movimiento en una cuenta de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.bank_transactions
            (tenant_id, bank_account_id, type, amount, description)
          values (${tenantB}, ${cuentaA1}, 'withdrawal', 5000, 'Retiro ajeno')`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('B no puede transferir desde una cuenta de A hacia la suya', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.bank_transfers
            (tenant_id, from_account_id, to_account_id, amount)
          values (${tenantB}, ${cuentaA1}, ${cuentaB1}, 5000)`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('la cuenta de B existe y es suya: aislar no puede romper lo propio', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.bank_accounts`,
    )
    expect(filas.map((f) => f.id)).toEqual([cuentaB1])
  })
})

describe('Saldo derivado', () => {
  it('saldo inicial + depositos - retiros', async () => {
    await sql`
      insert into public.bank_transactions
        (tenant_id, bank_account_id, type, amount, description)
      values (${tenantA}, ${cuentaA1}, 'deposit', 15000, 'Venta del dia'),
             (${tenantA}, ${cuentaA1}, 'withdrawal', 3000, 'Pago de luz')`

    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ saldo: string }[]>`
        select public.bank_account_balance(${cuentaA1})::text as saldo`,
    )
    expect(Number(r!.saldo)).toBe(62000) // 50000 + 15000 - 3000
  })
})

describe('Transferencia entre cuentas propias', () => {
  it('crea las dos mitades juntas, nunca una sola', async () => {
    const [t] = await sql`
      insert into public.bank_transfers
        (tenant_id, from_account_id, to_account_id, amount, description)
      values (${tenantA}, ${cuentaA1}, ${cuentaA2}, 8000, 'Paso a la reserva')
      returning id`

    const mitades = await sql<{ type: string; bank_account_id: string; amount: string }[]>`
      select type, bank_account_id, amount::text from public.bank_transactions
      where reference = ${t!.id} order by type`

    expect(mitades).toHaveLength(2)
    expect(mitades[0]).toMatchObject({ type: 'transfer_in', bank_account_id: cuentaA2 })
    expect(mitades[1]).toMatchObject({ type: 'transfer_out', bank_account_id: cuentaA1 })
  })

  it('los dos saldos se mueven en direcciones contrarias por el mismo monto', async () => {
    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ origen: string; destino: string }[]>`
        select public.bank_account_balance(${cuentaA1})::text as origen,
               public.bank_account_balance(${cuentaA2})::text as destino`,
    )
    expect(Number(r!.origen)).toBe(54000) // 62000 - 8000
    expect(Number(r!.destino)).toBe(18000) // 10000 + 8000
  })

  it('no se puede transferir de una cuenta a si misma', async () => {
    await expect(
      sql`
        insert into public.bank_transfers
          (tenant_id, from_account_id, to_account_id, amount)
        values (${tenantA}, ${cuentaA1}, ${cuentaA1}, 1000)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})

describe('Un movimiento registrado es inmutable', () => {
  it('no se puede editar el monto de un movimiento', async () => {
    await expect(
      sql`
        update public.bank_transactions set amount = 1
        where bank_account_id = ${cuentaA1} and type = 'deposit'`,
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('no se puede borrar un movimiento', async () => {
    await expect(
      sql`delete from public.bank_transactions where bank_account_id = ${cuentaA1}`,
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('no se puede borrar una transferencia y dejar sus mitades huerfanas', async () => {
    await expect(
      sql`delete from public.bank_transfers where tenant_id = ${tenantA}`,
    ).rejects.toThrow(/no se edita ni se borra/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantA, 'treasury', true))

  it('sin el modulo, cuentas y movimientos dan cero filas', async () => {
    await modulo(tenantA, 'treasury', false)
    const [cuentas, movimientos] = await as(userA, tenantA, async (tx) => {
      const c = await tx<{ id: string }[]>`select id from public.bank_accounts`
      const m = await tx<{ id: string }[]>`select id from public.bank_transactions`
      return [c, m] as const
    })
    expect(cuentas).toHaveLength(0)
    expect(movimientos).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un monto de cero o negativo se rechaza', async () => {
    await expect(
      sql`
        insert into public.bank_transactions
          (tenant_id, bank_account_id, type, amount, description)
        values (${tenantA}, ${cuentaA1}, 'deposit', 0, 'Nada')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un tipo de movimiento inventado se rechaza', async () => {
    await expect(
      sql`
        insert into public.bank_transactions
          (tenant_id, bank_account_id, type, amount, description)
        values (${tenantA}, ${cuentaA1}, 'criptomoneda', 100, 'Nope')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('la misma cuenta no se puede registrar dos veces en el mismo banco', async () => {
    await expect(
      sql`
        insert into public.bank_accounts
          (tenant_id, bank_name, account_name, account_number)
        values (${tenantA}, 'Banco Popular', 'Duplicada', ${`001-${RUN}`})`,
    ).rejects.toThrow(/duplicate key/)
  })
})
