import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Lotes, series y vencimientos (modulo 49, F8) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un lote, una existencia por lote o un recall con
 *     referencias de A usando su PROPIO tenant_id. Mismo patron que
 *     0031-0065.
 *  3. Un lote (product_lots) SI se puede editar -es un registro vivo,
 *     no un hecho historico-; un recall cerrado ya no.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let almacenA: string
let almacenB: string
let productoA: string
let productoB: string
let loteA: string

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
    values (${`ls-a-${RUN}`}, 'Farmacia LS A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ls-b-${RUN}`}, 'Distribuidora LS B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'inventory', 'active', true), (${t}, 'lots-serials', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [wa] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantA}, 'Central A') returning id`
  const [wb] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantB}, 'Central B') returning id`
  almacenA = wa!.id
  almacenB = wb!.id

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`SKU-A-${RUN}`}, 'Jarabe') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`SKU-B-${RUN}`}, 'Tableta') returning id`
  productoA = pa!.id
  productoB = pb!.id

  const [la] = await sql`
    insert into public.product_lots (tenant_id, product_id, lot_number, expiry_date)
    values (${tenantA}, ${productoA}, 'L-0001', '2027-01-01') returning id`
  loteA = la!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.product_recalls disable trigger no_editar_recall_cerrado')
  await sql`delete from public.product_recalls where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.product_recalls enable trigger no_editar_recall_cerrado')
  await sql`delete from public.lot_stock where tenant_id in ${sql(ts)}`
  await sql`delete from public.inventory_movements where tenant_id in ${sql(ts)}`
  await sql`delete from public.product_lots where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A registra su propio lote normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.product_lots`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve el lote de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.product_lots where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un lote con el producto de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.product_lots (tenant_id, product_id, lot_number)
          values (${tenantB}, ${productoA}, 'X')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una existencia de lote con el almacen o el lote de A usando su PROPIO tenant_id', async () => {
    const [loteB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.product_lots (tenant_id, product_id, lot_number)
        values (${tenantB}, ${productoB}, 'L-B-0001') returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.lot_stock (tenant_id, warehouse_id, lot_id, qty_on_hand)
          values (${tenantB}, ${almacenA}, ${loteB!.id}, 10)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.lot_stock (tenant_id, warehouse_id, lot_id, qty_on_hand)
          values (${tenantB}, ${almacenB}, ${loteA}, 10)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un recall con el producto o el lote de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.product_recalls (tenant_id, product_id, reason)
          values (${tenantB}, ${productoA}, 'x')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    const [loteB2] = await sql`select id from public.product_lots where tenant_id = ${tenantB} limit 1`
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.product_recalls (tenant_id, product_id, lot_id, reason)
          values (${tenantB}, ${productoB}, ${loteA}, 'x')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
    expect(loteB2).toBeDefined()
  })
})

describe('Un lote es un registro vivo; un recall cerrado es terminal', () => {
  let recall: string

  it('el lote SI se puede editar -corregir una fecha de vencimiento mal capturada, por ejemplo-', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`update public.product_lots set expiry_date = '2027-06-01' where id = ${loteA}`,
    )
    const [row] = await sql`select expiry_date::text from public.product_lots where id = ${loteA}`
    expect(row!.expiry_date).toBe('2027-06-01')
  })

  it('se abre un recall normalmente', async () => {
    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`
        insert into public.product_recalls (tenant_id, product_id, lot_id, reason)
        values (${tenantA}, ${productoA}, ${loteA}, 'Posible contaminacion') returning id`,
    )
    recall = r!.id
    expect(recall).toBeDefined()
  })

  it('mientras esta abierto, se puede editar la razon', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`update public.product_recalls set reason = 'Contaminacion confirmada' where id = ${recall}`,
    )
    const [row] = await sql`select reason from public.product_recalls where id = ${recall}`
    expect(row!.reason).toBe('Contaminacion confirmada')
  })

  it('se cierra, y ya no se puede editar', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`update public.product_recalls set status = 'closed', closed_at = now() where id = ${recall}`,
    )
    await expect(
      as(userA, tenantA, (tx) => tx`update public.product_recalls set reason = 'otro' where id = ${recall}`),
    ).rejects.toThrow(/ya esta cerrado/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'lots-serials', true))

  it('sin el modulo, los lotes dan cero filas', async () => {
    await modulo(tenantB, 'lots-serials', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.product_lots`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('el mismo numero de lote no se repite para el mismo producto', async () => {
    await expect(
      sql`
        insert into public.product_lots (tenant_id, product_id, lot_number)
        values (${tenantA}, ${productoA}, 'L-0001')`,
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })

  it('un estado de recall inventado se rechaza', async () => {
    await expect(
      sql`
        insert into public.product_recalls (tenant_id, product_id, reason, status)
        values (${tenantA}, ${productoA}, 'x', 'en_revision')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una existencia de lote negativa se rechaza', async () => {
    await expect(
      sql`
        insert into public.lot_stock (tenant_id, warehouse_id, lot_id, qty_on_hand)
        values (${tenantA}, ${almacenA}, ${loteA}, -5)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
