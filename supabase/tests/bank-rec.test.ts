import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Conciliacion bancaria (modulo 20, F6) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un import ni una linea -ni un emparejamiento- en
 *     una cuenta de A usando su PROPIO tenant_id. Mismo patron que 0040,
 *     0041 y 0044 ya taparon en otras tablas.
 *  3. Un movimiento solo se puede conciliar con UNA linea, nunca con dos
 *     -impuesto por el indice unico parcial, no solo por la aplicacion-.
 *  4. match_statement_line()/unmatch_statement_line() validan que la
 *     linea y el movimiento sean de la MISMA cuenta bancaria.
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
let importA: string
let movA1: string
let movA2: string

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
    values (${`br-a-${RUN}`}, 'Ferreteria BR A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`br-b-${RUN}`}, 'Distribuidora BR B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'treasury', 'active', true), (${t}, 'bank-rec', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [a1] = await sql`
    insert into public.bank_accounts (tenant_id, bank_name, account_name, account_number, opening_balance)
    values (${tenantA}, 'Banco Popular', 'Operativa', ${`br1-${RUN}`}, 50000) returning id`
  const [a2] = await sql`
    insert into public.bank_accounts (tenant_id, bank_name, account_name, account_number, opening_balance)
    values (${tenantA}, 'Banreservas', 'Reserva', ${`br2-${RUN}`}, 10000) returning id`
  const [b1] = await sql`
    insert into public.bank_accounts (tenant_id, bank_name, account_name, account_number, opening_balance)
    values (${tenantB}, 'Banco BHD', 'Unica', ${`br3-${RUN}`}, 7000) returning id`
  cuentaA1 = a1!.id
  cuentaA2 = a2!.id
  cuentaB1 = b1!.id

  const [m1] = await sql`
    insert into public.bank_transactions (tenant_id, bank_account_id, type, amount, description)
    values (${tenantA}, ${cuentaA1}, 'deposit', 5000, 'Deposito de prueba') returning id`
  const [m2] = await sql`
    insert into public.bank_transactions (tenant_id, bank_account_id, type, amount, description)
    values (${tenantA}, ${cuentaA2}, 'deposit', 3000, 'Deposito en la otra cuenta') returning id`
  movA1 = m1!.id
  movA2 = m2!.id

  const [imp] = await sql`
    insert into public.bank_statement_imports
      (tenant_id, bank_account_id, period_start, period_end, statement_balance)
    values (${tenantA}, ${cuentaA1}, current_date - 30, current_date, 55000) returning id`
  importA = imp!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.bank_statement_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.bank_statement_imports where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.bank_transactions disable trigger no_editar_movimiento')
  await sql`delete from public.bank_transactions where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.bank_transactions enable trigger no_editar_movimiento')
  await sql`delete from public.bank_accounts where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('B no ve los imports de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.bank_statement_imports where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un import en una cuenta de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.bank_statement_imports
            (tenant_id, bank_account_id, period_start, period_end, statement_balance)
          values (${tenantB}, ${cuentaA1}, current_date - 10, current_date, 1000)`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('B no puede colar una linea en un import de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.bank_statement_lines
            (tenant_id, import_id, bank_account_id, line_date, description, amount)
          values (${tenantB}, ${importA}, ${cuentaA1}, current_date, 'Ajena', 500)`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('aislar no le rompe lo propio: B importa y concilia normalmente contra su propia cuenta', async () => {
    const [importB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.bank_statement_imports
          (tenant_id, bank_account_id, period_start, period_end, statement_balance)
        values (${tenantB}, ${cuentaB1}, current_date - 10, current_date, 7000)
        returning id`,
    )
    expect(importB?.id).toBeTruthy()

    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.bank_statement_imports`,
    )
    expect(filas.map((f) => f.id)).toEqual([importB!.id])
  })
})

describe('Una linea debe ser de la misma cuenta que su import', () => {
  it('rechaza una linea que declara otra cuenta bancaria', async () => {
    await expect(
      sql`
        insert into public.bank_statement_lines
          (tenant_id, import_id, bank_account_id, line_date, description, amount)
        values (${tenantA}, ${importA}, ${cuentaA2}, current_date, 'Cuenta cruzada', 500)`,
    ).rejects.toThrow(/no es de la misma cuenta bancaria/)
  })
})

describe('Conciliar una linea', () => {
  let linea: string

  beforeAll(async () => {
    const [l] = await sql`
      insert into public.bank_statement_lines
        (tenant_id, import_id, bank_account_id, line_date, description, amount)
      values (${tenantA}, ${importA}, ${cuentaA1}, current_date, 'Deposito de prueba', 5000)
      returning id`
    linea = l!.id
  })

  it('B no puede conciliar una linea de A aunque sepa los dos ids', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`select public.match_statement_line(${linea}, ${movA1})`),
    ).rejects.toThrow(/no es de este cliente/)
  })

  it('rechaza conciliar contra un movimiento de OTRA cuenta bancaria', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`select public.match_statement_line(${linea}, ${movA2})`),
    ).rejects.toThrow(/otra cuenta bancaria/)
  })

  it('concilia correctamente contra el movimiento de la MISMA cuenta', async () => {
    await as(userA, tenantA, (tx) => tx`select public.match_statement_line(${linea}, ${movA1})`)
    const [l] = await sql<{ match_status: string; matched_transaction_id: string }[]>`
      select match_status, matched_transaction_id from public.bank_statement_lines where id = ${linea}`
    expect(l).toMatchObject({ match_status: 'matched', matched_transaction_id: movA1 })
  })

  it('un movimiento ya conciliado no se puede conciliar dos veces: el indice unico lo bloquea', async () => {
    const [otra] = await sql`
      insert into public.bank_statement_lines
        (tenant_id, import_id, bank_account_id, line_date, description, amount)
      values (${tenantA}, ${importA}, ${cuentaA1}, current_date, 'Otra linea, mismo monto', 5000)
      returning id`
    await expect(
      as(userA, tenantA, (tx) => tx`select public.match_statement_line(${otra!.id}, ${movA1})`),
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })

  it('desconciliar deja la linea libre otra vez', async () => {
    await as(userA, tenantA, (tx) => tx`select public.unmatch_statement_line(${linea})`)
    const [l] = await sql<{ match_status: string; matched_transaction_id: string | null }[]>`
      select match_status, matched_transaction_id from public.bank_statement_lines where id = ${linea}`
    expect(l).toMatchObject({ match_status: 'pending', matched_transaction_id: null })
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantA, 'bank-rec', true))

  it('sin el modulo, imports y lineas dan cero filas', async () => {
    await modulo(tenantA, 'bank-rec', false)
    const [imports, lineas] = await as(userA, tenantA, async (tx) => {
      const i = await tx<{ id: string }[]>`select id from public.bank_statement_imports`
      const l = await tx<{ id: string }[]>`select id from public.bank_statement_lines`
      return [i, l] as const
    })
    expect(imports).toHaveLength(0)
    expect(lineas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una linea con monto cero se rechaza', async () => {
    await expect(
      sql`
        insert into public.bank_statement_lines
          (tenant_id, import_id, bank_account_id, line_date, description, amount)
        values (${tenantA}, ${importA}, ${cuentaA1}, current_date, 'Sin monto', 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un estado con periodo invertido se rechaza', async () => {
    await expect(
      sql`
        insert into public.bank_statement_imports
          (tenant_id, bank_account_id, period_start, period_end, statement_balance)
        values (${tenantA}, ${cuentaA1}, current_date, current_date - 5, 1000)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
