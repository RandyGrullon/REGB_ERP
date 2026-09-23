/**
 * Lo fiscal que se declara mal sin que nada falle (0129).
 *
 * Nada de esto se ve en pantalla: el 607 sale, cuadra consigo mismo y
 * rebota -o peor, no rebota- en la DGII. Por eso se prueba contra la base:
 *
 *  1. El monto facturado del 607 es la base SIN ITBIS que se cobro. Un
 *     ticket de 1,000 con 10% de descuento se guarda con subtotal 900
 *     (neto, documentTotals) y se declaraba 800: el descuento, dos veces.
 *  2. El periodo y la fecha del comprobante son los de Santo Domingo. La
 *     base corre en UTC: una venta del 30 a las 9 p. m. caia en octubre, y
 *     una venta offline se fechaba con la hora de sincronizar.
 *  3. Las secuencias NCF: varias del mismo tipo conviven y se consumen en
 *     orden, un rango que pisa a otro se rechaza, el vencimiento se corrige
 *     con motivo, y un cajero no escribe en la tabla por PostgREST.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 6, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const dueno = crypto.randomUUID()
const cajero = crypto.randomUUID()
const contador = crypto.randomUUID()
let colmado: string // solo `pos`: el colmado del hallazgo 1
let ferreteria: string // ar + pos + ap: la que vende a credito
let rolCajero: string
let rolDueno: string
let turnoColmado: string
let clienteFerre: string
let proveedorFerre: string

const claims = (userId: string, tenantId: string, roleId?: string) =>
  JSON.stringify({
    sub: userId,
    app_metadata: {
      tenant_id: tenantId,
      is_provider: false,
      ...(roleId ? { role_id: roleId } : {}),
    },
  })

/** Como la app o como el movil: con `roleId` el token trae el rol y la RLS lo mira. */
async function as<T>(
  userId: string,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
  roleId?: string,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenantId, roleId)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

async function turno(tenantId: string, codigo: string): Promise<string> {
  const [w] = await sql<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${tenantId}, 'Mostrador', ${codigo}, true) returning id`
  const [t] = await sql<{ id: string }[]>`
    insert into public.pos_shifts (tenant_id, warehouse_id, cashier_id, opening_float, status)
    values (${tenantId}, ${w!.id}, ${cajero}, 1000, 'open') returning id`
  return t!.id
}

beforeAll(async () => {
  const [a] = await sql<{ id: string }[]>`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`dgii-col-${RUN}`}, 'Colmado La Esperanza', 'pyme', 'active') returning id`
  const [b] = await sql<{ id: string }[]>`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`dgii-fer-${RUN}`}, 'Ferreteria El Martillo SRL', 'pyme', 'active') returning id`
  colmado = a!.id
  ferreteria = b!.id

  await sql`
    insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
    values (${colmado}, 'products', 'active', true), (${colmado}, 'pos', 'active', true)
    on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  await sql`
    insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
    values (${ferreteria}, 'products', 'active', true), (${ferreteria}, 'pos', 'active', true),
           (${ferreteria}, 'sales-orders', 'active', true), (${ferreteria}, 'ar', 'active', true),
           (${ferreteria}, 'purchase-orders', 'active', true), (${ferreteria}, 'ap', 'active', true)
    on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`

  // Los roles que viajan en el token del movil. El cajero vende; el dueño
  // administra los comprobantes desde la caja.
  const [rc] = await sql<{ id: string }[]>`
    insert into public.roles (tenant_id, name, visible_modules, permissions)
    values (${colmado}, ${`Cajero-${RUN}`}, '{pos}',
            ${JSON.stringify({ 'pos.view': true, 'pos.sell': true })}::text::jsonb)
    returning id`
  const [rd] = await sql<{ id: string }[]>`
    insert into public.roles (tenant_id, name, visible_modules, permissions)
    values (${colmado}, ${`Dueno-${RUN}`}, '{pos}',
            ${JSON.stringify({ 'pos.*': true })}::text::jsonb)
    returning id`
  rolCajero = rc!.id
  rolDueno = rd!.id

  turnoColmado = await turno(colmado, `C${RUN.slice(0, 4)}`)
  // La ferreteria tambien necesita un turno abierto, aunque ninguna prueba lo lea.
  await turno(ferreteria, `F${RUN.slice(0, 4)}`)

  const [c] = await sql<{ id: string }[]>`
    insert into public.customers (tenant_id, name, tax_id, payment_terms)
    values (${ferreteria}, 'Constructora Duarte SRL', '131234567', 30) returning id`
  clienteFerre = c!.id
  const [p] = await sql<{ id: string }[]>`
    insert into public.suppliers (tenant_id, name, tax_id)
    values (${ferreteria}, 'Cementos del Cibao SRL', '101010101') returning id`
  proveedorFerre = p!.id
})

afterAll(async () => {
  const ts = [colmado, ferreteria]
  await sql`delete from public.pos_payments where tenant_id in ${sql(ts)}`
  await sql`delete from public.pos_sale_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.pos_sales where tenant_id in ${sql(ts)}`
  await sql`delete from public.pos_shifts where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from public.customer_payments where tenant_id in ${sql(ts)}`
  await sql`delete from public.customer_invoices where tenant_id in ${sql(ts)}`
  await sql`delete from public.supplier_payments where tenant_id in ${sql(ts)}`
  await sql`delete from public.supplier_invoices where tenant_id in ${sql(ts)}`
  await sql`delete from public.suppliers where tenant_id in ${sql(ts)}`
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from public.ncf_sequences where tenant_id in ${sql(ts)}`
  await sql`delete from public.event_outbox where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

// ─────────────────────────────────────────────────────────────────────────
describe('607: el monto facturado es la base sin ITBIS, sin restar el descuento otra vez', () => {
  it('ticket de 1,000 con 10%: subtotal neto 900, ITBIS 162 -> se declaran 900, no 800', async () => {
    // Exactamente lo que guarda cobrarVenta() con documentTotals(): el
    // subtotal YA viene neto de descuento.
    await sql`
      insert into public.pos_sales
        (tenant_id, shift_id, number, subtotal, discount, tax, total, cashier_id,
         ncf, ncf_type, sold_at)
      values (${colmado}, ${turnoColmado}, ${`D-${RUN}`}, 900.00, 100.00, 162.00, 1062.00,
              ${cajero}, 'B0200000901', 'B02', '2026-08-14 10:00-04')`

    const [f] = await as(
      dueno,
      colmado,
      (tx) => tx<{ monto: string; itbis: string; total: string }[]>`
      select monto_facturado::text as monto, itbis_facturado::text as itbis, total::text
      from public.dgii_607 where ncf = 'B0200000901'`,
    )
    expect(Number(f!.monto)).toBe(900)
    expect(Number(f!.itbis)).toBe(162)
    expect(Number(f!.monto) + Number(f!.itbis)).toBe(Number(f!.total))
  })

  it('una factura con la convencion vieja (subtotal bruto) tambien declara la base neta', async () => {
    // FAC-DEMO-0002 del seed: bruto 42,000, descuento 2,000, ITBIS 7,200.
    // La base declarable es 40,000 en las dos convenciones: total - ITBIS.
    await sql`
      insert into public.customer_invoices
        (tenant_id, number, customer_id, source_type, issue_date, due_date,
         subtotal, discount, tax, total, status, ncf, ncf_type)
      values (${ferreteria}, ${`FAC-${RUN}-B`}, ${clienteFerre}, 'manual', '2026-08-10', '2026-09-09',
              42000.00, 2000.00, 7200.00, 47200.00, 'open', 'B0100000777', 'B01')`
    const [f] = await as(
      contador,
      ferreteria,
      (tx) => tx<{ monto: string }[]>`
      select monto_facturado::text as monto from public.dgii_607 where ncf = 'B0100000777'`,
    )
    expect(Number(f!.monto)).toBe(40000)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Periodo y fecha del comprobante: el dia de Santo Domingo', () => {
  it('public.fecha_fiscal() convierte a la hora de RD', async () => {
    const [r] = await sql<{ d: string }[]>`
      select public.fecha_fiscal('2026-10-01 01:00:00+00')::text as d`
    expect(r!.d).toBe('2026-09-30')
  })

  it('venta del 30 de septiembre a las 9 p. m.: 607 de septiembre, fechada el 30', async () => {
    await sql`
      insert into public.pos_sales
        (tenant_id, shift_id, number, subtotal, discount, tax, total, cashier_id,
         ncf, ncf_type, created_at, sold_at)
      values (${colmado}, ${turnoColmado}, ${`N-${RUN}`}, 100.00, 0, 18.00, 118.00, ${cajero},
              'B0200000930', 'B02', '2026-09-30 21:00-04', '2026-09-30 21:00-04')`
    const [f] = await as(
      dueno,
      colmado,
      (tx) => tx<{ periodo: string; fecha: string }[]>`
      select periodo, fecha_comprobante as fecha from public.dgii_607 where ncf = 'B0200000930'`,
    )
    expect(f).toEqual({ periodo: '202609', fecha: '20260930' })
  })

  it('una venta offline se declara el dia que se VENDIO, no el que se sincronizo', async () => {
    await sql`
      insert into public.pos_sales
        (tenant_id, shift_id, number, subtotal, discount, tax, total, cashier_id,
         ncf, ncf_type, created_at, sold_at, synced_at)
      values (${colmado}, ${turnoColmado}, ${`O-${RUN}`}, 100.00, 0, 18.00, 118.00, ${cajero},
              'B0200000931', 'B02', '2026-10-02 09:00-04', '2026-09-29 18:30-04', '2026-10-02 09:00-04')`
    const [f] = await as(
      dueno,
      colmado,
      (tx) => tx<{ periodo: string; fecha: string }[]>`
      select periodo, fecha_comprobante as fecha from public.dgii_607 where ncf = 'B0200000931'`,
    )
    expect(f).toEqual({ periodo: '202609', fecha: '20260929' })
  })

  it('el 608 usa la misma fecha que el 607', async () => {
    await sql`
      insert into public.pos_sales
        (tenant_id, shift_id, number, subtotal, discount, tax, total, cashier_id,
         ncf, ncf_type, created_at, sold_at, voided, void_type, void_reason, voided_at)
      values (${colmado}, ${turnoColmado}, ${`V-${RUN}`}, 50.00, 0, 9.00, 59.00, ${cajero},
              'B0200000932', 'B02', '2026-09-30 21:40-04', '2026-09-30 21:40-04',
              true, '4', 'correccion', '2026-09-30 21:45-04')`
    const [f] = await as(
      dueno,
      colmado,
      (tx) => tx<{ periodo: string; fecha: string }[]>`
      select periodo, fecha_comprobante as fecha from public.dgii_608 where ncf = 'B0200000932'`,
    )
    expect(f).toEqual({ periodo: '202609', fecha: '20260930' })
  })

  it('606: un pago del 30 a las 9:30 p. m. se fecha el 30', async () => {
    const [si] = await sql<{ id: string }[]>`
      insert into public.supplier_invoices
        (tenant_id, supplier_id, supplier_invoice_number, supplier_ncf, issue_date, due_date,
         subtotal, tax, total, expense_type)
      values (${ferreteria}, ${proveedorFerre}, ${`P-${RUN}`}, 'B0100004400', '2026-09-28', '2026-10-28',
              1000.00, 180.00, 1180.00, '09')
      returning id`
    await sql`
      insert into public.supplier_payments (tenant_id, invoice_id, amount, method, paid_at)
      values (${ferreteria}, ${si!.id}, 1180.00, 'cash', '2026-09-30 21:30-04')`
    const [f] = await as(
      contador,
      ferreteria,
      (tx) => tx<{ fecha_pago: string }[]>`
      select fecha_pago from public.dgii_606 where ncf = 'B0100004400'`,
    )
    expect(f!.fecha_pago).toBe('20260930')
  })

  it('una factura sin fecha toma el dia de RD aunque el servidor ya este en mañana', async () => {
    // Kiritimati va 14 horas por delante de UTC: su `current_date` es
    // mañana casi todo el dia, que es lo que le pasa a UTC desde las 8 p. m.
    // de RD. Emular eso con la zona de la sesion hace la prueba determinista.
    const fila = await sql.begin(async (tx) => {
      await tx.unsafe(`set local timezone = 'Pacific/Kiritimati'`)
      const [r] = await tx<{ emitida: string; rd: string }[]>`
        insert into public.customer_invoices
          (tenant_id, number, customer_id, source_type, due_date, subtotal, tax, total)
        values (${ferreteria}, ${`FAC-${RUN}-HOY`}, ${clienteFerre}, 'manual',
                (now() at time zone 'America/Santo_Domingo')::date + 30, 100, 18, 118)
        returning issue_date::text as emitida,
                  (now() at time zone 'America/Santo_Domingo')::date::text as rd`
      return r!
    })
    expect(fila.emitida).toBe(fila.rd)
  })

  it('assign_ncf deja emitir el ultimo dia de la autorizacion hasta la medianoche de RD', async () => {
    await sql`
      insert into public.ncf_sequences
        (tenant_id, ncf_type, range_from, range_to, next_number, expires_on)
      values (${colmado}, 'B14', 1, 10, 1, (now() at time zone 'America/Santo_Domingo')::date)`
    const ncf = await sql.begin(async (tx) => {
      await tx.unsafe(`set local timezone = 'Pacific/Kiritimati'`)
      await tx`select set_config('request.jwt.claims', ${claims(cajero, colmado)}, true)`
      await tx.unsafe('set local role authenticated')
      const [r] = await tx<{ assign_ncf: string }[]>`select public.assign_ncf(${colmado}, 'B14')`
      return r!.assign_ncf
    })
    expect(ncf).toBe('B1400000001')
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Secuencias NCF: conviven, se consumen en orden y no se pisan', () => {
  const emitir = (tipo: string) =>
    as(cajero, colmado, async (tx) => {
      const [r] = await tx<{ assign_ncf: string }[]>`select public.assign_ncf(${colmado}, ${tipo})`
      return r!.assign_ncf
    })

  it('el dueño carga DOS rangos B02 vigentes y los dos quedan activos', async () => {
    await as(
      dueno,
      colmado,
      (tx) => tx`
        insert into public.ncf_sequences
          (tenant_id, ncf_type, range_from, range_to, next_number, expires_on, authorization_ref)
        values (${colmado}, 'B02', 1, 2, 1, '2027-12-31', 'AUT-1'),
               (${colmado}, 'B02', 3, 5, 3, '2027-12-31', 'AUT-2')`,
      rolDueno,
    )
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.ncf_sequences
      where tenant_id = ${colmado} and ncf_type = 'B02' and is_active`
    expect(n!.n).toBe(2)
  })

  it('se agota el mas antiguo primero y despues sigue el otro, sin huecos', async () => {
    expect(await emitir('B02')).toBe('B0200000001')
    expect(await emitir('B02')).toBe('B0200000002')
    expect(await emitir('B02')).toBe('B0200000003')
  })

  it('un rango que se cruza con otro vigente del mismo tipo se rechaza', async () => {
    await expect(
      as(
        dueno,
        colmado,
        (tx) => tx`
          insert into public.ncf_sequences
            (tenant_id, ncf_type, range_from, range_to, next_number, expires_on)
          values (${colmado}, 'B02', 4, 50, 4, '2027-12-31')`,
        rolDueno,
      ),
    ).rejects.toThrow(/se cruza/)
  })

  it('otro tipo con los mismos numeros no se cruza', async () => {
    await as(
      dueno,
      colmado,
      (tx) => tx`
        insert into public.ncf_sequences
          (tenant_id, ncf_type, range_from, range_to, next_number, expires_on)
        values (${colmado}, 'B01', 1, 50, 1, '2027-12-31')`,
      rolDueno,
    )
  })

  it('el cajero NO puede cargar una secuencia por su cuenta (PostgREST con su token)', async () => {
    await expect(
      as(
        cajero,
        colmado,
        (tx) => tx`
          insert into public.ncf_sequences
            (tenant_id, ncf_type, range_from, range_to, next_number, expires_on)
          values (${colmado}, 'B15', 1, 50, 1, '2027-12-31')`,
        rolCajero,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('el cajero sigue viendo y bloqueando la secuencia antes de vender (lo que hace cobrarVenta)', async () => {
    const filas = await as(
      cajero,
      colmado,
      (tx) => tx<{ id: string }[]>`
        select id from public.ncf_sequences
        where tenant_id = ${colmado} and ncf_type = 'B02' and is_active
          and expires_on >= current_date and next_number <= range_to
        for update`,
      rolCajero,
    )
    expect(filas.length).toBeGreaterThan(0)
  })

  it('el cajero con su token emite por assign_ncf, que avanza de uno en uno', async () => {
    const ncf = await as(
      cajero,
      colmado,
      async (tx) => {
        const [r] = await tx<{ assign_ncf: string }[]>`select public.assign_ncf(${colmado}, 'B02')`
        return r!.assign_ncf
      },
      rolCajero,
    )
    expect(ncf).toBe('B0200000004')
  })

  it('nadie mueve el proximo numero a mano: ni para atras (duplicados) ni saltando (huecos)', async () => {
    for (const expr of ['next_number - 1', 'next_number + 5']) {
      await expect(
        as(
          dueno,
          colmado,
          (tx) =>
            tx.unsafe(
              `update public.ncf_sequences set next_number = ${expr}
             where tenant_id = $1 and ncf_type = 'B02' and range_from = 3`,
              [colmado],
            ),
          rolDueno,
        ),
      ).rejects.toThrow(/proximo numero|permission denied/)
    }
  })

  it('el vencimiento no se cambia con un UPDATE directo', async () => {
    await expect(
      as(
        dueno,
        colmado,
        (tx) => tx`
          update public.ncf_sequences set expires_on = '2030-01-01'
          where tenant_id = ${colmado} and ncf_type = 'B02' and range_from = 3`,
        rolDueno,
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('se corrige el vencimiento con motivo, sin tocar los numeros emitidos, y queda en la bitacora', async () => {
    const [s] = await sql<{ id: string; next_number: number }[]>`
      select id, next_number from public.ncf_sequences
      where tenant_id = ${colmado} and ncf_type = 'B02' and range_from = 3`
    await as(
      dueno,
      colmado,
      (tx) => tx`
        select public.ajustar_secuencia_ncf(${s!.id}, '2028-06-30', true,
          'La DGII extendio la autorizacion AUT-2')`,
      rolDueno,
    )
    const [d] = await sql<{ expires_on: string; next_number: number; motivo: string }[]>`
      select expires_on::text, next_number, adjusted_reason as motivo
      from public.ncf_sequences where id = ${s!.id}`
    expect(d).toEqual({
      expires_on: '2028-06-30',
      next_number: s!.next_number,
      motivo: 'La DGII extendio la autorizacion AUT-2',
    })
    const [log] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit.log
      where tenant_id = ${colmado} and entity = 'ncf_sequences' and entity_id = ${s!.id}
        and action = 'update' and after ->> 'adjusted_reason' = 'La DGII extendio la autorizacion AUT-2'`
    expect(log!.n).toBe(1)
  })

  it('sin motivo no se corrige nada', async () => {
    const [s] = await sql<{ id: string }[]>`
      select id from public.ncf_sequences
      where tenant_id = ${colmado} and ncf_type = 'B02' and range_from = 3`
    await expect(
      as(
        dueno,
        colmado,
        (tx) => tx`select public.ajustar_secuencia_ncf(${s!.id}, '2029-01-01', true, '  ')`,
        rolDueno,
      ),
    ).rejects.toThrow(/motivo/)
  })

  it('el cajero no puede ajustar una secuencia', async () => {
    const [s] = await sql<{ id: string }[]>`
      select id from public.ncf_sequences
      where tenant_id = ${colmado} and ncf_type = 'B02' and range_from = 3`
    await expect(
      as(
        cajero,
        colmado,
        (tx) => tx`select public.ajustar_secuencia_ncf(${s!.id}, null, false, 'la apago yo')`,
        rolCajero,
      ),
    ).rejects.toThrow(/Tu rol no/)
  })

  it('desactivada a mano con motivo ya no emite, y su tramo usado no se puede volver a cargar', async () => {
    const [s] = await sql<{ id: string }[]>`
      select id from public.ncf_sequences
      where tenant_id = ${colmado} and ncf_type = 'B01' and range_from = 1`
    // Se emite uno para que tenga un tramo usado (el 1).
    expect(await emitir('B01')).toBe('B0100000001')
    await as(
      dueno,
      colmado,
      (tx) => tx`select public.ajustar_secuencia_ncf(${s!.id}, null, false, 'Rango mal digitado')`,
      rolDueno,
    )
    await expect(emitir('B01')).rejects.toThrow(/No hay secuencia activa/)

    // El 1 ya se emitio: un rango que lo incluya repetiria un NCF.
    await expect(
      as(
        dueno,
        colmado,
        (tx) => tx`
          insert into public.ncf_sequences
            (tenant_id, ncf_type, range_from, range_to, next_number, expires_on)
          values (${colmado}, 'B01', 1, 100, 1, '2027-12-31')`,
        rolDueno,
      ),
    ).rejects.toThrow(/ya se emitieron/)

    // Lo que nunca se uso de la desactivada si se puede volver a cargar.
    await as(
      dueno,
      colmado,
      (tx) => tx`
        insert into public.ncf_sequences
          (tenant_id, ncf_type, range_from, range_to, next_number, expires_on)
        values (${colmado}, 'B01', 2, 100, 2, '2027-12-31')`,
      rolDueno,
    )
    expect(await emitir('B01')).toBe('B0100000002')
  })

  it('los numeros ya emitidos no se tocan al desactivar', async () => {
    const [d] = await sql<{ next_number: number; is_active: boolean; motivo: string }[]>`
      select next_number, is_active, adjusted_reason as motivo from public.ncf_sequences
      where tenant_id = ${colmado} and ncf_type = 'B01' and range_from = 1`
    expect(d).toEqual({ next_number: 2, is_active: false, motivo: 'Rango mal digitado' })
  })

  it('agotadas todas, el error dice agotada; vencidas todas, dice vencida', async () => {
    // B02: quedan el 5 (rango 3-5). Se agota.
    expect(await emitir('B02')).toBe('B0200000005')
    await expect(emitir('B02')).rejects.toThrow(/agotaron/)

    await sql`
      insert into public.ncf_sequences
        (tenant_id, ncf_type, range_from, range_to, next_number, expires_on)
      values (${colmado}, 'B16', 1, 10, 1, '2020-01-01')`
    await expect(emitir('B16')).rejects.toThrow(/vencio/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Aislamiento de las secuencias', () => {
  it('la ferreteria no ve, no cambia y no borra las del colmado', async () => {
    const vistas = await as(
      contador,
      ferreteria,
      (tx) => tx`select id from public.ncf_sequences where tenant_id = ${colmado}`,
    )
    const cambiadas = await as(
      contador,
      ferreteria,
      (tx) => tx`
        update public.ncf_sequences set next_number = next_number + 1
        where tenant_id = ${colmado} returning id`,
    )
    // Borrar puede fallar por privilegio o no encontrar filas por RLS: las
    // dos son "0 borradas". Lo que no puede es borrar.
    const borradas = await as(
      contador,
      ferreteria,
      (tx) => tx`delete from public.ncf_sequences where tenant_id = ${colmado} returning id`,
    ).catch((e: Error) => {
      expect(e.message).toMatch(/permission denied/)
      return []
    })
    expect([vistas.length, cambiadas.length, borradas.length]).toEqual([0, 0, 0])
    const [quedan] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.ncf_sequences where tenant_id = ${colmado}`
    expect(quedan!.n).toBeGreaterThan(0)
  })

  it('nadie borra una secuencia desde la app: su historial es de auditoria', async () => {
    await expect(
      as(
        dueno,
        colmado,
        (tx) => tx`delete from public.ncf_sequences where tenant_id = ${colmado} returning id`,
        rolDueno,
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('con pos apagado (y sin ar) el colmado no ve sus secuencias', async () => {
    await sql`update regb.tenant_modules set enabled = false
              where tenant_id = ${colmado} and module_id = 'pos'`
    try {
      const filas = await as(dueno, colmado, (tx) => tx`select id from public.ncf_sequences`)
      expect(filas).toHaveLength(0)
    } finally {
      await sql`update regb.tenant_modules set enabled = true
                where tenant_id = ${colmado} and module_id = 'pos'`
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Ventas que un modulo apagado esconde', () => {
  it('con ar apagado, la ferreteria sabe que tiene facturas del periodo que no ve', async () => {
    await sql`
      insert into public.customer_invoices
        (tenant_id, number, customer_id, source_type, issue_date, due_date,
         subtotal, discount, tax, total, status, ncf, ncf_type)
      values (${ferreteria}, ${`FAC-${RUN}-OC`}, ${clienteFerre}, 'manual', '2026-07-10', '2026-08-09',
              1000, 0, 180, 1180, 'open', 'B0100000555', 'B01')`

    const visibles = await as(
      contador,
      ferreteria,
      (tx) => tx<{ modulo: string }[]>`
      select modulo from public.ventas_fuera_de_vista('202607')`,
    )
    expect(visibles).toEqual([])

    await sql`update regb.tenant_modules set enabled = false
              where tenant_id = ${ferreteria} and module_id = 'ar'`
    try {
      const ocultas = await as(
        contador,
        ferreteria,
        (tx) => tx<{ modulo: string; documentos: number }[]>`
        select modulo, documentos::int from public.ventas_fuera_de_vista('202607')`,
      )
      expect(ocultas).toEqual([{ modulo: 'ar', documentos: 1 }])
    } finally {
      await sql`update regb.tenant_modules set enabled = true
                where tenant_id = ${ferreteria} and module_id = 'ar'`
    }
  })

  it('el colmado (sin ar, nunca lo tuvo) no tiene nada escondido', async () => {
    const ocultas = await as(
      dueno,
      colmado,
      (tx) => tx<{ modulo: string }[]>`
      select modulo from public.ventas_fuera_de_vista('202609')`,
    )
    expect(ocultas).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('606: retencion de ISR con su tipo', () => {
  it('retener ISR sin decir de que tipo se rechaza: el 606 no lo puede declarar', async () => {
    await expect(sql`
      insert into public.supplier_invoices
        (tenant_id, supplier_id, supplier_invoice_number, supplier_ncf, issue_date, due_date,
         subtotal, tax, total, retention_amount, isr_retained)
      values (${ferreteria}, ${proveedorFerre}, ${`H-${RUN}`}, 'B1100000001', '2026-09-01', '2026-10-01',
              8000, 1440, 9440, 800, 800)`).rejects.toThrow(/isr_con_tipo/)
  })
})
