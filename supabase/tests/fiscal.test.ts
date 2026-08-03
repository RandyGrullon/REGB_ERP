/**
 * Caja, cobros y base fiscal (S21, S22) contra Postgres real.
 *
 * Lo que se prueba aqui no se puede probar sin base de datos:
 *
 *  - `assign_ncf` no entrega el mismo numero dos veces, ni siquiera con dos
 *    cajeros cobrando a la vez. Es la garantia que sostiene todo lo fiscal:
 *    un NCF repetido es una factura invalida y una multa.
 *  - Los reportes 607 y 608 son complementarios: una venta esta en uno o en
 *    el otro, nunca en los dos ni en ninguno.
 *  - El tipo de identificacion sale de contar DIGITOS. Con guiones, un RNC
 *    de 9 medía 11 y se reportaba como cedula.
 *  - Un turno abierto por almacen, y ni un pedazo de esto se ve entre
 *    clientes distintos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 6, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let almacenA: string
let almacenB: string
let productoA: string
let clienteConRnc: string
let turnoA: string

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
    values (${`fis-a-${RUN}`}, 'Colmado Fiscal SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`fis-b-${RUN}`}, 'Ferreteria Fiscal SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'inventory', 'active', true),
             (${t}, 'sales-orders', 'active', true), (${t}, 'pos', 'active', true),
             (${t}, 'ar', 'active', true)
      on conflict do nothing`
  }

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name, price, cost, tax_rate)
    values (${tenantA}, ${`FIS-A-${RUN}`}, 'Refresco 2L', 120, 85, 0.18) returning id`
  productoA = pa!.id

  const [wa] = await sql`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${tenantA}, 'Caja A', 'FA1', true) returning id`
  const [wb] = await sql`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${tenantB}, 'Caja B', 'FB1', true) returning id`
  almacenA = wa!.id
  almacenB = wb!.id

  // Con guiones a proposito: es el dato "sucio" que rompia el 607.
  const [c] = await sql`
    insert into public.customers (tenant_id, name, tax_id, payment_terms)
    values (${tenantA}, 'Cafeteria con RNC', '130-11111-1', 15) returning id`
  clienteConRnc = c!.id

  const [t] = await sql`
    insert into public.pos_shifts (tenant_id, warehouse_id, cashier_id, opening_float, status)
    values (${tenantA}, ${almacenA}, ${userA}, 2000, 'open') returning id`
  turnoA = t!.id

  // Rango corto adrede: agotarlo es parte de lo que se prueba.
  await sql`
    insert into public.ncf_sequences
      (tenant_id, ncf_type, range_from, range_to, next_number, expires_on)
    values (${tenantA}, 'B02', 1, 3, 1, current_date + 365),
           (${tenantA}, 'B01', 100, 200, 100, current_date + 365),
           (${tenantA}, 'E32', 1, 10, 1, current_date + 365)`
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.pos_payments where tenant_id in ${sql(ts)}`
  await sql`delete from public.pos_sale_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.pos_sales where tenant_id in ${sql(ts)}`
  await sql`delete from public.pos_shifts where tenant_id in ${sql(ts)}`
  await sql`delete from public.customer_payments where tenant_id in ${sql(ts)}`
  await sql`delete from public.customer_invoices where tenant_id in ${sql(ts)}`
  await sql`delete from public.ncf_sequences where tenant_id in ${sql(ts)}`
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from public.inventory_movements where tenant_id in ${sql(ts)}`
  await sql`delete from public.stock_levels where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('assign_ncf: un numero no se entrega dos veces', () => {
  it('los emite consecutivos y con el ancho de la serie B', async () => {
    const uno = await as(
      userA,
      tenantA,
      (tx) => tx<{ assign_ncf: string }[]>`select public.assign_ncf(${tenantA}, 'B02')`,
    )
    const dos = await as(
      userA,
      tenantA,
      (tx) => tx<{ assign_ncf: string }[]>`select public.assign_ncf(${tenantA}, 'B02')`,
    )
    expect(uno[0]!.assign_ncf).toBe('B0200000001')
    expect(dos[0]!.assign_ncf).toBe('B0200000002')
  })

  it('la serie E lleva 10 digitos, no 8', async () => {
    const r = await as(
      userA,
      tenantA,
      (tx) => tx<{ assign_ncf: string }[]>`select public.assign_ncf(${tenantA}, 'E32')`,
    )
    expect(r[0]!.assign_ncf).toBe('E320000000001')
  })

  it('dos cajeros a la vez NO reciben el mismo numero', async () => {
    // El rango B01 va de 100 a 200. Seis peticiones simultaneas: si el
    // `for update` no estuviera, se repetirian.
    const peticiones = Array.from({ length: 6 }, () =>
      as(
        userA,
        tenantA,
        (tx) => tx<{ assign_ncf: string }[]>`select public.assign_ncf(${tenantA}, 'B01')`,
      ),
    )
    const salida = (await Promise.all(peticiones)).map((r) => r[0]!.assign_ncf)
    expect(new Set(salida).size).toBe(6)
    expect(salida.every((n) => n.startsWith('B01'))).toBe(true)
  })

  it('agotado el rango, falla con un mensaje que se puede actuar', async () => {
    // Quedaba el 3 de B02 (rango 1-3).
    await as(
      userA,
      tenantA,
      (tx) => tx<{ assign_ncf: string }[]>`select public.assign_ncf(${tenantA}, 'B02')`,
    )
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx<{ assign_ncf: string }[]>`select public.assign_ncf(${tenantA}, 'B02')`,
      ),
    ).rejects.toThrow(/agotaron/)
  })

  it('sin secuencia de ese tipo, lo dice en vez de inventar un numero', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx<{ assign_ncf: string }[]>`select public.assign_ncf(${tenantA}, 'B14')`,
      ),
    ).rejects.toThrow(/No hay secuencia activa/)
  })

  it('una secuencia vencida no emite, aunque le sobren numeros', async () => {
    await sql`
      insert into public.ncf_sequences
        (tenant_id, ncf_type, range_from, range_to, next_number, expires_on)
      values (${tenantA}, 'B04', 1, 5000, 1, current_date - 1)`
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx<{ assign_ncf: string }[]>`select public.assign_ncf(${tenantA}, 'B04')`,
      ),
    ).rejects.toThrow(/vencio/)
  })
})

describe('607 y 608 son complementarios', () => {
  let ventaId: string

  it('una venta con NCF aparece en el 607', async () => {
    const [v] = await sql<{ id: string }[]>`
      insert into public.pos_sales
        (tenant_id, shift_id, number, customer_id, subtotal, discount, tax, total,
         cashier_id, ncf, ncf_type)
      values (${tenantA}, ${turnoA}, ${`TK-${RUN}-1`}, ${clienteConRnc},
              100, 0, 18, 118, ${userA}, 'B0100000100', 'B01')
      returning id`
    ventaId = v!.id

    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ ncf: string; origen: string }[]>`
        select ncf, origen from public.dgii_607 where ncf = 'B0100000100'`,
    )
    expect(filas).toHaveLength(1)
    expect(filas[0]!.origen).toBe('caja')
  })

  it('el RNC se clasifica contando digitos, no caracteres', async () => {
    // El cliente se guardo como '130-11111-1': 11 caracteres, 9 digitos.
    // Contando caracteres saldria cedula (2); contando digitos, RNC (1).
    const [f] = await as(
      userA,
      tenantA,
      (tx) => tx<{ rnc_comprador: string; tipo_identificacion: string }[]>`
        select rnc_comprador, tipo_identificacion from public.dgii_607
        where ncf = 'B0100000100'`,
    )
    expect(f!.rnc_comprador).toBe('130111111')
    expect(f!.tipo_identificacion).toBe('1')
  })

  it('al anularla sale del 607 y entra al 608, con su motivo', async () => {
    await sql`
      update public.pos_sales
      set voided = true, void_reason = 'devolucion del cliente', voided_at = now()
      where id = ${ventaId}`

    const [en607, en608] = await as(userA, tenantA, async (tx) => {
      const a = await tx<{ ncf: string }[]>`
        select ncf from public.dgii_607 where ncf = 'B0100000100'`
      const b = await tx<{ ncf: string; motivo: string }[]>`
        select ncf, motivo from public.dgii_608 where ncf = 'B0100000100'`
      return [a, b] as const
    })

    expect(en607).toHaveLength(0)
    expect(en608).toHaveLength(1)
    expect(en608[0]!.motivo).toBe('devolucion del cliente')
  })

  it('una venta SIN NCF no entra en ninguno de los dos', async () => {
    await sql`
      insert into public.pos_sales
        (tenant_id, shift_id, number, subtotal, discount, tax, total, cashier_id)
      values (${tenantA}, ${turnoA}, ${`TK-${RUN}-2`}, 50, 0, 9, 59, ${userA})`

    const [c607, c608] = await as(userA, tenantA, async (tx) => {
      const a = await tx<{ n: string }[]>`select count(*)::text as n from public.dgii_607`
      const b = await tx<{ n: string }[]>`select count(*)::text as n from public.dgii_608`
      return [Number(a[0]!.n), Number(b[0]!.n)] as const
    })
    // Solo la anulada, que esta en el 608. La sin NCF no cuenta en ninguno.
    expect(c607).toBe(0)
    expect(c608).toBe(1)
  })

  it('una factura a credito con NCF tambien entra al 607', async () => {
    await sql`
      insert into public.customer_invoices
        (tenant_id, number, customer_id, source_type, issue_date, due_date,
         subtotal, discount, tax, total, status, ncf, ncf_type)
      values (${tenantA}, ${`FAC-${RUN}-1`}, ${clienteConRnc}, 'manual',
              current_date, current_date + 15, 1000, 0, 180, 1180, 'open',
              'B0100000101', 'B01')`

    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ origen: string }[]>`
        select origen from public.dgii_607 where ncf = 'B0100000101'`,
    )
    expect(filas).toHaveLength(1)
    expect(filas[0]!.origen).toBe('factura')
  })
})

describe('Turnos de caja', () => {
  it('no se puede abrir un segundo turno en el mismo almacen', async () => {
    await expect(
      sql`
        insert into public.pos_shifts
          (tenant_id, warehouse_id, cashier_id, opening_float, status)
        values (${tenantA}, ${almacenA}, ${userB}, 500, 'open')`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('el efectivo esperado es el fondo mas los pagos en efectivo', async () => {
    const [venta] = await sql<{ id: string }[]>`
      insert into public.pos_sales
        (tenant_id, shift_id, number, subtotal, discount, tax, total, cashier_id)
      values (${tenantA}, ${turnoA}, ${`TK-${RUN}-3`}, 200, 0, 36, 236, ${userA})
      returning id`

    await sql`
      insert into public.pos_sale_lines
        (sale_id, tenant_id, product_id, qty, unit_price, discount_pct, tax_rate, line_total)
      values (${venta!.id}, ${tenantA}, ${productoA}, 2, 100, 0, 0.18, 236)`

    await sql`
      insert into public.pos_payments (sale_id, tenant_id, method, amount)
      values (${venta!.id}, ${tenantA}, 'cash', 236)`

    // Fondo 2000 + 236 en efectivo. La venta anulada y la de tarjeta no suman.
    const [r] = await sql<{ esperado: string }[]>`
      select public.pos_expected_cash(${turnoA})::text as esperado`
    expect(Number(r!.esperado)).toBe(2236)
  })
})

describe('Aislamiento de lo fiscal', () => {
  it('B no ve las ventas de A', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.pos_sales`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no ve las secuencias NCF de A', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ ncf_type: string }[]>`select ncf_type from public.ncf_sequences`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede consumir un NCF de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx<{ assign_ncf: string }[]>`select public.assign_ncf(${tenantA}, 'B01')`,
      ),
    ).rejects.toThrow()
  })

  it('el 607 de B esta vacio aunque A tenga comprobantes', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ ncf: string }[]>`select ncf from public.dgii_607`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no ve las facturas de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ number: string }[]>`
        select number from public.customer_invoices where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede abrir un turno en el almacen de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.pos_shifts
            (tenant_id, warehouse_id, cashier_id, opening_float, status)
          values (${tenantA}, ${almacenA}, ${userB}, 1, 'open')`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('el almacen de B existe y es suyo: el aislamiento no rompe lo propio', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.warehouses`,
    )
    expect(filas.map((f) => f.id)).toEqual([almacenB])
  })
})

describe('Regla permanente: ninguna vista de public se salta la RLS', () => {
  it('todas llevan security_invoker', async () => {
    // Una vista corre con los privilegios de su DUENO salvo que se marque
    // `security_invoker`. Sin eso, exponer una tabla con RLS a traves de una
    // vista la deja abierta a todos los clientes, y no se nota: la
    // aplicacion siempre filtra por tenant en el `where`.
    //
    // Asi se colaron dgii_607 y dgii_608. Este test existe para que la
    // proxima vista no repita el fallo — si falla, no lo excluyas: ponle
    // `security_invoker = true` a la vista que aparezca aqui.
    const abiertas = await sql<{ viewname: string }[]>`
      select c.relname as viewname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'v'
        and n.nspname = 'public'
        and coalesce(
          (select option_value from pg_options_to_table(c.reloptions)
            where option_name = 'security_invoker'), 'false') <> 'true'`

    expect(abiertas.map((v) => v.viewname)).toEqual([])
  })
})

describe('Modulo apagado', () => {
  it('sin ar activo, las secuencias NCF siguen visibles para la caja', async () => {
    // Regla deliberada: un colmado con POS pero sin cuentas por cobrar
    // tiene que poder emitir un ticket con comprobante fiscal.
    await sql`
      update regb.tenant_modules set enabled = false
      where tenant_id = ${tenantA} and module_id = 'ar'`

    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ ncf_type: string }[]>`select ncf_type from public.ncf_sequences`,
    )
    expect(filas.length).toBeGreaterThan(0)

    await sql`
      update regb.tenant_modules set enabled = true
      where tenant_id = ${tenantA} and module_id = 'ar'`
  })

  it('sin pos activo, las ventas de caja dan cero filas', async () => {
    await sql`
      update regb.tenant_modules set enabled = false
      where tenant_id = ${tenantA} and module_id = 'pos'`

    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.pos_sales`,
    )
    expect(filas).toHaveLength(0)

    await sql`
      update regb.tenant_modules set enabled = true
      where tenant_id = ${tenantA} and module_id = 'pos'`
  })
})
