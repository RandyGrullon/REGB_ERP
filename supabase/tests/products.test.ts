/**
 * Catalogo de productos (S18) contra Postgres real.
 *
 * La aritmetica de precios se prueba sin base en @regb/operations. Aqui va
 * lo que solo el motor garantiza: aislamiento entre clientes, unicidad del
 * codigo de barras y que un modulo apagado deje de devolver datos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string

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

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`prod-a-${RUN}`}, 'Colmado Test SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`prod-b-${RUN}`}, 'Ferreteria Test SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  await sql`
    insert into public.products (tenant_id, sku, name, price, barcode)
    values (${tenantA}, 'A-001', 'Arroz del tenant A', 215, '7460000000001'),
           (${tenantB}, 'B-001', 'Cemento del tenant B', 465, '7460000000002')`
})

afterAll(async () => {
  await sql`delete from public.products where tenant_id in (${tenantA}, ${tenantB})`
  await sql`delete from public.product_categories where tenant_id in (${tenantA}, ${tenantB})`
  await sql`delete from audit.log where tenant_id in (${tenantA}, ${tenantB})`
  await sql`delete from regb.tenants where id in (${tenantA}, ${tenantB})`
  await sql.end()
})

describe('Aislamiento del catalogo', () => {
  it('un cliente solo ve sus productos', async () => {
    const rows = await as(
      userA,
      tenantA,
      (tx) => tx<{ sku: string }[]>`
      select sku from public.products`,
    )
    expect(rows.map((r) => r.sku)).toEqual(['A-001'])
  })

  it('no puede leer los del vecino ni apuntando a su tenant_id', async () => {
    const rows = await as(
      userA,
      tenantA,
      (tx) => tx<{ sku: string }[]>`
      select sku from public.products where tenant_id = ${tenantB}`,
    )
    expect(rows).toHaveLength(0)
  })

  it('no puede insertar productos en otro cliente', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
        insert into public.products (tenant_id, sku, name, price)
        values (${tenantB}, 'ROBADO', 'Intento de invasion', 1)`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('las categorias tambien estan aisladas', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
      insert into public.product_categories (tenant_id, name) values (${tenantA}, 'Viveres A')`,
    )
    const desdeB = await as(
      userB,
      tenantB,
      (tx) => tx<{ name: string }[]>`
      select name from public.product_categories`,
    )
    expect(desdeB).toHaveLength(0)
  })
})

describe('Unicidad', () => {
  it('el codigo del producto no se repite dentro del mismo cliente', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
        insert into public.products (tenant_id, sku, name, price)
        values (${tenantA}, 'A-001', 'Duplicado', 10)`,
      ),
    ).rejects.toThrow(/duplicate key/)
  })

  it('DOS clientes distintos SI pueden usar el mismo codigo', async () => {
    // Cada negocio numera su catalogo como quiere.
    await as(
      userB,
      tenantB,
      (tx) => tx`
      insert into public.products (tenant_id, sku, name, price)
      values (${tenantB}, 'A-001', 'Mismo codigo, otro negocio', 99)`,
    )
    const rows = await as(
      userB,
      tenantB,
      (tx) => tx<{ sku: string }[]>`
      select sku from public.products where sku = 'A-001'`,
    )
    expect(rows).toHaveLength(1)
  })

  it('el codigo de barras no se repite: el lector debe saber que cobrar', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
        insert into public.products (tenant_id, sku, name, price, barcode)
        values (${tenantA}, 'A-002', 'Otro producto', 10, '7460000000001')`,
      ),
    ).rejects.toThrow(/duplicate key/)
  })

  it('pero varios productos pueden ir SIN codigo de barras', async () => {
    // El indice unico es parcial; si no lo fuera, el segundo sin codigo fallaria.
    await as(
      userA,
      tenantA,
      (tx) => tx`
      insert into public.products (tenant_id, sku, name, price)
      values (${tenantA}, 'A-003', 'Sin barras uno', 10),
             (${tenantA}, 'A-004', 'Sin barras dos', 20)`,
    )
    const rows = await as(
      userA,
      tenantA,
      (tx) => tx<{ c: string }[]>`
      select count(*) as c from public.products where barcode is null`,
    )
    expect(Number(rows[0]!.c)).toBeGreaterThanOrEqual(2)
  })
})

describe('Impuesto por producto', () => {
  it('por defecto lleva ITBIS del 18%', async () => {
    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ tax_rate: string }[]>`
      select tax_rate::text from public.products where sku = 'A-003'`,
    )
    expect(Number(r!.tax_rate)).toBe(0.18)
  })

  it('acepta exentos, que en RD son media canasta basica', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
      insert into public.products (tenant_id, sku, name, price, tax_rate)
      values (${tenantA}, 'A-005', 'Platano exento', 25, 0)`,
    )
    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ tax_rate: string }[]>`
      select tax_rate::text from public.products where sku = 'A-005'`,
    )
    expect(Number(r!.tax_rate)).toBe(0)
  })

  it('rechaza una tasa fuera de rango', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
        insert into public.products (tenant_id, sku, name, price, tax_rate)
        values (${tenantA}, 'A-006', 'Tasa absurda', 10, 1.5)`,
      ),
    ).rejects.toThrow(/violates check constraint/)
  })
})

describe('Modulo apagado', () => {
  it('sin el modulo activo el catalogo devuelve cero filas, no un error raro', async () => {
    await sql`
      update regb.tenant_modules set enabled = false
      where tenant_id = ${tenantA} and module_id = 'products'`

    const rows = await as(
      userA,
      tenantA,
      (tx) => tx<{ sku: string }[]>`
      select sku from public.products`,
    )
    expect(rows).toHaveLength(0)

    await sql`
      update regb.tenant_modules set enabled = true
      where tenant_id = ${tenantA} and module_id = 'products'`
  })
})

describe('Bitacora', () => {
  it('crear un producto queda registrado con su modulo', async () => {
    const [r] = await sql<{ c: string }[]>`
      select count(*) as c from audit.log
      where tenant_id = ${tenantA} and entity = 'products' and action = 'create'`
    expect(Number(r!.c)).toBeGreaterThan(0)
  })
})
