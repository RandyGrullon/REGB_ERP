import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Lista de materiales / BOM (modulo 55, F8.5) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un BOM o una linea con referencias de A usando
 *     su PROPIO tenant_id. Mismo patron que 0031-0071.
 *  3. Un BOM en `draft` es editable; fuera de `draft` es inmutable
 *     -corregirlo crea la version siguiente-. Solo una version activa
 *     por producto. Un producto no puede ser componente de su propio BOM.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let productoTerminadoA: string
let componenteA: string
let productoTerminadoB: string
let componenteB: string
let bomA: string

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
    values (${`bm-a-${RUN}`}, 'Fabrica BM A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`bm-b-${RUN}`}, 'Fabrica BM B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'bom', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`SILLA-${RUN}`}, 'Silla') returning id`
  const [ca] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`MADERA-${RUN}`}, 'Madera') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`MESA-${RUN}`}, 'Mesa') returning id`
  const [cb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`TABLA-${RUN}`}, 'Tabla') returning id`
  productoTerminadoA = pa!.id
  componenteA = ca!.id
  productoTerminadoB = pb!.id
  componenteB = cb!.id

  const [ba] = await sql`
    insert into public.bill_of_materials (tenant_id, product_id, version)
    values (${tenantA}, ${productoTerminadoA}, 1) returning id`
  bomA = ba!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.bom_lines disable trigger no_editar_linea_bom_no_borrador')
  await sql.unsafe('alter table public.bill_of_materials disable trigger no_editar_bom_no_borrador')
  await sql`delete from public.bom_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.bill_of_materials where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.bom_lines enable trigger no_editar_linea_bom_no_borrador')
  await sql.unsafe('alter table public.bill_of_materials enable trigger no_editar_bom_no_borrador')
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio BOM normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.bill_of_materials`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve el BOM de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.bill_of_materials where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un BOM con el producto de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.bill_of_materials (tenant_id, product_id, version)
          values (${tenantB}, ${productoTerminadoA}, 1)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una linea con el BOM o el componente de A usando su PROPIO tenant_id', async () => {
    const [bomB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.bill_of_materials (tenant_id, product_id, version)
        values (${tenantB}, ${productoTerminadoB}, 1) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.bom_lines (bom_id, tenant_id, component_product_id, quantity_per_unit)
          values (${bomA}, ${tenantB}, ${componenteB}, 1)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.bom_lines (bom_id, tenant_id, component_product_id, quantity_per_unit)
          values (${bomB!.id}, ${tenantB}, ${componenteA}, 1)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('un producto no puede ser componente de su propio BOM', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.bom_lines (bom_id, tenant_id, component_product_id, quantity_per_unit)
          values (${bomA}, ${tenantA}, ${productoTerminadoA}, 1)`,
      ),
    ).rejects.toThrow(/no puede ser componente de su propio BOM/)
  })
})

describe('Un BOM en draft es editable; fuera de draft es inmutable; solo una version activa', () => {
  let linea: string

  it('se agrega una linea mientras el BOM sigue en draft, editable', async () => {
    const [l] = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`
        insert into public.bom_lines (bom_id, tenant_id, component_product_id, quantity_per_unit)
        values (${bomA}, ${tenantA}, ${componenteA}, 4) returning id`,
    )
    linea = l!.id
    await as(
      userA,
      tenantA,
      (tx) => tx`update public.bom_lines set quantity_per_unit = 6 where id = ${linea}`,
    )
    const [row] = await sql`select quantity_per_unit::text from public.bom_lines where id = ${linea}`
    expect(row!.quantity_per_unit).toBe('6.0000')
  })

  it('al activar el BOM, ni el encabezado ni sus lineas se pueden editar', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`update public.bill_of_materials set status = 'active' where id = ${bomA}`,
    )
    await expect(
      as(userA, tenantA, (tx) => tx`update public.bill_of_materials set notes = 'x' where id = ${bomA}`),
    ).rejects.toThrow(/crea una version nueva/)
    await expect(
      as(userA, tenantA, (tx) => tx`update public.bom_lines set quantity_per_unit = 1 where id = ${linea}`),
    ).rejects.toThrow(/sus lineas no se editan/)
  })

  it('no puede haber dos versiones activas del mismo producto', async () => {
    const [v2] = await sql`
      insert into public.bill_of_materials (tenant_id, product_id, version)
      values (${tenantA}, ${productoTerminadoA}, 2) returning id`
    await expect(
      sql`update public.bill_of_materials set status = 'active' where id = ${v2!.id}`,
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'bom', true))

  it('sin el modulo, los BOM dan cero filas', async () => {
    await modulo(tenantB, 'bom', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.bill_of_materials`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un estado de BOM inventado se rechaza', async () => {
    await expect(
      sql`insert into public.bill_of_materials (tenant_id, product_id, version, status)
        values (${tenantB}, ${productoTerminadoB}, 99, 'en_revision')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('la misma version no se repite para el mismo producto', async () => {
    await expect(
      sql`insert into public.bill_of_materials (tenant_id, product_id, version)
        values (${tenantA}, ${productoTerminadoA}, 1)`,
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })
})
