import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { PROPOSITOS_CONTABLES } from '@regb/operations'
import { asUser, db } from '@/lib/db'
import { despachar } from '@/lib/despachador'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { abrirTurno, anularVenta, cobrarVenta } from '../pos/actions'
import {
  anularFactura,
  aplicarCargoPorMora,
  emitirNotaDeCredito,
  facturarPedido,
  registrarCobro,
  reversarCobro,
} from '../cobrar/actions'
import {
  anularFactura as anularFacturaProveedor,
  registrarFactura,
  registrarPago,
} from '../pagar/actions'
import {
  agregarLinea,
  alternarCuenta,
  crearAsiento,
  crearCuenta,
  crearCuentasPorDefecto,
  guardarMapaCuenta,
} from './actions'
import { filasBalanza } from './consultas'

/**
 * Contabilidad automatica, de punta a punta y con las acciones REALES:
 * la caja cobra, cuentas por cobrar factura y cobra, cuentas por pagar
 * registra y paga -cada una en su transaccion, dejando su evento en el
 * outbox- y el DESPACHADOR real (el mismo que corre /control/salud o el
 * cron) los reparte. Contabilidad no se llama desde ninguna de esas
 * acciones: escucha.
 *
 * Lo que se demuestra:
 *  - cada hecho genera EXACTAMENTE su asiento, contabilizado y cuadrado,
 *    con las cuentas del mapa del cliente;
 *  - repetir el evento (entrega at-least-once) no duplica;
 *  - anular genera el reverso;
 *  - un cliente sin `accounting` no falla ni recibe asientos;
 *  - un mapa roto hace reintentar el evento, y el asiento sale solo
 *    cuando se corrige;
 *  - la balanza no suma borradores;
 *  - la partida doble la exige la base, no solo la pantalla.
 */

let c: ClientePrueba
let sin: ClientePrueba
const ctx: Record<string, { almacen: string; producto: string; turno: string }> = {}

// ── Utilidades ──────────────────────────────────────────────────────────

async function prepararCaja(cli: ClientePrueba): Promise<void> {
  const sql = db()
  const [w] = await sql<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name, is_default)
    values (${cli.tenantId}, 'Almacen principal', true) returning id`
  const [p] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, price, cost, tax_rate, tracks_stock)
    values (${cli.tenantId}, 'ARROZ-5LB', 'Arroz selecto 5 lb', 100, 60, 0.18, true) returning id`
  // Existencia inicial con costo: el promedio queda en 60.
  await sql`
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, reference_type)
    values (${cli.tenantId}, ${w!.id}, ${p!.id}, 'receipt', 50, 60, 'prueba')`

  const r = await abrirTurno(cli.fd({ warehouseId: w!.id, openingFloat: '1000' }))
  expect(r).toEqual({ ok: true })
  const [t] = await sql<{ id: string }[]>`
    select id from public.pos_shifts where tenant_id = ${cli.tenantId} and status = 'open'`
  ctx[cli.tenantId] = { almacen: w!.id, producto: p!.id, turno: t!.id }
}

async function vender(
  cli: ClientePrueba,
  pagos: { method: string; amount: number }[],
  qty = 2,
): Promise<string> {
  const k = ctx[cli.tenantId]!
  const r = await cobrarVenta(
    cli.fd({
      shiftId: k.turno,
      cart: JSON.stringify([{ productId: k.producto, qty, discountPct: 0 }]),
      payments: JSON.stringify(pagos),
    }),
  )
  expect(r.ok).toBe(true)
  if (!r.ok || !r.venta) throw new Error('la venta no devolvio su id')
  return r.venta.id
}

/**
 * El despachador real, hasta vaciar lo que esta listo. Reclama eventos
 * de TODOS los clientes de la base -es lo que hace en produccion-; por
 * eso se repite hasta que no quede nada listo, no una sola vez.
 */
async function procesarEventos(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const r = await despachar(200)
    if (r.reclamados === 0) return
  }
}

interface LineaVista {
  code: string
  debit: number
  credit: number
}

async function asientosDe(sourceType: string, sourceId: string) {
  return db()<{ id: string; status: string; number: string; entry_date: string }[]>`
    select id, status, number, entry_date::text from public.journal_entries
    where source_type = ${sourceType} and source_id = ${sourceId}`
}

async function lineasDe(entryId: string): Promise<LineaVista[]> {
  const filas = await db()<{ code: string; debit: string; credit: string }[]>`
    select a.code, l.debit::text, l.credit::text
    from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
    where l.entry_id = ${entryId}
    order by a.code, l.debit desc`
  return filas.map((f) => ({ code: f.code, debit: Number(f.debit), credit: Number(f.credit) }))
}

/** Un asiento por origen, contabilizado, cuadrado, y sus lineas. */
async function unAsiento(sourceType: string, sourceId: string): Promise<LineaVista[]> {
  const a = await asientosDe(sourceType, sourceId)
  expect(a).toHaveLength(1)
  expect(a[0]!.status).toBe('posted')
  const l = await lineasDe(a[0]!.id)
  const d = l.reduce((s, x) => s + x.debit, 0)
  const cr = l.reduce((s, x) => s + x.credit, 0)
  expect(Math.round(d * 100)).toBe(Math.round(cr * 100))
  return l
}

async function cuentaPorCodigo(cli: ClientePrueba, code: string): Promise<string> {
  const [a] = await db()<{ id: string }[]>`
    select id from public.accounts where tenant_id = ${cli.tenantId} and code = ${code}`
  return a!.id
}

async function eventoDe(tipo: string, clave: string, valor: string) {
  const [e] = await db()<
    {
      id: string
      processed_at: string | null
      attempts: number
      last_error: string | null
      dead_lettered_at: string | null
      next_attempt_at: string
    }[]
  >`
    select id::text, processed_at::text, attempts, last_error, dead_lettered_at::text,
           next_attempt_at::text
    from public.event_outbox
    where type = ${tipo} and payload ->> ${clave} = ${valor}
    order by id desc limit 1`
  return e
}

async function ncf(cli: ClientePrueba): Promise<void> {
  await db()`
    insert into public.ncf_sequences (tenant_id, ncf_type, range_from, range_to, next_number, expires_on)
    values (${cli.tenantId}, 'B01', 1, 500, 1, current_date + 365),
           (${cli.tenantId}, 'B02', 1, 500, 1, current_date + 365),
           (${cli.tenantId}, 'B04', 1, 500, 1, current_date + 365)`
}

/**
 * Un pedido ya ENTREGADO -la entrega es de `sales-orders`, no de esta
 * prueba- de `unidades` sacos a RD$100 + 18%: `facturarPedido` (0130)
 * factura lo entregado, linea por linea.
 */
async function pedidoEntregado(cli: ClientePrueba, numero: string, unidades: number) {
  const sql = db()
  const [cliente] = await sql<{ id: string }[]>`
    insert into public.customers (tenant_id, name, payment_terms)
    values (${cli.tenantId}, ${'Ferreteria El Martillo ' + numero}, 30) returning id`
  const neto = unidades * 100
  const [o] = await sql<{ id: string }[]>`
    insert into public.sales_orders
      (tenant_id, number, customer_id, warehouse_id, status, subtotal, tax, total)
    values (${cli.tenantId}, ${numero}, ${cliente!.id}, ${ctx[cli.tenantId]!.almacen},
            'delivered', ${neto}, ${neto * 0.18}, ${neto * 1.18})
    returning id`
  await sql`
    insert into public.sales_order_lines
      (order_id, tenant_id, product_id, qty_ordered, qty_delivered, unit_price, tax_rate, line_total)
    values (${o!.id}, ${cli.tenantId}, ${ctx[cli.tenantId]!.producto}, ${unidades}, ${unidades},
            100, 0.18, ${neto * 1.18})`
  return o!.id
}

async function facturaDe(cli: ClientePrueba, orderId: string): Promise<string> {
  const [f] = await db()<{ id: string }[]>`
    select id from public.customer_invoices where tenant_id = ${cli.tenantId} and source_id = ${orderId}`
  return f!.id
}

// ── Siembra ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-conta',
    nombre: 'Distribuidora Contable SRL',
    modulos: [
      'products',
      'inventory',
      'pos',
      'sales-orders',
      'ar',
      'ap',
      'suppliers',
      'purchase-orders',
      'accounting',
    ],
    roles: { Encargado: { '*': true } },
  })
  sin = await sembrarCliente({
    prefijo: 'accion-conta',
    nombre: 'Colmado Sin Contabilidad',
    modulos: ['products', 'inventory', 'pos'],
    roles: { Cajero: { '*': true } },
  })
  await prepararCaja(c)
  await prepararCaja(sin)
  await ncf(c)
})

afterAll(async () => {
  const sql = db()
  for (const cli of [c, sin]) {
    if (!cli) continue
    // El kardex, los asientos y las ventas no caen solos con el tenant:
    // sus triggers de inmutabilidad los protegen incluso del borrado en
    // cascada, asi que se desactivan SOLO para barrer la prueba.
    // Todas las tablas de public con tenant_id, sin lista a mano: los
    // modulos que toca esta prueba (caja, cartera, notas, mora, proveedores)
    // crecen con cada migracion. Luego `limpiar()` borra el tenant FUERA del
    // modo replica, para que la cascada de regb.* si corra.
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`
      const tablas = await tx<{ t: string }[]>`
        select c.table_name as t from information_schema.columns c
        join information_schema.tables tb
          on tb.table_schema = c.table_schema and tb.table_name = c.table_name
         and tb.table_type = 'BASE TABLE'
        where c.table_schema = 'public' and c.column_name = 'tenant_id'`
      for (const { t } of tablas) {
        await tx.unsafe(`delete from public."${t}" where tenant_id = $1`, [cli.tenantId])
      }
    })
    await cli.limpiar()
  }
  await cerrarBase()
})

// ═══════════════════════════════════════════════════════════════════════

describe('el mapa contable', () => {
  it('los defaults de la base son los mismos que los de @regb/operations', async () => {
    const filas = await db()<{ purpose: string; code: string; type: string }[]>`
      select purpose, code, type from public.cuentas_contables_por_defecto() order by purpose`
    const ts = PROPOSITOS_CONTABLES.map((p) => ({
      purpose: p.proposito,
      code: p.codigo,
      type: p.tipo,
    })).sort((a, b) => a.purpose.localeCompare(b.purpose))
    expect(filas).toEqual(ts)
  })
})

describe('venta de caja (pos.sale.completed)', () => {
  let venta: string

  it('genera UN asiento: caja contra ventas e ITBIS, y costo contra inventario', async () => {
    venta = await vender(c, [{ method: 'cash', amount: 236 }])
    await procesarEventos()

    const l = await unAsiento('pos_sale', venta)
    expect(l).toEqual([
      { code: '1101', debit: 236, credit: 0 }, // Caja
      { code: '1104', debit: 0, credit: 120 }, // Inventario (2 x 60)
      { code: '2101', debit: 0, credit: 36 }, // ITBIS por pagar
      { code: '4101', debit: 0, credit: 200 }, // Ventas
      { code: '5101', debit: 120, credit: 0 }, // Costo de ventas
    ])

    // El mapa se sembro solo con el catalogo minimo, en la primera venta.
    const [m] = await db()<{ n: number }[]>`
      select count(*)::int as n from public.accounting_account_map where tenant_id = ${c.tenantId}`
    expect(m!.n).toBe(PROPOSITOS_CONTABLES.length)
  })

  it('el evento repetido (entrega at-least-once) NO duplica el asiento', async () => {
    const e = await eventoDe('pos.sale.completed', 'saleId', venta)
    expect(e!.processed_at).not.toBeNull()
    // Lo que pasa si el proceso muere despues de actuar y antes de marcar:
    // el evento vuelve a quedar pendiente y se entrega otra vez.
    await db()`
      update public.event_outbox set processed_at = null, next_attempt_at = now()
      where id = ${e!.id}::bigint`
    await procesarEventos()

    expect((await eventoDe('pos.sale.completed', 'saleId', venta))!.processed_at).not.toBeNull()
    expect(await asientosDe('pos_sale', venta)).toHaveLength(1)
  })

  it('un asiento automatico es inmutable como cualquier otro', async () => {
    const [a] = await asientosDe('pos_sale', venta)
    await expect(db()`delete from public.journal_entries where id = ${a!.id}`).rejects.toThrow(
      /inmutable|no se edita/i,
    )
  })

  it('anular la venta genera el reverso exacto, y los dos suman cero', async () => {
    const r = await anularVenta(
      c.fd({ saleId: venta, reason: 'Cliente devolvio el arroz', voidType: '6' }),
    )
    expect(r).toEqual({ ok: true })
    await procesarEventos()

    const rev = await unAsiento('pos_sale_void', venta)
    expect(rev).toEqual([
      { code: '1101', debit: 0, credit: 236 },
      { code: '1104', debit: 120, credit: 0 },
      { code: '2101', debit: 36, credit: 0 },
      { code: '4101', debit: 200, credit: 0 },
      { code: '5101', debit: 0, credit: 120 },
    ])
  })

  it('pago mixto: el efectivo a caja y la tarjeta al banco', async () => {
    const v = await vender(c, [
      { method: 'cash', amount: 100 },
      { method: 'card', amount: 136 },
    ])
    await procesarEventos()
    const l = await unAsiento('pos_sale', v)
    expect(l.filter((x) => x.debit > 0 && x.code !== '5101')).toEqual([
      { code: '1101', debit: 100, credit: 0 },
      { code: '1103', debit: 136, credit: 0 },
    ])
  })
})

describe('credito: factura, cobro, reverso, nota de credito, mora y anulacion (ar.*)', () => {
  let factura: string
  let cobroEfectivo: string

  it('la factura a credito genera CxC contra ventas + ITBIS', async () => {
    const orden = await pedidoEntregado(c, 'PED-CONTA-1', 100)
    expect(await facturarPedido(c.fd({ orderId: orden }))).toEqual({ ok: true })
    factura = await facturaDe(c, orden)
    await procesarEventos()

    expect(await unAsiento('ar_invoice', factura)).toEqual([
      { code: '1102', debit: 11800, credit: 0 },
      { code: '2101', debit: 0, credit: 1800 },
      { code: '4101', debit: 0, credit: 10000 },
    ])
  })

  it('cada cobro -tambien el parcial- genera su asiento de caja/banco contra CxC', async () => {
    expect(
      await registrarCobro(c.fd({ invoiceId: factura, amount: '5000', method: 'transfer' })),
    ).toEqual({ ok: true })
    expect(
      await registrarCobro(c.fd({ invoiceId: factura, amount: '6800', method: 'cash' })),
    ).toEqual({ ok: true })
    await procesarEventos()

    const cobros = await db()<{ id: string; amount: string }[]>`
      select id, amount::text from public.customer_payments
      where invoice_id = ${factura} order by amount`
    expect(cobros).toHaveLength(2)
    expect(await unAsiento('ar_payment', cobros[0]!.id)).toEqual([
      { code: '1102', debit: 0, credit: 5000 },
      { code: '1103', debit: 5000, credit: 0 },
    ])
    expect(await unAsiento('ar_payment', cobros[1]!.id)).toEqual([
      { code: '1101', debit: 6800, credit: 0 },
      { code: '1102', debit: 0, credit: 6800 },
    ])
    cobroEfectivo = cobros[1]!.id
  })

  it('reversar un cobro mal digitado reversa su asiento', async () => {
    expect(
      await reversarCobro(c.fd({ paymentId: cobroEfectivo, reason: 'Se digito 6800 y eran 680' })),
    ).toEqual({ ok: true })
    await procesarEventos()

    expect(await unAsiento('ar_payment_reversal', cobroEfectivo)).toEqual([
      { code: '1101', debit: 0, credit: 6800 },
      { code: '1102', debit: 6800, credit: 0 },
    ])
  })

  it('la nota de credito rebaja ventas e ITBIS contra la cartera', async () => {
    // Rebaja de RD$1,180 con ITBIS sobre una factura con saldo de 6,800.
    expect(
      await emitirNotaDeCredito(
        c.fd({
          invoiceId: factura,
          kind: 'adjustment',
          amount: '1180',
          reason: 'Descuento por pronto pago',
        }),
      ),
    ).toEqual({ ok: true })
    const [n] = await db()<{ id: string }[]>`
      select id from public.customer_credit_notes where invoice_id = ${factura}`
    await procesarEventos()

    expect(await unAsiento('ar_credit_note', n!.id)).toEqual([
      { code: '1102', debit: 0, credit: 1180 },
      { code: '2101', debit: 180, credit: 0 },
      { code: '4101', debit: 1000, credit: 0 },
    ])
  })

  it('un cargo por mora sube la cartera contra un ingreso aparte', async () => {
    const orden = await pedidoEntregado(c, 'PED-CONTA-3', 10)
    expect(await facturarPedido(c.fd({ orderId: orden }))).toEqual({ ok: true })
    const vencida = await facturaDe(c, orden)
    // Vencio hace 20 dias (se mueve la fecha: esperar 30 dias no cabe en una prueba).
    await db()`
      update public.customer_invoices
      set issue_date = current_date - 50, due_date = current_date - 20
      where id = ${vencida}`
    expect(
      await aplicarCargoPorMora(
        c.fd({ invoiceId: vencida, amount: '250', notes: '20 dias de atraso' }),
      ),
    ).toEqual({ ok: true })
    const [m] = await db()<{ id: string }[]>`
      select id from public.invoice_late_fees where invoice_id = ${vencida}`
    await procesarEventos()

    expect(await unAsiento('ar_late_fee', m!.id)).toEqual([
      { code: '1102', debit: 250, credit: 0 },
      { code: '4201', debit: 0, credit: 250 },
    ])
  })

  it('anular una factura sin cobros genera su reverso', async () => {
    const orden = await pedidoEntregado(c, 'PED-CONTA-2', 5)
    expect(await facturarPedido(c.fd({ orderId: orden }))).toEqual({ ok: true })
    const f = { id: await facturaDe(c, orden) }
    expect(
      await anularFactura(
        c.fd({ invoiceId: f!.id, reason: 'Se facturo al cliente equivocado', voidType: '4' }),
      ),
    ).toEqual({ ok: true })
    await procesarEventos()

    expect(await unAsiento('ar_invoice', f!.id)).toHaveLength(3)
    expect(await unAsiento('ar_invoice_void', f!.id)).toEqual([
      { code: '1102', debit: 0, credit: 590 },
      { code: '2101', debit: 90, credit: 0 },
      { code: '4101', debit: 500, credit: 0 },
    ])
  })
})

describe('proveedor: factura y pago (ap.*)', () => {
  let proveedor: string
  let factura: string

  beforeAll(async () => {
    const [s] = await db()<{ id: string }[]>`
      insert into public.suppliers (tenant_id, name, tax_id, payment_terms)
      values (${c.tenantId}, 'Molinos del Cibao SRL', '101000001', 30) returning id`
    proveedor = s!.id
  })

  it('la factura de mercancia va a inventario + ITBIS adelantado contra CxP', async () => {
    expect(
      await registrarFactura(
        c.fd({
          supplierId: proveedor,
          supplierInvoiceNumber: 'F-0001',
          supplierNcf: 'B0100000001',
          expenseType: '09', // compras que forman parte del costo de venta
          subtotal: '10000',
          tax: '1800',
        }),
      ),
    ).toEqual({ ok: true })
    const [f] = await db()<{ id: string }[]>`
      select id from public.supplier_invoices
      where tenant_id = ${c.tenantId} and supplier_invoice_number = 'F-0001'`
    factura = f!.id
    await procesarEventos()

    expect(await unAsiento('ap_invoice', factura)).toEqual([
      { code: '1104', debit: 10000, credit: 0 },
      { code: '1105', debit: 1800, credit: 0 },
      { code: '2102', debit: 0, credit: 11800 },
    ])
  })

  it('el pago salda la CxP contra el banco', async () => {
    expect(
      await registrarPago(c.fd({ invoiceId: factura, amount: '11800', method: 'transfer' })),
    ).toEqual({ ok: true })
    await procesarEventos()

    const [p] = await db()<{ id: string }[]>`
      select id from public.supplier_payments where invoice_id = ${factura}`
    expect(await unAsiento('ap_payment', p!.id)).toEqual([
      { code: '1103', debit: 0, credit: 11800 },
      { code: '2102', debit: 11800, credit: 0 },
    ])
  })

  it('honorarios con retencion: gasto, y lo retenido (ITBIS e ISR) va a la DGII, no al proveedor', async () => {
    expect(
      await registrarFactura(
        c.fd({
          supplierId: proveedor,
          supplierInvoiceNumber: 'H-0007',
          supplierNcf: 'B1100000007',
          expenseType: '02', // trabajos, suministros y servicios
          subtotal: '10000',
          tax: '1800',
          itbisRetention: '1800',
          isrRetention: '1000',
          isrRetentionType: '02', // honorarios
        }),
      ),
    ).toEqual({ ok: true })
    const [f] = await db()<{ id: string }[]>`
      select id from public.supplier_invoices
      where tenant_id = ${c.tenantId} and supplier_invoice_number = 'H-0007'`
    await procesarEventos()

    expect(await unAsiento('ap_invoice', f!.id)).toEqual([
      { code: '1105', debit: 1800, credit: 0 }, // ITBIS adelantado
      { code: '2102', debit: 0, credit: 9000 }, // al proveedor: 11,800 - 2,800
      { code: '2103', debit: 0, credit: 1800 }, // ITBIS retenido
      { code: '2104', debit: 0, credit: 1000 }, // ISR retenido
      { code: '6101', debit: 10000, credit: 0 }, // Gastos
    ])
  })

  it('anular una factura de proveedor sin pagos genera su reverso', async () => {
    expect(
      await registrarFactura(
        c.fd({
          supplierId: proveedor,
          supplierInvoiceNumber: 'F-0099',
          subtotal: '100',
          tax: '18',
        }),
      ),
    ).toEqual({ ok: true })
    const [f] = await db()<{ id: string }[]>`
      select id from public.supplier_invoices
      where tenant_id = ${c.tenantId} and supplier_invoice_number = 'F-0099'`
    expect(
      await anularFacturaProveedor(c.fd({ invoiceId: f!.id, reason: 'La registramos dos veces' })),
    ).toEqual({ ok: true })
    await procesarEventos()

    expect(await unAsiento('ap_invoice_void', f!.id)).toEqual([
      { code: '1104', debit: 0, credit: 100 },
      { code: '1105', debit: 0, credit: 18 },
      { code: '2102', debit: 118, credit: 0 },
    ])
  })
})

describe('degradacion elegante: cliente sin accounting', () => {
  it('su venta se procesa normal, sin asiento y sin error', async () => {
    const v = await vender(sin, [{ method: 'cash', amount: 118 }], 1)
    await procesarEventos()

    const e = await eventoDe('pos.sale.completed', 'saleId', v)
    expect(e!.processed_at).not.toBeNull()
    expect(e!.last_error).toBeNull()
    expect(e!.dead_lettered_at).toBeNull()

    const [n] = await db()<{ n: number }[]>`
      select count(*)::int as n from public.journal_entries where tenant_id = ${sin.tenantId}`
    expect(n!.n).toBe(0)
    const [m] = await db()<{ n: number }[]>`
      select count(*)::int as n from public.accounts where tenant_id = ${sin.tenantId}`
    expect(m!.n).toBe(0)
  })
})

describe('confiabilidad: un mapa roto se reintenta, no se pierde', () => {
  it('el evento falla con un motivo legible, queda para reintento, y sale al corregir', async () => {
    // La cuenta de Bancos que el mapa usa queda desactivada. Desde la
    // pantalla ya no se puede (alternarCuenta lo niega mientras el mapa la
    // use, ver cuentas-del-mapa.accion.test.ts), pero el despachador tiene
    // que aguantar un mapa roto por cualquier otro camino: se rompe directo.
    const banco = await cuentaPorCodigo(c, '1103')
    expect((await alternarCuenta(c.fd({ id: banco }))).ok).toBe(false)
    await db()`update public.accounts set is_active = false where id = ${banco}`

    const v = await vender(c, [{ method: 'card', amount: 236 }])
    await procesarEventos()

    const fallido = await eventoDe('pos.sale.completed', 'saleId', v)
    expect(fallido!.processed_at).toBeNull()
    expect(fallido!.dead_lettered_at).toBeNull()
    expect(fallido!.attempts).toBe(1)
    expect(fallido!.last_error).toMatch(/1103.*desactivada/i)
    expect(new Date(fallido!.next_attempt_at).getTime()).toBeGreaterThan(Date.now())
    expect(await asientosDe('pos_sale', v)).toHaveLength(0)

    // Un tipo equivocado no se deja mapear: Bancos tiene que ser un activo.
    const ventas = await cuentaPorCodigo(c, '4101')
    const malo = await guardarMapaCuenta(c.fd({ purpose: 'banco', accountId: ventas }))
    expect(malo.ok).toBe(false)
    if (!malo.ok) expect(malo.error).toMatch(/activo/i)

    // La correccion: una cuenta de banco nueva, mapeada desde la pantalla.
    expect(
      await crearCuenta(
        c.fd({ code: '1110', name: 'Banco Popular cta. corriente', type: 'asset' }),
      ),
    ).toEqual({ ok: true })
    const popular = await cuentaPorCodigo(c, '1110')
    expect(await guardarMapaCuenta(c.fd({ purpose: 'banco', accountId: popular }))).toEqual({
      ok: true,
    })

    // Paso el tiempo de espera del reintento.
    await db()`update public.event_outbox set next_attempt_at = now() where id = ${fallido!.id}::bigint`
    await procesarEventos()

    const ok = await eventoDe('pos.sale.completed', 'saleId', v)
    expect(ok!.processed_at).not.toBeNull()
    expect(ok!.attempts).toBe(2)
    const l = await unAsiento('pos_sale', v)
    expect(l.find((x) => x.debit === 236)!.code).toBe('1110')
  })
})

describe('balanza de comprobacion', () => {
  it('no suma borradores y sigue mostrando una cuenta desactivada con movimiento', async () => {
    // Un borrador con una linea descuadrada, hecho con las acciones reales.
    expect(
      await crearAsiento(
        c.fd({ description: 'Borrador que no debe sumar', entryDate: '2026-09-23' }),
      ),
    ).toEqual({ ok: true })
    const [b] = await db()<{ id: string }[]>`
      select id from public.journal_entries
      where tenant_id = ${c.tenantId} and description = 'Borrador que no debe sumar'`
    expect(
      await agregarLinea(
        c.fd({
          entryId: b!.id,
          accountId: await cuentaPorCodigo(c, '1101'),
          lado: 'debit',
          amount: '99999',
        }),
      ),
    ).toEqual({ ok: true })

    const filas = await asUser(crypto.randomUUID(), c.tenantId, (tx) =>
      filasBalanza(tx, c.tenantId),
    )
    const porCodigo = new Map(filas.map((f) => [f.accountCode, f]))

    const [esperado] = await db()<{ d: string; cr: string }[]>`
      select coalesce(sum(l.debit), 0)::text as d, coalesce(sum(l.credit), 0)::text as cr
      from public.journal_entry_lines l join public.journal_entries e on e.id = l.entry_id
      join public.accounts a on a.id = l.account_id
      where e.tenant_id = ${c.tenantId} and e.status = 'posted' and a.code = '1101'`
    expect(porCodigo.get('1101')!.totalDebit).toBe(Number(esperado!.d))
    expect(porCodigo.get('1101')!.totalDebit).toBeLessThan(99999)

    const d = filas.reduce((s, f) => s + f.totalDebit, 0)
    const cr = filas.reduce((s, f) => s + f.totalCredit, 0)
    expect(Math.round(d * 100)).toBe(Math.round(cr * 100))

    // 1103 esta desactivada (prueba anterior) pero tiene movimiento: su
    // saldo sigue existiendo y la balanza tiene que cuadrar con el.
    expect(porCodigo.get('1103')).toBeDefined()
  })
})

describe('la partida doble la exige la base', () => {
  it('no se puede pasar a contabilizado un asiento que no cuadra, ni nacer contabilizado', async () => {
    const [b] = await db()<{ id: string }[]>`
      select id from public.journal_entries
      where tenant_id = ${c.tenantId} and description = 'Borrador que no debe sumar'`
    await expect(
      db()`update public.journal_entries set status = 'posted', posted_at = now() where id = ${b!.id}`,
    ).rejects.toThrow(/no cuadra|al menos dos/i)

    await expect(
      db()`
        insert into public.journal_entries (tenant_id, number, description, status)
        values (${c.tenantId}, 'AS-TRAMPA', 'Nace contabilizado sin lineas', 'posted')`,
    ).rejects.toThrow(/borrador/i)
  })
})

describe('aislamiento del mapa contable (tabla nueva de 0131)', () => {
  let otro: ClientePrueba

  beforeAll(async () => {
    otro = await sembrarCliente({
      prefijo: 'accion-conta',
      nombre: 'Otro Cliente Contable SRL',
      modulos: ['accounting'],
      roles: { Contador: { '*': true } },
    })
    // B tambien tiene su mapa: aislar no puede romper lo propio.
    expect(await crearCuentasPorDefecto(otro.fd())).toEqual({ ok: true })
  })

  afterAll(async () => {
    await db().begin(async (tx) => {
      await tx`set local session_replication_role = replica`
      for (const t of ['accounting_account_map', 'accounts']) {
        await tx.unsafe(`delete from public.${t} where tenant_id = $1`, [otro.tenantId])
      }
    })
    await otro.limpiar()
  })

  function comoB<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return asUser(crypto.randomUUID(), otro.tenantId, fn)
  }

  it('B ve su mapa completo y cero filas del de A, por select, update y delete', async () => {
    const propias = await comoB((tx) => tx`select purpose from public.accounting_account_map`)
    expect(propias).toHaveLength(PROPOSITOS_CONTABLES.length)

    const ajenas = await comoB(
      (tx) => tx`select purpose from public.accounting_account_map where tenant_id = ${c.tenantId}`,
    )
    expect(ajenas).toHaveLength(0)
    const upd = await comoB(
      (tx) => tx`update public.accounting_account_map set updated_at = now()
                 where tenant_id = ${c.tenantId} returning purpose`,
    )
    expect(upd).toHaveLength(0)
    const del = await comoB(
      (tx) =>
        tx`delete from public.accounting_account_map where tenant_id = ${c.tenantId} returning purpose`,
    )
    expect(del).toHaveLength(0)
  })

  it('B no puede apuntar SU mapa a una cuenta de A usando su propio tenant_id', async () => {
    const cajaDeA = await cuentaPorCodigo(c, '1101')
    await expect(
      comoB(
        (tx) => tx`update public.accounting_account_map set account_id = ${cajaDeA}
                   where tenant_id = ${otro.tenantId} and purpose = 'caja'`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('un usuario no puede fabricar asientos "automaticos": solo el despachador escribe', async () => {
    await expect(
      comoB(
        (tx) => tx`select public.registrar_asiento_automatico(
          ${otro.tenantId}::uuid, 'pos_sale', gen_random_uuid(), current_date, 'Trampa',
          '[{"purpose":"caja","debit":1,"credit":0},{"purpose":"ventas","debit":0,"credit":1}]'::jsonb)`,
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('con el modulo apagado, A tampoco ve su propio mapa', async () => {
    await c.modulo('accounting', false)
    try {
      const filas = await asUser(
        crypto.randomUUID(),
        c.tenantId,
        (tx) => tx`select purpose from public.accounting_account_map`,
      )
      expect(filas).toHaveLength(0)
    } finally {
      await c.modulo('accounting', true)
    }
  })
})
