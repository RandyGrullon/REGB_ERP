import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * `p_ref` en las tres funciones del movil (0114), contra Postgres real.
 *
 * ── Que se esta probando, y por que importa tanto ─────────────────────
 *
 * La cola offline del telefono reintenta. Tiene que reintentar: en un
 * almacen la señal se cae a mitad de una accion y el usuario no se entera
 * -el telefono se lo guarda y lo sube despues-.
 *
 * El caso que rompe todo no es exotico, es el mas comun: la accion LLEGA
 * al servidor, el servidor la guarda, y la RESPUESTA se pierde. El
 * telefono nunca supo que funciono, asi que lo manda otra vez. Sin
 * idempotencia eso son dos transferencias, dos gastos o dos solicitudes
 * de vacaciones, y ninguna de las tres se arregla borrando:
 *
 *   · El kardex es inmutable (0107): una transferencia repetida se
 *     corrige con movimientos contrarios a mano.
 *   · Un gasto duplicado se reembolsa dos veces Y entra dos veces en la
 *     606 del mes.
 *   · Unas vacaciones duplicadas le descuentan al empleado el doble de
 *     dias de su saldo.
 *
 * ── La prueba que de verdad importa ───────────────────────────────────
 *
 * No es "mandar dos veces devuelve el mismo id" -eso es lo facil-. Es el
 * reintento CUANDO EL ESTADO YA CAMBIO: la transferencia del primer
 * intento ya bajo el stock, asi que si el reintento volviera a validar
 * "¿hay suficiente?" fallaria por algo que en realidad si funciono, y la
 * cola dejaria la accion atascada para siempre. Por eso 0114 responde
 * con el id ANTES de validar nada.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let rolA: string
let rolB: string
let almacen1: string
let almacen2: string
let almacenB1: string
let almacenB2: string
let productoA: string
let productoB: string
let empA: string

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

/** Transferir con referencia, como lo hace la cola. */
const transferir = (
  userId: string,
  tenantId: string,
  roleId: string,
  origen: string,
  destino: string,
  producto: string,
  cantidad: number,
  ref: string | null,
) =>
  as(userId, tenantId, roleId, async (tx) => {
    const [r] = await tx<{ id: string }[]>`
      select public.transferir(${origen}, ${destino}, ${producto}, ${cantidad}, ${ref}) as id`
    return r!.id
  })

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`idem-a-${RUN}`}, 'Idempotencia A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`idem-b-${RUN}`}, 'Idempotencia B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    for (const m of ['inventory', 'expenses', 'employees', 'time-off']) {
      await sql`
        insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
        values (${t}, ${m}, 'active', true)
        on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
    }
  }

  const rol = async (t: string, nombre: string) => {
    const [r] = await sql`
      insert into public.roles (tenant_id, name, visible_modules, permissions, scope)
      values (${t}, ${nombre}, '{*}',
              '{"inventory.transfer": true, "expenses.submit": true}'::jsonb, '{}'::jsonb)
      returning id`
    return r!.id as string
  }
  rolA = await rol(tenantA, `Almacen A ${RUN}`)
  rolB = await rol(tenantB, `Almacen B ${RUN}`)

  const almacen = async (t: string, nombre: string) => {
    const [x] = await sql`
      insert into public.warehouses (tenant_id, name, is_active)
      values (${t}, ${nombre}, true) returning id`
    return x!.id as string
  }
  almacen1 = await almacen(tenantA, `A-Uno ${RUN}`)
  almacen2 = await almacen(tenantA, `A-Dos ${RUN}`)
  almacenB1 = await almacen(tenantB, `B-Uno ${RUN}`)
  almacenB2 = await almacen(tenantB, `B-Dos ${RUN}`)

  const producto = async (t: string, sku: string) => {
    const [x] = await sql`
      insert into public.products (tenant_id, sku, name, unit, price, active)
      values (${t}, ${sku}, ${`Producto ${sku}`}, 'und', 100, true) returning id`
    return x!.id as string
  }
  productoA = await producto(tenantA, `IDA-${RUN}`)
  productoB = await producto(tenantB, `IDB-${RUN}`)

  // Existencia inicial por el camino normal, en las dos cuentas.
  await sql`
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, created_by)
    values (${tenantA}, ${almacen1}, ${productoA}, 'adjustment_in', 100, 50, ${userA})`
  await sql`
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, created_by)
    values (${tenantB}, ${almacenB1}, ${productoB}, 'adjustment_in', 100, 50, ${userB})`

  // Un empleado en A, vinculado por correo al usuario: es como las
  // funciones de gastos y vacaciones averiguan QUIEN esta pidiendo.
  const correo = `ana-idem-${RUN}@prueba.do`
  await sql`
    insert into public.user_profiles (tenant_id, user_id, email, display_name)
    values (${tenantA}, ${userA}, ${correo}, 'Ana')`
  const [e] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, position, salary, email, hire_date, status)
    values (${tenantA}, ${`E-IDEM-${RUN}`}, 'Ana', 'Prueba', 'Vendedor', 30000,
            ${correo}, '2020-01-15', 'active')
    returning id`
  empA = e!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.time_off_requests where tenant_id in ${sql(ts)}`
  await sql`delete from public.expenses where tenant_id in ${sql(ts)}`
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from public.user_profiles where tenant_id in ${sql(ts)}`
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

const stock = async (almacen: string, producto: string) => {
  const [r] = await sql<{ q: string }[]>`
    select qty_on_hand::text as q from public.stock_levels
    where warehouse_id = ${almacen} and product_id = ${producto}`
  return r === undefined ? 0 : Number(r.q)
}

describe('Transferir: el reintento no mueve la mercancia dos veces', () => {
  it('la misma referencia devuelve el mismo id y el stock se mueve UNA vez', async () => {
    const ref = crypto.randomUUID()
    const antes1 = await stock(almacen1, productoA)
    const antes2 = await stock(almacen2, productoA)

    const id1 = await transferir(userA, tenantA, rolA, almacen1, almacen2, productoA, 10, ref)
    const id2 = await transferir(userA, tenantA, rolA, almacen1, almacen2, productoA, 10, ref)

    expect(id2).toBe(id1)
    expect(id1).toBe(ref)
    expect(await stock(almacen1, productoA)).toBe(antes1 - 10)
    expect(await stock(almacen2, productoA)).toBe(antes2 + 10)
  })

  it('y deja UNA sola transferencia y DOS movimientos, no cuatro', async () => {
    const ref = crypto.randomUUID()
    await transferir(userA, tenantA, rolA, almacen1, almacen2, productoA, 5, ref)
    await transferir(userA, tenantA, rolA, almacen1, almacen2, productoA, 5, ref)
    await transferir(userA, tenantA, rolA, almacen1, almacen2, productoA, 5, ref)

    const [t] = await sql<{ n: string }[]>`
      select count(*)::text as n from public.stock_transfers where id = ${ref}`
    expect(Number(t!.n)).toBe(1)

    const [m] = await sql<{ n: string }[]>`
      select count(*)::text as n from public.inventory_movements
      where reference_id = ${ref} and reference_type = 'stock_transfer'`
    expect(Number(m!.n)).toBe(2)
  })

  it('el reintento funciona AUNQUE ya no quede stock para repetirla', async () => {
    // Este es el caso que de verdad importa y el que se escapa si el
    // reintento se valida como si fuera nuevo.
    //
    // La cola manda la transferencia, el servidor la guarda, la respuesta
    // se pierde. Cuando el telefono reintenta, el stock del origen YA
    // bajo. Si la funcion volviera a preguntar "¿hay suficiente?", el
    // reintento moriria con "No hay suficiente en el almacen de origen" y
    // la cola dejaria esa transferencia atascada para siempre -por algo
    // que en realidad si se hizo-.
    const ref = crypto.randomUUID()
    const hay = await stock(almacen1, productoA)

    // Se mueve TODO lo que hay: despues de esto el origen queda en cero.
    const id1 = await transferir(userA, tenantA, rolA, almacen1, almacen2, productoA, hay, ref)
    expect(await stock(almacen1, productoA)).toBe(0)

    const id2 = await transferir(userA, tenantA, rolA, almacen1, almacen2, productoA, hay, ref)
    expect(id2).toBe(id1)
    expect(await stock(almacen1, productoA)).toBe(0)
  })

  it('sin referencia sigue comportandose como antes: dos llamadas, dos transferencias', async () => {
    // La web llama sin cola y no debe cambiar nada para ella.
    await sql`
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, created_by)
      values (${tenantA}, ${almacen1}, ${productoA}, 'adjustment_in', 50, 50, ${userA})`

    const id1 = await transferir(userA, tenantA, rolA, almacen1, almacen2, productoA, 3, null)
    const id2 = await transferir(userA, tenantA, rolA, almacen1, almacen2, productoA, 3, null)
    expect(id2).not.toBe(id1)
  })
})

describe('Una referencia de otra cuenta no sirve para confirmar nada', () => {
  it('mandar el id de una transferencia ajena no la devuelve como propia', async () => {
    // Sin el `and tenant_id = v_tenant` del atajo, mandar uuids ajenos
    // seria una forma de preguntarle a la funcion cuales existen en otra
    // cuenta -y de que te responda que si-.
    const ref = crypto.randomUUID()
    await transferir(userB, tenantB, rolB, almacenB1, almacenB2, productoB, 7, ref)

    await expect(
      transferir(userA, tenantA, rolA, almacen1, almacen2, productoA, 1, ref),
    ).rejects.toThrow()

    // Y la de B sigue siendo de B, intacta.
    const [t] = await sql<{ tenant_id: string }[]>`
      select tenant_id from public.stock_transfers where id = ${ref}`
    expect(t!.tenant_id).toBe(tenantB)
  })
})

describe('Gastos: el reintento no se reembolsa dos veces', () => {
  it('la misma referencia deja UN solo gasto', async () => {
    const ref = crypto.randomUUID()
    const gasto = (r: string) =>
      as(userA, tenantA, rolA, async (tx) => {
        const [x] = await tx<{ id: string }[]>`
          select public.reportar_gasto(
            'meals', current_date, 1250.50, 'Restaurante Prueba', '131-22334-5',
            'B0100000001', 'Almuerzo con cliente', ${r}
          ) as id`
        return x!.id
      })

    const id1 = await gasto(ref)
    const id2 = await gasto(ref)
    expect(id2).toBe(id1)

    const [n] = await sql<{ n: string }[]>`
      select count(*)::text as n from public.expenses
      where tenant_id = ${tenantA} and employee_id = ${empA}`
    expect(Number(n!.n)).toBe(1)
  })
})

describe('Vacaciones: el reintento no descuenta el doble de dias', () => {
  it('la misma referencia deja UNA sola solicitud', async () => {
    const ref = crypto.randomUUID()
    const pedir = (r: string) =>
      as(userA, tenantA, rolA, async (tx) => {
        const [x] = await tx<{ id: string }[]>`
          select public.pedir_vacaciones(
            '2027-03-01'::date, '2027-03-05'::date, 'vacation', 'Semana Santa', ${r}
          ) as id`
        return x!.id
      })

    const id1 = await pedir(ref)
    const id2 = await pedir(ref)
    expect(id2).toBe(id1)

    const [filas] = await sql<{ n: string; dias: string }[]>`
      select count(*)::text as n, coalesce(sum(business_days), 0)::text as dias
      from public.time_off_requests
      where tenant_id = ${tenantA} and employee_id = ${empA}`
    expect(Number(filas!.n)).toBe(1)
    // Cinco dias laborables una sola vez, no diez.
    expect(Number(filas!.dias)).toBe(5)
  })
})
