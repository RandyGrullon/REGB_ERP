import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Ordenes de compra (modulo 45) contra Postgres real.
 *
 * Mismo trio que sales-orders.test.ts, porque es el mismo riesgo con la
 * flecha al reves — aqui el proveedor le entrega al cliente, no el cliente
 * a su cliente:
 *
 *  1. Que un cliente no vea ni toque las ordenes ni proveedores del vecino.
 *  2. Que apagar el modulo bloquee de verdad, no solo esconda en la UI.
 *  3. Que la numeracion no repita NI deje huecos, y que un tenant no pueda
 *     consumir la serie de otro (el agujero que la 0031 le tuvo que tapar
 *     a sales-orders se escribe bien desde el principio aqui).
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
let proveedorA: string
let proveedorB: string
let ordenA: string
let ordenB: string

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
    values (${`po-a-${RUN}`}, 'Ferreteria Compras SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`po-b-${RUN}`}, 'Distribuidora Compras SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'inventory', 'active', true),
             (${t}, 'purchase-orders', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name, price, cost)
    values (${tenantA}, ${`PO-A-${RUN}`}, 'Varilla 3/8', 285, 240) returning id`
  productoA = pa!.id

  const [wa] = await sql`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${tenantA}, 'Principal A', 'PA1', true) returning id`
  const [wb] = await sql`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${tenantB}, 'Principal B', 'PB1', true) returning id`
  almacenA = wa!.id
  almacenB = wb!.id

  const [sa] = await sql`
    insert into public.suppliers (tenant_id, name, payment_terms)
    values (${tenantA}, 'Ferretera Import A', 30) returning id`
  const [sb] = await sql`
    insert into public.suppliers (tenant_id, name, payment_terms)
    values (${tenantB}, 'Ferretera Import B', 15) returning id`
  proveedorA = sa!.id
  proveedorB = sb!.id

  const [oa] = await sql`
    insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id)
    values (${tenantA}, ${`OC-TEST-A-${RUN}`}, ${proveedorA}, ${almacenA}) returning id`
  const [ob] = await sql`
    insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id)
    values (${tenantB}, ${`OC-TEST-B-${RUN}`}, ${proveedorB}, ${almacenB}) returning id`
  ordenA = oa!.id
  ordenB = ob!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.purchase_order_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.purchase_orders where tenant_id in ${sql(ts)}`
  // Facil de olvidar: no cuelga de purchase_orders y contamina la corrida
  // siguiente con una numeracion que arranca a medias.
  await sql`delete from public.purchase_order_counters where tenant_id in ${sql(ts)}`
  await sql`delete from public.suppliers where tenant_id in ${sql(ts)}`
  await sql`delete from public.inventory_movements where tenant_id in ${sql(ts)}`
  await sql`delete from public.stock_levels where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('B no ve las ordenes de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.purchase_orders where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no ve los proveedores de A', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.suppliers where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede modificar una orden de A', async () => {
    // No lanza: la RLS lo hace invisible y afecta cero filas. Que "no
    // falle" es justo lo peligroso, asi que se afirma el conteo.
    const afectadas = await as(userB, tenantB, async (tx) => {
      const r = await tx`update public.purchase_orders set notes = 'ajeno' where id = ${ordenA}`
      return r.count
    })
    expect(afectadas).toBe(0)

    const [tras] = await sql<{ notes: string | null }[]>`
      select notes from public.purchase_orders where id = ${ordenA}`
    expect(tras!.notes).toBeNull()
  })

  it('B no puede crear una orden a nombre de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id)
          values (${tenantA}, ${`ROBADO-${RUN}`}, ${proveedorA}, ${almacenA})`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('B no puede colar una linea en una orden de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.purchase_order_lines
            (order_id, tenant_id, product_id, qty_ordered, unit_cost)
          values (${ordenA}, ${tenantA}, ${productoA}, 1, 100)`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('B no ve el contador de numeracion de A', async () => {
    await sql`
      insert into public.purchase_order_counters (tenant_id, year, last_n)
      values (${tenantA}, ${new Date().getFullYear()}, 7)
      on conflict (tenant_id, year) do update set last_n = 7`

    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ last_n: number }[]>`
        select last_n from public.purchase_order_counters where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('la orden de B existe y es suya: aislar no puede romper lo propio', async () => {
    // Sin esta contraparte, una politica que niegue TODO pasaria el bloque.
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.purchase_orders`,
    )
    expect(filas.map((f) => f.id)).toEqual([ordenB])
  })
})

describe('Modulo de compras apagado', () => {
  afterAll(async () => await modulo(tenantA, 'purchase-orders', true))

  it('sin el modulo, ordenes, lineas y proveedores dan cero filas', async () => {
    await modulo(tenantA, 'purchase-orders', false)
    const [ordenes, lineas, proveedores] = await as(userA, tenantA, async (tx) => {
      const o = await tx<{ id: string }[]>`select id from public.purchase_orders`
      const l = await tx<{ id: string }[]>`select id from public.purchase_order_lines`
      const s = await tx<{ id: string }[]>`select id from public.suppliers`
      return [o, l, s] as const
    })
    expect(ordenes).toHaveLength(0)
    expect(lineas).toHaveLength(0)
    expect(proveedores).toHaveLength(0)
  })

  it('sin el modulo no se puede crear una orden', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id)
          values (${tenantA}, ${`APAGADO-${RUN}`}, ${proveedorA}, ${almacenA})`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('sin el modulo, el numerador tampoco entrega numeros', async () => {
    // Un contador que avanza con el modulo apagado quema numeracion que no
    // se puede usar, y al reencender la serie arranca con huecos que nadie
    // sabe explicar. La guarda vive en la funcion porque `security definer`
    // elude la RLS por definicion — escrita asi desde el primer dia (0031
    // tuvo que retrocederla en sales-orders, aqui no hace falta).
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx<{ next_purchase_order_number: string }[]>`
          select public.next_purchase_order_number(${tenantA})`,
      ),
    ).rejects.toThrow(/no esta activo/)
  })

  it('al reencenderlo las ordenes siguen ahi', async () => {
    await modulo(tenantA, 'purchase-orders', true)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.purchase_orders`,
    )
    expect(filas.length).toBeGreaterThan(0)
  })
})

describe('Numeracion', () => {
  it('la primera orden del ano lleva el formato OC-ANO-00001', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ next_purchase_order_number: string }[]>`
        select public.next_purchase_order_number(${tenantB})`,
    )
    expect(r!.next_purchase_order_number).toMatch(/^OC-\d{4}-00001$/)
  })

  it('ocho compradores a la vez: sin repetidos y SIN HUECOS', async () => {
    // "Sin huecos" es la mitad del requisito y la que se olvida: un Set de
    // tamano 8 pasaria igual con 1,2,3,5,6,7,8,9.
    const salida = (
      await Promise.all(
        Array.from({ length: 8 }, () =>
          as(
            userB,
            tenantB,
            (tx) => tx<{ next_purchase_order_number: string }[]>`
              select public.next_purchase_order_number(${tenantB})`,
          ),
        ),
      )
    ).map((r) => r[0]!.next_purchase_order_number)

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
      select last_n from public.purchase_order_counters
      where tenant_id = ${tenantB} and year = ${new Date().getFullYear()}`

    await expect(
      as(userB, tenantB, async (tx) => {
        await tx`select public.next_purchase_order_number(${tenantB})`
        throw new Error('abortar a proposito')
      }),
    ).rejects.toThrow(/abortar/)

    const [despues] = await sql<{ last_n: number }[]>`
      select last_n from public.purchase_order_counters
      where tenant_id = ${tenantB} and year = ${new Date().getFullYear()}`
    expect(despues!.last_n).toBe(antes!.last_n)
  })

  it('cada cliente tiene su propia serie', async () => {
    const [ra] = await as(
      userA,
      tenantA,
      (tx) => tx<{ next_purchase_order_number: string }[]>`
        select public.next_purchase_order_number(${tenantA})`,
    )
    // A tenia el contador en 7 por el test de aislamiento: su serie va por
    // el 8 mientras B ya paso del 9. Independientes, como manda la PK.
    expect(ra!.next_purchase_order_number).toMatch(/^OC-\d{4}-00008$/)
  })

  it('B no puede consumir la numeracion de A', async () => {
    // Mismo agujero que la 0031 tapo en sales-orders. Aqui se escribio bien
    // desde el principio, y este test es lo que lo demuestra.
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx<{ next_purchase_order_number: string }[]>`
          select public.next_purchase_order_number(${tenantA})`,
      ),
    ).rejects.toThrow(/otro cliente/)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un estado inventado se rechaza', async () => {
    await expect(
      sql`update public.purchase_orders set status = 'inventado' where id = ${ordenA}`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('pedir cero unidades no tiene sentido', async () => {
    await expect(
      sql`
        insert into public.purchase_order_lines
          (order_id, tenant_id, product_id, qty_ordered, unit_cost)
        values (${ordenA}, ${tenantA}, ${productoA}, 0, 100)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('no se puede recibir mas de lo pedido', async () => {
    await expect(
      sql`
        insert into public.purchase_order_lines
          (order_id, tenant_id, product_id, qty_ordered, qty_received, unit_cost)
        values (${ordenA}, ${tenantA}, ${productoA}, 5, 6, 100)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el costo unitario no puede ser negativo', async () => {
    await expect(
      sql`
        insert into public.purchase_order_lines
          (order_id, tenant_id, product_id, qty_ordered, unit_cost)
        values (${ordenA}, ${tenantA}, ${productoA}, 1, -5)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el descuento del proveedor no puede pasar de 100%', async () => {
    await expect(
      sql`
        insert into public.purchase_order_lines
          (order_id, tenant_id, product_id, qty_ordered, unit_cost, discount_pct)
        values (${ordenA}, ${tenantA}, ${productoA}, 1, 100, 150)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('la tasa de impuesto es FRACCION, no porcentaje', async () => {
    // `tax_rate` es numeric(5,4): un 18 revienta por desbordamiento ANTES
    // de llegar al check. Con 1.5 si se llega al constraint, que es lo que
    // se quiere probar aqui.
    await expect(
      sql`
        insert into public.purchase_order_lines
          (order_id, tenant_id, product_id, qty_ordered, unit_cost, tax_rate)
        values (${ordenA}, ${tenantA}, ${productoA}, 1, 100, 1.5)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el numero de orden no se repite dentro del mismo cliente', async () => {
    await expect(
      sql`
        insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id)
        values (${tenantA}, ${`OC-TEST-A-${RUN}`}, ${proveedorA}, ${almacenA})`,
    ).rejects.toThrow(/duplicate key/)
  })
})
