import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Conteos ciclicos (modulo 51, F8) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una programacion, un conteo o una linea con
 *     referencias de A usando su PROPIO tenant_id. Mismo patron que
 *     0031-0067.
 *  3. Las lineas solo se editan mientras el conteo sigue en
 *     'counting'; el encabezado es inmutable una vez aprobado o
 *     rechazado.
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
    values (${`sc-a-${RUN}`}, 'Ferreteria SC A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`sc-b-${RUN}`}, 'Distribuidora SC B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'inventory', 'active', true), (${t}, 'stock-counts', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [wa] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantA}, 'Central A') returning id`
  const [wb] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantB}, 'Central B') returning id`
  almacenA = wa!.id
  almacenB = wb!.id

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`SKU-A-${RUN}`}, 'Cemento') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`SKU-B-${RUN}`}, 'Varilla') returning id`
  productoA = pa!.id
  productoB = pb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.cycle_count_lines disable trigger no_editar_linea_conteo_no_editable')
  await sql.unsafe('alter table public.cycle_counts disable trigger no_editar_conteo_resuelto')
  await sql`delete from public.cycle_count_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.cycle_counts where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.cycle_count_lines enable trigger no_editar_linea_conteo_no_editable')
  await sql.unsafe('alter table public.cycle_counts enable trigger no_editar_conteo_resuelto')
  await sql`delete from public.count_schedules where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A programa el conteo de su propio producto normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.count_schedules (tenant_id, product_id, abc_class, frequency_days)
        values (${tenantA}, ${productoA}, 'A', 30)`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ product_id: string }[]>`select product_id from public.count_schedules`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la programacion de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ product_id: string }[]>`
        select product_id from public.count_schedules where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una programacion con el producto de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.count_schedules (tenant_id, product_id, abc_class, frequency_days)
          values (${tenantB}, ${productoA}, 'B', 90)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un conteo con el almacen de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.cycle_counts (tenant_id, warehouse_id)
          values (${tenantB}, ${almacenA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una linea con el conteo o el producto de A usando su PROPIO tenant_id', async () => {
    const [conteoA] = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`
        insert into public.cycle_counts (tenant_id, warehouse_id) values (${tenantA}, ${almacenA}) returning id`,
    )
    const [conteoB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.cycle_counts (tenant_id, warehouse_id) values (${tenantB}, ${almacenB}) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.cycle_count_lines (count_id, tenant_id, product_id, system_qty)
          values (${conteoA!.id}, ${tenantB}, ${productoB}, 10)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.cycle_count_lines (count_id, tenant_id, product_id, system_qty)
          values (${conteoB!.id}, ${tenantB}, ${productoA}, 10)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Las lineas solo se editan mientras el conteo sigue counting; aprobado es terminal', () => {
  let conteo: string
  let linea: string

  it('se cuenta normalmente mientras esta en counting', async () => {
    const [c] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.cycle_counts (tenant_id, warehouse_id) values (${tenantB}, ${almacenB}) returning id`,
    )
    conteo = c!.id
    const [l] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.cycle_count_lines (count_id, tenant_id, product_id, system_qty)
        values (${conteo}, ${tenantB}, ${productoB}, 50) returning id`,
    )
    linea = l!.id

    await as(
      userB,
      tenantB,
      (tx) => tx`update public.cycle_count_lines set counted_qty = 47 where id = ${linea}`,
    )
    const [row] = await sql`select counted_qty::text from public.cycle_count_lines where id = ${linea}`
    expect(row!.counted_qty).toBe('47.000')
  })

  it('al pedir aprobacion, la linea ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        update public.cycle_counts set status = 'pending_approval', submitted_at = now() where id = ${conteo}`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.cycle_count_lines set counted_qty = 50 where id = ${linea}`,
      ),
    ).rejects.toThrow(/ya no admite cambios/)
  })

  it('se aprueba, y el encabezado ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        update public.cycle_counts set status = 'approved', approved_at = now() where id = ${conteo}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.cycle_counts set notes = 'x' where id = ${conteo}`),
    ).rejects.toThrow(/ya fue resuelto/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'stock-counts', true))

  it('sin el modulo, los conteos dan cero filas', async () => {
    await modulo(tenantB, 'stock-counts', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.cycle_counts`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una clase ABC inventada se rechaza', async () => {
    await expect(
      sql`
        insert into public.count_schedules (tenant_id, product_id, abc_class, frequency_days)
        values (${tenantA}, ${productoA}, 'D', 30)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un estado de conteo inventado se rechaza', async () => {
    await expect(
      sql`
        insert into public.cycle_counts (tenant_id, warehouse_id, status)
        values (${tenantA}, ${almacenA}, 'en_revision')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo producto no se repite dos veces en el mismo conteo', async () => {
    const [c] = await sql`
      insert into public.cycle_counts (tenant_id, warehouse_id) values (${tenantA}, ${almacenA}) returning id`
    await sql`
      insert into public.cycle_count_lines (count_id, tenant_id, product_id, system_qty)
      values (${c!.id}, ${tenantA}, ${productoA}, 10)`
    await expect(
      sql`
        insert into public.cycle_count_lines (count_id, tenant_id, product_id, system_qty)
        values (${c!.id}, ${tenantA}, ${productoA}, 10)`,
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })
})
