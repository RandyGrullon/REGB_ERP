import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * `public.transferir()` (0111) contra Postgres real.
 *
 * La funcion existe porque una transferencia son CUATRO escrituras que
 * tienen que ocurrir juntas, y por PostgREST cada peticion es su propia
 * transaccion: cuatro llamadas sueltas dejan la mercancia a medio camino
 * si se cae la señal en el almacen.
 *
 * Pero corre con `security definer`, o sea que la RLS NO la frena. Todo
 * lo que separa a un cliente de otro aqui son los `if` que comprueban el
 * tenant de los tres ids que llegan por parametro. Eso es lo que estas
 * pruebas vigilan: el resto -que sume y reste bien- es lo facil.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let rolA: string
let rolSinPermiso: string
let almacen1: string
let almacen2: string
let almacenB: string
let productoA: string
let productoB: string

const claims = (userId: string, tenantId: string, roleId: string | null) =>
  JSON.stringify({
    sub: userId,
    app_metadata: { tenant_id: tenantId, role_id: roleId, is_provider: false },
  })

async function as<T>(
  userId: string,
  tenantId: string,
  roleId: string | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenantId, roleId)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`tr-a-${RUN}`}, 'Transferencias A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`tr-b-${RUN}`}, 'Transferencias B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'inventory', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [r] = await sql`
    insert into public.roles (tenant_id, name, visible_modules, permissions, scope)
    values (${tenantA}, ${`Almacen ${RUN}`}, '{*}', '{"inventory.transfer": true}'::jsonb, '{}'::jsonb)
    returning id`
  rolA = r!.id

  const [rs] = await sql`
    insert into public.roles (tenant_id, name, visible_modules, permissions, scope)
    values (${tenantA}, ${`Mirar ${RUN}`}, '{*}', '{"inventory.view": true}'::jsonb, '{}'::jsonb)
    returning id`
  rolSinPermiso = rs!.id

  const w = async (t: string, nombre: string) => {
    const [x] = await sql`
      insert into public.warehouses (tenant_id, name, is_active)
      values (${t}, ${nombre}, true) returning id`
    return x!.id as string
  }
  almacen1 = await w(tenantA, `Uno ${RUN}`)
  almacen2 = await w(tenantA, `Dos ${RUN}`)
  almacenB = await w(tenantB, `DeB ${RUN}`)

  const p = async (t: string, sku: string) => {
    const [x] = await sql`
      insert into public.products (tenant_id, sku, name, unit, price, active)
      values (${t}, ${sku}, ${`Producto ${sku}`}, 'und', 100, true) returning id`
    return x!.id as string
  }
  productoA = await p(tenantA, `TRA-${RUN}`)
  productoB = await p(tenantB, `TRB-${RUN}`)

  // Existencia inicial en el almacen 1, por el camino normal.
  await sql`
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, created_by)
    values (${tenantA}, ${almacen1}, ${productoA}, 'adjustment_in', 100, 50, ${userA})`
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.stock_transfer_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.stock_transfers where tenant_id in ${sql(ts)}`
  await sql`delete from public.inventory_movements where tenant_id in ${sql(ts)}`
  await sql`delete from public.stock_levels where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from public.roles where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenant_modules where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

const stock = async (almacen: string) => {
  const [r] = await sql<{ q: string }[]>`
    select qty_on_hand::text as q from public.stock_levels
    where warehouse_id = ${almacen} and product_id = ${productoA}`
  return r === undefined ? 0 : Number(r.q)
}

describe('La transferencia mueve las dos puntas, o ninguna', () => {
  it('resta en el origen y suma en el destino', async () => {
    const antes1 = await stock(almacen1)
    const antes2 = await stock(almacen2)

    const id = await as(userA, tenantA, rolA, async (tx) => {
      const [r] = await tx<{ transferir: string }[]>`
        select public.transferir(${almacen1}, ${almacen2}, ${productoA}, 30) as transferir`
      return r!.transferir
    })

    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await stock(almacen1)).toBe(antes1 - 30)
    expect(await stock(almacen2)).toBe(antes2 + 30)
  })

  it('la mercancia llega al destino con su costo, no a cero (0137)', async () => {
    // El almacen 2 no tenia el producto: antes de 0137 el transfer_in
    // entraba sin costo y el promedio del destino quedaba en 0.0000.
    const [d] = await sql<{ avg: string }[]>`
      select avg_cost::text as avg from public.stock_levels
      where warehouse_id = ${almacen2} and product_id = ${productoA}`
    expect(Number(d!.avg)).toBe(50)
    const filas = await sql<{ movement_type: string; unit_cost: string | null }[]>`
      select movement_type, unit_cost::text from public.inventory_movements
      where tenant_id = ${tenantA} and reference_type = 'stock_transfer'`
    expect(filas.every((f) => Number(f.unit_cost) === 50)).toBe(true)
  })

  it('deja los dos movimientos de kardex, apuntando a la transferencia', async () => {
    const filas = await sql<{ movement_type: string; qty: string }[]>`
      select movement_type, qty::text from public.inventory_movements
      where tenant_id = ${tenantA} and reference_type = 'stock_transfer'
      order by movement_type`
    expect(filas.map((f) => f.movement_type)).toEqual(['transfer_in', 'transfer_out'])
  })

  it('no se puede mover lo que no esta', async () => {
    // Esta prueba nacio esperando que el trigger `no_mover_sin_stock`
    // frenara esto. NO lo frena: ese trigger impide mover un producto
    // que no lleva control de existencias, no uno del que no queda. La
    // transferencia de 999.999 PASO, y el stock quedo negativo.
    //
    // En este sistema el kardex suma y resta sin mirar. Para una venta
    // eso hasta puede defenderse; para una transferencia no, porque
    // crea existencia de la nada en el destino.
    const antesCab = await sql<{ n: number }[]>`
      select count(*)::int as n from public.stock_transfers where tenant_id = ${tenantA}`

    await expect(
      as(userA, tenantA, rolA, (tx) => tx`
        select public.transferir(${almacen1}, ${almacen2}, ${productoA}, 999999)`),
    ).rejects.toThrow()

    const despues = await sql<{ n: number }[]>`
      select count(*)::int as n from public.stock_transfers where tenant_id = ${tenantA}`
    expect(despues[0]!.n).toBe(antesCab[0]!.n)
  })
})

describe('Lo que separa a un cliente de otro son los if, no la RLS', () => {
  it('no se puede sacar mercancia hacia el almacen de OTRO cliente', async () => {
    await expect(
      as(userA, tenantA, rolA, (tx) => tx`
        select public.transferir(${almacen1}, ${almacenB}, ${productoA}, 1)`),
    ).rejects.toThrow(/destino no es de esta cuenta/)
  })

  it('ni traerla desde el almacen de otro', async () => {
    await expect(
      as(userA, tenantA, rolA, (tx) => tx`
        select public.transferir(${almacenB}, ${almacen1}, ${productoA}, 1)`),
    ).rejects.toThrow(/origen no es de esta cuenta/)
  })

  it('ni mover un producto que no es suyo', async () => {
    await expect(
      as(userA, tenantA, rolA, (tx) => tx`
        select public.transferir(${almacen1}, ${almacen2}, ${productoB}, 1)`),
    ).rejects.toThrow(/producto no es de esta cuenta/)
  })

  it('y B tampoco puede mover lo de A poniendo sus propios ids', async () => {
    await expect(
      as(userB, tenantB, null, (tx) => tx`
        select public.transferir(${almacen1}, ${almacen2}, ${productoA}, 1)`),
    ).rejects.toThrow(/no es de esta cuenta/)
  })
})

describe('El permiso se comprueba en la base, no solo en la app', () => {
  it('un rol sin inventory.transfer no transfiere', async () => {
    await expect(
      as(userA, tenantA, rolSinPermiso, (tx) => tx`
        select public.transferir(${almacen1}, ${almacen2}, ${productoA}, 1)`),
    ).rejects.toThrow(/no permite transferir/)
  })
})

describe('Lo que llega del cliente se valida', () => {
  it('origen y destino iguales se rechaza', async () => {
    await expect(
      as(userA, tenantA, rolA, (tx) => tx`
        select public.transferir(${almacen1}, ${almacen1}, ${productoA}, 1)`),
    ).rejects.toThrow(/distintos/)
  })

  it('cantidad cero o negativa se rechaza', async () => {
    for (const q of [0, -5]) {
      await expect(
        as(userA, tenantA, rolA, (tx) => tx`
          select public.transferir(${almacen1}, ${almacen2}, ${productoA}, ${q})`),
      ).rejects.toThrow(/positiva/)
    }
  })
})
