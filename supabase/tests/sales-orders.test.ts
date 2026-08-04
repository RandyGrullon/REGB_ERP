import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Pedidos (S20) contra Postgres real.
 *
 * Era el ultimo modulo de F4 sin prueba de aislamiento. Cubre tres cosas
 * que no se pueden comprobar sin base de datos:
 *
 *  1. Que un cliente no vea ni toque los pedidos del vecino.
 *  2. Que `public.customers` sea de verdad una tabla CORE — visible con
 *     pedidos apagado mientras quede caja o cobros. Es una decision de
 *     diseno deliberada (0020) y sin una prueba, el primero que "limpie"
 *     las politicas la borra sin enterarse.
 *  3. Que la numeracion no repita NI deje huecos, ni con ocho cajeros a la
 *     vez ni cuando una transaccion aborta.
 *
 * `max: 8` no es decorativo: el caso de concurrencia lanza ocho peticiones
 * simultaneas y cada una necesita su conexion.
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
let clienteA: string
let clienteB: string
let pedidoA: string
let pedidoB: string

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

/** Enciende o apaga un modulo para un tenant. */
async function modulo(tenant: string, id: string, encendido: boolean) {
  await sql`
    update regb.tenant_modules set enabled = ${encendido}
    where tenant_id = ${tenant} and module_id = ${id}`
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`so-a-${RUN}`}, 'Ferreteria Pedidos SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`so-b-${RUN}`}, 'Distribuidora Pedidos SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'inventory', 'active', true),
             (${t}, 'sales-orders', 'active', true), (${t}, 'pos', 'active', true),
             (${t}, 'ar', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name, price, cost)
    values (${tenantA}, ${`SO-A-${RUN}`}, 'Cemento gris', 465, 380) returning id`
  productoA = pa!.id

  const [wa] = await sql`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${tenantA}, 'Principal A', 'SA1', true) returning id`
  const [wb] = await sql`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${tenantB}, 'Principal B', 'SB1', true) returning id`
  almacenA = wa!.id
  almacenB = wb!.id

  const [ca] = await sql`
    insert into public.customers (tenant_id, name, payment_terms)
    values (${tenantA}, 'Constructora A', 30) returning id`
  const [cb] = await sql`
    insert into public.customers (tenant_id, name, payment_terms)
    values (${tenantB}, 'Constructora B', 15) returning id`
  clienteA = ca!.id
  clienteB = cb!.id

  const [oa] = await sql`
    insert into public.sales_orders (tenant_id, number, customer_id, warehouse_id)
    values (${tenantA}, ${`PV-TEST-A-${RUN}`}, ${clienteA}, ${almacenA}) returning id`
  const [ob] = await sql`
    insert into public.sales_orders (tenant_id, number, customer_id, warehouse_id)
    values (${tenantB}, ${`PV-TEST-B-${RUN}`}, ${clienteB}, ${almacenB}) returning id`
  pedidoA = oa!.id
  pedidoB = ob!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.sales_order_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.sales_orders where tenant_id in ${sql(ts)}`
  // Facil de olvidar: no cuelga de sales_orders y contamina la corrida
  // siguiente con una numeracion que arranca a medias.
  await sql`delete from public.sales_order_counters where tenant_id in ${sql(ts)}`
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from public.inventory_movements where tenant_id in ${sql(ts)}`
  await sql`delete from public.stock_levels where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('B no ve los pedidos de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.sales_orders where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede modificar un pedido de A', async () => {
    // No lanza: la RLS lo hace invisible y afecta cero filas. Que "no
    // falle" es justo lo peligroso, asi que se afirma el conteo.
    const afectadas = await as(userB, tenantB, async (tx) => {
      const r = await tx`update public.sales_orders set notes = 'ajeno' where id = ${pedidoA}`
      return r.count
    })
    expect(afectadas).toBe(0)

    const [tras] = await sql<{ notes: string | null }[]>`
      select notes from public.sales_orders where id = ${pedidoA}`
    expect(tras!.notes).toBeNull()
  })

  it('B no puede crear un pedido a nombre de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.sales_orders (tenant_id, number, customer_id, warehouse_id)
          values (${tenantA}, ${`ROBADO-${RUN}`}, ${clienteA}, ${almacenA})`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('B no puede colar una linea en un pedido de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.sales_order_lines
            (order_id, tenant_id, product_id, qty_ordered, unit_price)
          values (${pedidoA}, ${tenantA}, ${productoA}, 1, 100)`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('B no ve el contador de numeracion de A', async () => {
    await sql`
      insert into public.sales_order_counters (tenant_id, year, last_n)
      values (${tenantA}, ${new Date().getFullYear()}, 7)
      on conflict (tenant_id, year) do update set last_n = 7`

    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ last_n: number }[]>`
        select last_n from public.sales_order_counters where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('el pedido de B existe y es suyo: aislar no puede romper lo propio', async () => {
    // Sin esta contraparte, una politica que niegue TODO pasaria el bloque.
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.sales_orders`,
    )
    expect(filas.map((f) => f.id)).toEqual([pedidoB])
  })
})

describe('customers es una tabla CORE', () => {
  // Las politicas de `customers` (sales-orders, pos, ar) son permisivas y
  // se combinan con OR. Esa es la decision que este bloque defiende.
  afterAll(async () => {
    for (const m of ['sales-orders', 'pos', 'ar']) await modulo(tenantA, m, true)
  })

  it('con pedidos apagado pero caja encendida, los clientes siguen visibles', async () => {
    await modulo(tenantA, 'sales-orders', false)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.customers`,
    )
    expect(filas.length).toBeGreaterThan(0)
  })

  it('con solo caja encendida tambien se puede dar de alta un cliente', async () => {
    await modulo(tenantA, 'ar', false)
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.customers (tenant_id, name) values (${tenantA}, 'De mostrador')`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ name: string }[]>`
        select name from public.customers where name = 'De mostrador'`,
    )
    expect(filas).toHaveLength(1)
  })

  it('con solo cobros encendido los clientes siguen visibles', async () => {
    await modulo(tenantA, 'pos', false)
    await modulo(tenantA, 'ar', true)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.customers`,
    )
    expect(filas.length).toBeGreaterThan(0)
  })

  it('apagados los tres, los clientes SI desaparecen', async () => {
    // La mitad que le da valor a las tres anteriores: `customers` es core
    // respecto de tres modulos concretos, no una tabla sin puerta.
    await modulo(tenantA, 'ar', false)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.customers`,
    )
    expect(filas).toHaveLength(0)
  })

  it('al reencender siguen ahi: apagar no borra', async () => {
    await modulo(tenantA, 'sales-orders', true)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.customers`,
    )
    expect(filas.length).toBeGreaterThan(0)
  })
})

describe('Modulo de pedidos apagado', () => {
  afterAll(async () => await modulo(tenantA, 'sales-orders', true))

  it('sin el modulo, pedidos y lineas dan cero filas', async () => {
    await modulo(tenantA, 'sales-orders', false)
    const [pedidos, lineas] = await as(userA, tenantA, async (tx) => {
      const p = await tx<{ id: string }[]>`select id from public.sales_orders`
      const l = await tx<{ id: string }[]>`select id from public.sales_order_lines`
      return [p, l] as const
    })
    expect(pedidos).toHaveLength(0)
    expect(lineas).toHaveLength(0)
  })

  it('sin el modulo no se puede crear un pedido', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.sales_orders (tenant_id, number, customer_id, warehouse_id)
          values (${tenantA}, ${`APAGADO-${RUN}`}, ${clienteA}, ${almacenA})`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('sin el modulo, el numerador tampoco entrega numeros', async () => {
    // Un contador que avanza con el modulo apagado quema numeracion que no
    // se puede usar, y al reencender la serie arranca con huecos que nadie
    // sabe explicar. La guarda vive en la funcion porque `security definer`
    // elude la RLS por definicion (0031).
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx<{ next_sales_order_number: string }[]>`
          select public.next_sales_order_number(${tenantA})`,
      ),
    ).rejects.toThrow(/no esta activo/)
  })

  it('al reencenderlo los pedidos siguen ahi', async () => {
    await modulo(tenantA, 'sales-orders', true)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.sales_orders`,
    )
    expect(filas.length).toBeGreaterThan(0)
  })
})

describe('Numeracion', () => {
  it('el primer pedido del ano lleva el formato PV-ANO-00001', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ next_sales_order_number: string }[]>`
        select public.next_sales_order_number(${tenantB})`,
    )
    expect(r!.next_sales_order_number).toMatch(/^PV-\d{4}-00001$/)
  })

  it('ocho cajeros a la vez: sin repetidos y SIN HUECOS', async () => {
    // "Sin huecos" es la mitad del requisito y la que se olvida: un Set de
    // tamano 8 pasaria igual con 1,2,3,5,6,7,8,9.
    const salida = (
      await Promise.all(
        Array.from({ length: 8 }, () =>
          as(
            userB,
            tenantB,
            (tx) => tx<{ next_sales_order_number: string }[]>`
              select public.next_sales_order_number(${tenantB})`,
          ),
        ),
      )
    ).map((r) => r[0]!.next_sales_order_number)

    expect(new Set(salida).size).toBe(8)
    expect(salida.map((n) => Number(n.slice(-5))).sort((a, b) => a - b)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ])
  })

  it('una transaccion abortada no deja hueco en la serie', async () => {
    // Esto es lo que distingue un contador en tabla de una `sequence`, que
    // si dejaria el hueco. Sin este caso nadie nota si alguien lo
    // "optimiza" a serial.
    const [antes] = await sql<{ last_n: number }[]>`
      select last_n from public.sales_order_counters
      where tenant_id = ${tenantB} and year = ${new Date().getFullYear()}`

    await expect(
      as(userB, tenantB, async (tx) => {
        await tx`select public.next_sales_order_number(${tenantB})`
        throw new Error('abortar a proposito')
      }),
    ).rejects.toThrow(/abortar/)

    const [despues] = await sql<{ last_n: number }[]>`
      select last_n from public.sales_order_counters
      where tenant_id = ${tenantB} and year = ${new Date().getFullYear()}`
    expect(despues!.last_n).toBe(antes!.last_n)
  })

  it('cada cliente tiene su propia serie', async () => {
    const [ra] = await as(
      userA,
      tenantA,
      (tx) => tx<{ next_sales_order_number: string }[]>`
        select public.next_sales_order_number(${tenantA})`,
    )
    // A tenia el contador en 7 por el test de aislamiento: su serie va por
    // el 8 mientras B ya paso del 9. Independientes, como manda la PK.
    expect(ra!.next_sales_order_number).toMatch(/^PV-\d{4}-00008$/)
  })

  it('B no puede consumir la numeracion de A', async () => {
    // Mismo agujero que 0030 tapo en assign_ncf: security definer con el
    // tenant por parametro y sin contrastarlo. Lo cerro la 0031.
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx<{ next_sales_order_number: string }[]>`
          select public.next_sales_order_number(${tenantA})`,
      ),
    ).rejects.toThrow(/otro cliente/)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un estado inventado se rechaza', async () => {
    await expect(
      sql`update public.sales_orders set status = 'inventado' where id = ${pedidoA}`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('pedir cero unidades no tiene sentido', async () => {
    await expect(
      sql`
        insert into public.sales_order_lines
          (order_id, tenant_id, product_id, qty_ordered, unit_price)
        values (${pedidoA}, ${tenantA}, ${productoA}, 0, 100)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('no se puede entregar mas de lo pedido', async () => {
    await expect(
      sql`
        insert into public.sales_order_lines
          (order_id, tenant_id, product_id, qty_ordered, qty_delivered, unit_price)
        values (${pedidoA}, ${tenantA}, ${productoA}, 5, 6, 100)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('la tasa de impuesto es FRACCION, no porcentaje', async () => {
    // `tax_rate` es numeric(5,4): un 18 revienta por desbordamiento ANTES
    // de llegar al check. Con 1.5 si se llega al constraint, que es lo que
    // se quiere probar aqui.
    await expect(
      sql`
        insert into public.sales_order_lines
          (order_id, tenant_id, product_id, qty_ordered, unit_price, tax_rate)
        values (${pedidoA}, ${tenantA}, ${productoA}, 1, 100, 1.5)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el numero de pedido no se repite dentro del mismo cliente', async () => {
    await expect(
      sql`
        insert into public.sales_orders (tenant_id, number, customer_id, warehouse_id)
        values (${tenantA}, ${`PV-TEST-A-${RUN}`}, ${clienteA}, ${almacenA})`,
    ).rejects.toThrow(/duplicate key/)
  })
})
