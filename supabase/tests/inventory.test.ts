/**
 * Inventario (S19) contra Postgres real.
 *
 * La aritmetica del costo promedio se prueba sin base en @regb/operations.
 * Aqui va lo que SOLO el motor garantiza y lo que mas caro cuesta si se
 * rompe en silencio:
 *
 *  - que el kardex sea de verdad inmutable (no por convencion, por RLS),
 *  - que `stock_levels` nunca se separe de la suma de los movimientos,
 *  - que un cliente no vea ni toque el inventario del vecino.
 *
 * El primero es el que justifica el test: la inmutabilidad depende de la
 * AUSENCIA de politicas `update`/`delete`. Una ausencia no se ve leyendo el
 * archivo, y cualquiera que "complete" las politicas a `for all` la borra
 * sin darse cuenta. Esto lo convierte en un fallo ruidoso.
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

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`inv-a-${RUN}`}, 'Colmado Inventario SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`inv-b-${RUN}`}, 'Ferreteria Inventario SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'inventory', 'active', true)
      on conflict do nothing`
  }

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name, price, cost)
    values (${tenantA}, ${`INV-A-${RUN}`}, 'Cemento gris', 465, 380) returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name, price, cost)
    values (${tenantB}, ${`INV-B-${RUN}`}, 'Varilla 1/2', 720, 610) returning id`
  productoA = pa!.id
  productoB = pb!.id

  const [wa] = await sql`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${tenantA}, 'Principal A', 'A01', true) returning id`
  const [wb] = await sql`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${tenantB}, 'Principal B', 'B01', true) returning id`
  almacenA = wa!.id
  almacenB = wb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.inventory_movements where tenant_id in ${sql(ts)}`
  await sql`delete from public.stock_levels where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

/**
 * Movimiento como el usuario A. El tipo se deriva del signo, igual que en
 * la accion real: `adjustment_in` suma, `adjustment_out` resta.
 */
async function movimiento(qty: number, costo: number) {
  const tipo = qty >= 0 ? 'adjustment_in' : 'adjustment_out'
  return as(
    userA,
    tenantA,
    (tx) => tx`
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, created_by)
      values (${tenantA}, ${almacenA}, ${productoA}, ${tipo}, ${qty}, ${costo}, ${userA})`,
  )
}

describe('El kardex es inmutable', () => {
  it('un movimiento se puede insertar', async () => {
    await movimiento(100, 380)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ qty: string }[]>`
        select qty::text from public.inventory_movements`,
    )
    expect(filas).toHaveLength(1)
  })

  it('NO se puede editar: la RLS no tiene politica de update', async () => {
    const [m] = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.inventory_movements limit 1`,
    )

    // El update no lanza: la RLS lo hace invisible y afecta CERO filas. Que
    // "no falle" es justo lo peligroso, asi que se afirma el conteo.
    const afectadas = await as(userA, tenantA, async (tx) => {
      const r = await tx`update public.inventory_movements set qty = 9999 where id = ${m!.id}`
      return r.count
    })
    expect(afectadas).toBe(0)

    const [tras] = await as(
      userA,
      tenantA,
      (tx) => tx<{ qty: string }[]>`
        select qty::text from public.inventory_movements where id = ${m!.id}`,
    )
    expect(Number(tras!.qty)).toBe(100)
  })

  it('NO se puede borrar', async () => {
    const [m] = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.inventory_movements limit 1`,
    )
    const afectadas = await as(userA, tenantA, async (tx) => {
      const r = await tx`delete from public.inventory_movements where id = ${m!.id}`
      return r.count
    })
    expect(afectadas).toBe(0)

    const quedan = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.inventory_movements`,
    )
    expect(quedan.length).toBeGreaterThan(0)
  })

  it('corregir es el movimiento contrario, y quedan los dos', async () => {
    await movimiento(-10, 380)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ qty: string }[]>`
        select qty::text from public.inventory_movements order by created_at`,
    )
    expect(filas.map((f) => Number(f.qty))).toEqual([100, -10])
  })

  it('un movimiento de cantidad cero no tiene sentido y se rechaza', async () => {
    await expect(movimiento(0, 380)).rejects.toThrow(/violates check constraint/)
  })
})

describe('La proyeccion nunca se separa del libro', () => {
  it('stock_levels es exactamente la suma del kardex', async () => {
    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ proyectado: string; sumado: string }[]>`
        select
          (select qty_on_hand from public.stock_levels
            where tenant_id = ${tenantA} and warehouse_id = ${almacenA}
              and product_id = ${productoA})::text as proyectado,
          (select coalesce(sum(qty), 0) from public.inventory_movements
            where tenant_id = ${tenantA} and warehouse_id = ${almacenA}
              and product_id = ${productoA})::text as sumado`,
    )
    expect(Number(r!.proyectado)).toBe(Number(r!.sumado))
    expect(Number(r!.proyectado)).toBe(90)
  })

  it('sigue cuadrando despues de mas movimientos', async () => {
    await movimiento(50, 420)
    await movimiento(-25, 0)

    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ proyectado: string; sumado: string }[]>`
        select
          (select qty_on_hand from public.stock_levels
            where tenant_id = ${tenantA} and product_id = ${productoA})::text as proyectado,
          (select coalesce(sum(qty), 0) from public.inventory_movements
            where tenant_id = ${tenantA} and product_id = ${productoA})::text as sumado`,
    )
    expect(Number(r!.proyectado)).toBe(Number(r!.sumado))
    expect(Number(r!.proyectado)).toBe(115)
  })

  it('el costo promedio solo lo mueven las entradas', async () => {
    // 90 a 380 + 50 a 420 = (90*380 + 50*420) / 140 = 394.29 aprox.
    // La salida de 25 consume al promedio y no lo cambia.
    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ avg: string }[]>`
        select avg_cost::text as avg from public.stock_levels
        where tenant_id = ${tenantA} and product_id = ${productoA}`,
    )
    expect(Number(r!.avg)).toBeCloseTo((90 * 380 + 50 * 420) / 140, 1)
  })
})

describe('Aislamiento entre clientes', () => {
  it('A no ve los movimientos de B', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, created_by)
        values (${tenantB}, ${almacenB}, ${productoB}, 'adjustment_in', 33, 610, ${userB})`,
    )

    const desdeA = await as(
      userA,
      tenantA,
      (tx) => tx<{ qty: string }[]>`
        select qty::text from public.inventory_movements where tenant_id = ${tenantB}`,
    )
    expect(desdeA).toHaveLength(0)
  })

  it('A no puede insertar un movimiento en el almacen de B', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, created_by)
          values (${tenantB}, ${almacenB}, ${productoB}, 'adjustment_in', 5, 1, ${userA})`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('A no ve las existencias de B', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`
        select product_id as id from public.stock_levels where tenant_id = ${tenantB}`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Modulo apagado', () => {
  it('sin inventory activo, existencias y kardex dan cero filas', async () => {
    await sql`
      update regb.tenant_modules set enabled = false
      where tenant_id = ${tenantA} and module_id = 'inventory'`

    const [mov, stock] = await as(userA, tenantA, async (tx) => {
      const m = await tx<{ id: string }[]>`select id from public.inventory_movements`
      const s = await tx<{ product_id: string }[]>`select product_id from public.stock_levels`
      return [m, s] as const
    })
    expect(mov).toHaveLength(0)
    expect(stock).toHaveLength(0)

    await sql`
      update regb.tenant_modules set enabled = true
      where tenant_id = ${tenantA} and module_id = 'inventory'`
  })

  it('al reactivarlo los datos siguen ahi: apagar no borra', async () => {
    const mov = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.inventory_movements`,
    )
    expect(mov.length).toBeGreaterThan(0)
  })
})

describe('A stock_levels solo escribe el kardex (0107)', () => {
  /**
   * `stock_levels` no es un dato: es la proyeccion del kardex, calculada
   * por un trigger dentro de la misma transaccion del movimiento.
   *
   * Antes de 0107, `authenticated` tenia insert/update/delete sobre ella.
   * Medido en este repo: con la sesion de un usuario normal, un update
   * subio una existencia de 31 a 1030 SIN generar un solo movimiento. El
   * kardex decia 31 y el sistema 1030, y el unico sitio donde eso se nota
   * es al contar.
   *
   * La RLS no lo cubria: la politica acota tenant y modulo, no prohibe
   * escribir. Con el movil hablandole a PostgREST la tabla queda a un
   * PATCH de distancia de cualquiera con la app instalada.
   */
  it('el movimiento legitimo SIGUE moviendo el stock', async () => {
    // Se comprueba primero: una revocacion que rompe el camino bueno es
    // peor que el agujero que cierra.
    const antes = await as(
      userA,
      tenantA,
      (tx) => tx<{ qty_on_hand: string }[]>`
        select qty_on_hand::text from public.stock_levels
        where product_id = ${productoA} and warehouse_id = ${almacenA}`,
    )
    const partida = antes[0] ? Number(antes[0].qty_on_hand) : 0

    await movimiento(7, 100)

    const [despues] = await as(
      userA,
      tenantA,
      (tx) => tx<{ qty_on_hand: string }[]>`
        select qty_on_hand::text from public.stock_levels
        where product_id = ${productoA} and warehouse_id = ${almacenA}`,
    )
    expect(Number(despues!.qty_on_hand)).toBe(partida + 7)
  })

  it('pero escribirla a mano se deniega', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          update public.stock_levels set qty_on_hand = qty_on_hand + 999
          where product_id = ${productoA} and warehouse_id = ${almacenA}`,
      ),
    ).rejects.toThrow(/permission denied|permiso/i)
  })

  it('ni insertando una existencia de la nada', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.stock_levels (tenant_id, warehouse_id, product_id, qty_on_hand)
          values (${tenantA}, ${almacenA}, ${productoA}, 9999)`,
      ),
    ).rejects.toThrow(/permission denied|permiso/i)
  })

  it('ni borrando la fila para que el faltante desaparezca', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          delete from public.stock_levels
          where product_id = ${productoA} and warehouse_id = ${almacenA}`,
      ),
    ).rejects.toThrow(/permission denied|permiso/i)
  })

  it('leerla se puede, que es el pan de cada dia', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx`select qty_on_hand from public.stock_levels where tenant_id = ${tenantA}`,
    )
    expect(filas.length).toBeGreaterThan(0)
  })
})

