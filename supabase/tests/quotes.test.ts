import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Cotizaciones (modulo 31, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una cotizacion con el cliente de A, ni una
 *     linea con la cotizacion o el producto de A, usando su PROPIO
 *     tenant_id. Mismo patron que 0031-0079.
 *  3. En draft el contenido es editable; fuera de draft se congela.
 *     Las lineas son editables solo mientras la cotizacion es draft.
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
let productoA: string
let productoB: string
let cotizacionA: string

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
    values (${`qt-a-${RUN}`}, 'Ventas QT A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`qt-b-${RUN}`}, 'Ventas QT B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'quotes', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ca] = await sql`
    insert into public.customers (tenant_id, name, payment_terms) values (${tenantA}, 'Cliente A', 30) returning id`
  const [cb] = await sql`
    insert into public.customers (tenant_id, name, payment_terms) values (${tenantB}, 'Cliente B', 30) returning id`
  clienteA = ca!.id
  clienteB = cb!.id

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`QT-A-${RUN}`}, 'Producto A') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`QT-B-${RUN}`}, 'Producto B') returning id`
  productoA = pa!.id
  productoB = pb!.id

  const [qa] = await sql`
    insert into public.quotes (tenant_id, quote_number, customer_id) values (${tenantA}, 'COT-0001', ${clienteA}) returning id`
  cotizacionA = qa!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.quote_lines disable trigger no_editar_linea_cotizacion')
  await sql`delete from public.quote_lines where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.quote_lines enable trigger no_editar_linea_cotizacion')
  await sql.unsafe('alter table public.quotes disable trigger no_editar_cotizacion_no_borrador')
  await sql`delete from public.quotes where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.quotes enable trigger no_editar_cotizacion_no_borrador')
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia cotizacion normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.quotes`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve la cotizacion de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.quotes where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una cotizacion con el cliente de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`insert into public.quotes (tenant_id, quote_number, customer_id) values (${tenantB}, 'X', ${clienteA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una linea con la cotizacion o el producto de A usando su PROPIO tenant_id', async () => {
    const [cotB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`insert into public.quotes (tenant_id, quote_number) values (${tenantB}, 'COT-B-1') returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.quote_lines (quote_id, tenant_id, product_id, quantity, unit_price, line_total)
          values (${cotizacionA}, ${tenantB}, ${productoB}, 1, 100, 118)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.quote_lines (quote_id, tenant_id, product_id, quantity, unit_price, line_total)
          values (${cotB!.id}, ${tenantB}, ${productoA}, 1, 100, 118)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('En draft el contenido es editable; fuera de draft se congela', () => {
  let cotizacion: string
  let linea: string

  it('en draft, cliente y terminos son editables', async () => {
    const [q] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`insert into public.quotes (tenant_id, quote_number) values (${tenantB}, 'COT-B-2') returning id`,
    )
    cotizacion = q!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.quotes set customer_id = ${clienteB}, terms = 'Neto 30' where id = ${cotizacion}`,
    )
    const [row] = await sql`select customer_id, terms from public.quotes where id = ${cotizacion}`
    expect(row!.customer_id).toBe(clienteB)
    expect(row!.terms).toBe('Neto 30')
  })

  it('una linea se agrega y edita mientras la cotizacion sigue en draft', async () => {
    const [l] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.quote_lines (quote_id, tenant_id, product_id, quantity, unit_price, line_total)
        values (${cotizacion}, ${tenantB}, ${productoB}, 2, 500, 1180) returning id`,
    )
    linea = l!.id
    await as(userB, tenantB, (tx) => tx`update public.quote_lines set quantity = 3 where id = ${linea}`)
    const [row] = await sql`select quantity::text from public.quote_lines where id = ${linea}`
    expect(row!.quantity).toBe('3.0000')
  })

  it('al enviarla, el contenido ya no se puede cambiar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.quotes set status = 'sent', sent_at = now() where id = ${cotizacion}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.quotes set terms = 'Otro' where id = ${cotizacion}`),
    ).rejects.toThrow(/su contenido no se puede cambiar/)
  })

  it('enviada, sus lineas tampoco se pueden cambiar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.quote_lines set quantity = 99 where id = ${linea}`),
    ).rejects.toThrow(/sus lineas no se pueden cambiar/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'quotes', true))

  it('sin el modulo, las cotizaciones dan cero filas', async () => {
    await modulo(tenantB, 'quotes', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.quotes`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un estado inventado se rechaza', async () => {
    await expect(
      sql`insert into public.quotes (tenant_id, quote_number, status) values (${tenantA}, 'X', 'invalido')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una cantidad de linea de cero o negativa se rechaza', async () => {
    await expect(
      sql`insert into public.quote_lines (quote_id, tenant_id, product_id, quantity, unit_price, line_total)
        values (${cotizacionA}, ${tenantA}, ${productoA}, 0, 100, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo numero y version de cotizacion no se repite para el mismo cliente', async () => {
    await expect(
      sql`insert into public.quotes (tenant_id, quote_number) values (${tenantA}, 'COT-0001')`,
    ).rejects.toThrow(/duplicate key/)
  })
})
