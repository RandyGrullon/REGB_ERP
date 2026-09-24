'use server'

import { revalidatePath } from 'next/cache'
import {
  chooseInvoiceNcf,
  daysOverdue,
  deriveInvoiceStatus,
  documentTotals,
  dueDateFrom,
  esMotivoDgii,
  fechaFiscal,
  lateFeeEligible,
  lineTotals,
  splitTaxInclusive,
  type InvoiceNcfRequest,
  type InvoiceStatus,
} from '@regb/operations'
import type { TransactionSql } from 'postgres'
import { asUser, db } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { ErrorDeNegocio, sinExcepciones } from '@/lib/accion-segura'
import { exigirCredito } from '@/lib/credito'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de cuentas por cobrar (S22, 0130).
 *
 * El saldo NO se guarda: `invoice_balance()` lo deriva de capital + mora
 * - cobros vigentes - notas de credito. El `status` si se persiste, pero
 * como PROYECCION: siempre se recalcula con `recalcularEstado` a partir
 * de esos mismos cuatro numeros. Antes cada accion lo calculaba a su
 * manera -el cobro sin la mora, la mora con ella- y un cobro del capital
 * dejaba "pagada" una factura con mora pendiente.
 *
 * Toda accion pasa por `sinExcepciones`: un error de la base se devuelve
 * como aviso y no tira la pantalla.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const num = (raw: string): number | null => {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const r2 = (n: number) => Math.round(n * 100) / 100

const rd = (n: number) =>
  `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** AAAA-MM-DD de una fecha local (la de `dueDateFrom`). */
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * El estado de la factura, derivado de los mismos numeros que el saldo.
 * Una anulada no se toca: anular es una decision, no un calculo.
 */
async function recalcularEstado(
  tx: TransactionSql,
  tenantId: string,
  invoiceId: string,
): Promise<InvoiceStatus> {
  const [t] = await tx<
    {
      status: string
      due_date: string
      total: string
      mora: string
      cobrado: string
      notas: string
    }[]
  >`
    select i.status, i.due_date::text, i.total::text,
           coalesce((select sum(f.amount) from public.invoice_late_fees f
                      where f.invoice_id = i.id), 0)::text as mora,
           coalesce((select sum(p.amount) from public.customer_payments p
                      where p.invoice_id = i.id and p.reversed_at is null), 0)::text as cobrado,
           coalesce((select sum(n.total) from public.customer_credit_notes n
                      where n.invoice_id = i.id), 0)::text as notas
    from public.customer_invoices i
    where i.id = ${invoiceId} and i.tenant_id = ${tenantId}`
  if (!t || t.status === 'void') return 'void'

  const estado = deriveInvoiceStatus(
    Number(t.total) + Number(t.mora) - Number(t.notas),
    Number(t.cobrado),
    new Date(`${t.due_date}T12:00:00`),
    new Date(),
  )
  await tx`
    update public.customer_invoices set status = ${estado}
    where id = ${invoiceId} and tenant_id = ${tenantId} and status <> 'void'`
  return estado
}

// ── Facturar ─────────────────────────────────────────────────────────────

interface LineaPorFacturar {
  id: string
  product_id: string
  name: string
  unit: string
  qty_delivered: string
  facturado: string
  unit_price: string
  discount_pct: string
  tax_rate: string
}

/**
 * Emite la factura de lo ENTREGADO y todavia no facturado de un pedido.
 *
 * - Se factura lo entregado, no lo pedido: un pedido de 25 con 20
 *   entregados se factura por 20, y los 5 restantes se facturan cuando
 *   salgan (otra factura). Antes se cobraba el pedido entero.
 * - La factura guarda sus LINEAS (0130): es lo que se imprime, lo que se
 *   puede devolver con nota de credito y lo que dice cuanto de cada linea
 *   del pedido ya se facturo.
 * - El comprobante lo decide `chooseInvoiceNcf`: un RNC invalido es un
 *   error que lo dice, nunca un B02 en silencio.
 * - El credito se vuelve a mirar: si el cliente cayo en vencidas despues
 *   de confirmar, facturar tambien se frena (salvo la excepcion que ya se
 *   autorizo para ESE pedido, o una nueva).
 * - Sin secuencia autorizada, `assign_ncf` lanza y la factura NO se crea:
 *   es preferible no facturar a facturar sin comprobante. Ahora eso llega
 *   como aviso, no como pantalla rota.
 *
 * El vencimiento sale de los dias de credito que el cliente tenia AL
 * EMITIR, y la fecha es la de Santo Domingo, no la del servidor en UTC.
 */
export async function facturarPedido(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('facturarPedido', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'ar', 'ar.invoice.create')
    if (!permiso.ok) return permiso

    const orderId = String(fd.get('orderId') ?? '')
    if (!orderId) return { ok: false, error: 'Faltan datos.' }
    const pedidoNcf = String(fd.get('ncfType') ?? '') || 'auto'
    if (!['auto', 'B01', 'B02'].includes(pedidoNcf)) {
      return { ok: false, error: 'Tipo de comprobante no valido: automatico, B01 o B02.' }
    }
    const excepcion = {
      pedida: String(fd.get('creditOverride') ?? '') === '1',
      motivo: String(fd.get('overrideReason') ?? ''),
    }

    const res = await asUser(ctx.userId, ctx.tenantId, async (tx): Promise<ActionResult> => {
      // `for update`: dos clics en "Facturar" no sacan dos facturas.
      const [order] = await tx<
        {
          status: string
          customer_id: string
          payment_terms: number
          tax_id: string | null
          number: string
        }[]
      >`
        select o.status, o.customer_id, c.payment_terms, c.tax_id, o.number
        from public.sales_orders o
        join public.customers c on c.id = o.customer_id
        where o.id = ${orderId} and o.tenant_id = ${ctx.tenantId}
        for update of o`
      if (!order) return { ok: false, error: 'Ese pedido no existe.' }
      if (order.status === 'draft')
        return { ok: false, error: 'Confirma el pedido antes de facturar.' }

      // Una factura anterior a la 0130 no tiene lineas: cobro el pedido
      // entero y no se sabe que lineas cubrio. Se respeta como estaba.
      const [vieja] = await tx<{ number: string }[]>`
        select i.number from public.customer_invoices i
        where i.tenant_id = ${ctx.tenantId} and i.source_type = 'sales_order'
          and i.source_id = ${orderId} and i.status <> 'void'
          and not exists (select 1 from public.customer_invoice_lines il where il.invoice_id = i.id)`
      if (vieja) return { ok: false, error: `Ese pedido ya se facturo con ${vieja.number}.` }

      const lineas = await tx<LineaPorFacturar[]>`
        select l.id, l.product_id, p.name, p.unit, l.qty_delivered::text,
               coalesce((select sum(il.qty) from public.customer_invoice_lines il
                         join public.customer_invoices i on i.id = il.invoice_id
                         where il.order_line_id = l.id and i.status <> 'void'), 0)::text
                 as facturado,
               l.unit_price::text, l.discount_pct::text, l.tax_rate::text
        from public.sales_order_lines l
        join public.products p on p.id = l.product_id
        where l.order_id = ${orderId} and l.tenant_id = ${ctx.tenantId}
        order by p.name`

      const porFacturar = lineas
        .map((l) => ({ ...l, qty: r2(Number(l.qty_delivered) - Number(l.facturado)) }))
        .filter((l) => l.qty > 0)
      if (porFacturar.length === 0) {
        const algoEntregado = lineas.some((l) => Number(l.qty_delivered) > 0)
        return {
          ok: false,
          error: algoEntregado
            ? `Todo lo entregado del pedido ${order.number} ya esta facturado.`
            : 'Entrega la mercancia antes de facturar: se factura lo entregado, no lo pedido.',
        }
      }

      const entradas = porFacturar.map((l) => ({
        quantity: l.qty,
        unitPrice: Number(l.unit_price),
        discountPct: Number(l.discount_pct),
        taxRate: Number(l.tax_rate),
      }))
      const totales = documentTotals(entradas)

      const comprobante = chooseInvoiceNcf(pedidoNcf as InvoiceNcfRequest, order.tax_id)
      if (!comprobante.ok) return { ok: false, error: comprobante.error }

      const credito = await exigirCredito(tx, ctx, {
        customerId: order.customer_id,
        orderId,
        montoDocumento: totales.total,
        etapa: 'invoice',
        excepcion,
      })
      if (!credito.ok) return credito

      const [n] = await tx<{ next_customer_invoice_number: string }[]>`
        select public.next_customer_invoice_number(${ctx.tenantId})`
      const [c] = await tx<{ assign_ncf: string }[]>`
        select public.assign_ncf(${ctx.tenantId}, ${comprobante.tipo})`

      const emision = fechaFiscal(new Date())
      const vence = isoLocal(dueDateFrom(new Date(`${emision}T12:00:00`), order.payment_terms))

      const [inv] = await tx<{ id: string }[]>`
        insert into public.customer_invoices
          (tenant_id, number, customer_id, source_type, source_id, issue_date, due_date,
           subtotal, discount, tax, total, created_by, ncf, ncf_type, buyer_tax_id)
        values (${ctx.tenantId}, ${n!.next_customer_invoice_number}, ${order.customer_id},
                'sales_order', ${orderId}, ${emision}, ${vence},
                ${totales.subtotal}, ${totales.discount}, ${totales.tax}, ${totales.total},
                ${ctx.userId}, ${c!.assign_ncf}, ${comprobante.tipo}, ${comprobante.buyerTaxId})
        returning id`

      for (const [i, l] of porFacturar.entries()) {
        const t = totales.lines[i]!
        await tx`
          insert into public.customer_invoice_lines
            (invoice_id, tenant_id, order_line_id, product_id, description, unit, qty,
             unit_price, discount_pct, tax_rate, subtotal, tax, line_total)
          values (${inv!.id}, ${ctx.tenantId}, ${l.id}, ${l.product_id}, ${l.name}, ${l.unit},
                  ${l.qty}, ${l.unit_price}, ${l.discount_pct}, ${l.tax_rate},
                  ${t.subtotal}, ${t.tax}, ${t.total})`
      }

      await tx`
        select public.emit_event('ar.invoice.issued',
          ${JSON.stringify({ orderId, number: n!.next_customer_invoice_number })}::text::jsonb, 'ar')`

      return { ok: true }
    })

    if (!res.ok) return res
    revalidatePath('/cobrar')
    revalidatePath(`/pedidos/${orderId}`)
    return { ok: true }
  })
}

// ── Cobrar ───────────────────────────────────────────────────────────────

/**
 * Registra un cobro contra el saldo REAL: capital + mora - cobros - notas.
 *
 * Antes se validaba contra el total sin la mora: cobrar lo que la propia
 * pantalla proponia (11,564 + 500 de mora) daba "Solo quedan 11564.00", y
 * cobrar el capital dejaba la factura "pagada" con la mora fuera de la
 * cartera para siempre.
 *
 * Cobrar de mas se rechaza: un sobrepago silencioso deja la cartera
 * cuadrando con dinero que no existe.
 */
export async function registrarCobro(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('registrarCobro', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'ar', 'ar.payment.record')
    if (!permiso.ok) return permiso

    const invoiceId = String(fd.get('invoiceId') ?? '')
    const monto = num(String(fd.get('amount') ?? ''))
    const metodo = String(fd.get('method') ?? 'cash')
    const referencia = String(fd.get('reference') ?? '').trim() || null

    if (!invoiceId) return { ok: false, error: 'Faltan datos.' }
    if (monto === null || monto <= 0) return { ok: false, error: 'El monto debe ser positivo.' }
    if (!['cash', 'card', 'transfer', 'check'].includes(metodo)) {
      return { ok: false, error: 'Forma de pago no valida.' }
    }

    const res = await asUser(ctx.userId, ctx.tenantId, async (tx): Promise<ActionResult> => {
      const [inv] = await tx<{ status: string }[]>`
        select status from public.customer_invoices
        where id = ${invoiceId} and tenant_id = ${ctx.tenantId} for update`
      if (!inv) return { ok: false, error: 'Esa factura no existe.' }
      if (inv.status === 'void') return { ok: false, error: 'Esa factura esta anulada.' }

      const [s] = await tx<{ saldo: string; mora: string }[]>`
        select public.invoice_balance(${invoiceId})::text as saldo,
               coalesce((select sum(amount) from public.invoice_late_fees
                          where invoice_id = ${invoiceId}), 0)::text as mora`
      const saldo = r2(Number(s!.saldo))
      const mora = Number(s!.mora)

      if (r2(monto) > saldo) {
        return {
          ok: false,
          error:
            `Solo quedan ${rd(saldo)} por cobrar` +
            (mora > 0 ? ` (incluye ${rd(mora)} de mora)` : '') +
            `; se intento cobrar ${rd(monto)}.`,
        }
      }

      await tx`
        insert into public.customer_payments
          (tenant_id, invoice_id, amount, method, reference, received_by)
        values (${ctx.tenantId}, ${invoiceId}, ${monto}, ${metodo}, ${referencia}, ${ctx.userId})`

      const estado = await recalcularEstado(tx, ctx.tenantId, invoiceId)
      if (estado === 'paid') {
        await tx`
          select public.emit_event('ar.invoice.paid',
            ${JSON.stringify({ invoiceId })}::text::jsonb, 'ar')`
      }
      return { ok: true }
    })

    if (!res.ok) return res
    revalidatePath('/cobrar')
    revalidatePath(`/cobrar/${invoiceId}`)
    return { ok: true }
  })
}

/**
 * Reversa un cobro mal registrado. No lo borra ni lo edita: lo marca
 * reversado, con motivo y con quien lo hizo, y el saldo lo deja de
 * contar. Un cobro de 5,000 digitado en vez de 500 se reversa y se
 * registra el de 500; en la ficha quedan los dos, y en audit.log el
 * antes y el despues.
 */
export async function reversarCobro(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('reversarCobro', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'ar', 'ar.payment.reverse')
    if (!permiso.ok) return permiso

    const paymentId = String(fd.get('paymentId') ?? '')
    const motivo = String(fd.get('reason') ?? '').trim()
    if (!paymentId) return { ok: false, error: 'Faltan datos.' }
    if (motivo.length < 4) {
      return {
        ok: false,
        error: 'Escribe por que se reversa el cobro: queda en la ficha y en la bitacora.',
      }
    }

    let invoiceId = ''
    const res = await asUser(ctx.userId, ctx.tenantId, async (tx): Promise<ActionResult> => {
      const [p] = await tx<{ invoice_id: string; amount: string; reversed_at: string | null }[]>`
        select invoice_id, amount::text, reversed_at::text from public.customer_payments
        where id = ${paymentId} and tenant_id = ${ctx.tenantId} for update`
      if (!p) return { ok: false, error: 'Ese cobro no existe.' }
      if (p.reversed_at) return { ok: false, error: 'Ese cobro ya estaba reversado.' }
      invoiceId = p.invoice_id

      // La factura primero, como en el cobro: los dos caminos la bloquean
      // en el mismo orden.
      await tx`
        select id from public.customer_invoices
        where id = ${p.invoice_id} and tenant_id = ${ctx.tenantId} for update`

      await tx`
        update public.customer_payments
        set reversed_at = now(), reversed_by = ${ctx.userId}, reversal_reason = ${motivo}
        where id = ${paymentId} and tenant_id = ${ctx.tenantId}`

      await recalcularEstado(tx, ctx.tenantId, p.invoice_id)

      await tx`
        select public.emit_event('ar.payment.reversed',
          ${JSON.stringify({ invoiceId: p.invoice_id, paymentId, amount: Number(p.amount) })}::text::jsonb,
          'ar')`
      return { ok: true }
    })

    if (!res.ok) return res
    revalidatePath('/cobrar')
    revalidatePath(`/cobrar/${invoiceId}`)
    return { ok: true }
  })
}

// ── Mora ─────────────────────────────────────────────────────────────────

/**
 * Aplica un cargo por mora, capturado a mano.
 *
 * NO hay formula: cuanto cobrar lo decide el negocio caso por caso, y esta
 * accion no calcula nada por su cuenta -solo valida que la factura sea
 * elegible (no anulada, no exenta, con dias de atraso) y deja el rastro de
 * con cuantos dias de atraso se decidio, para quien lo revise despues.
 *
 * Un cargo puede reabrir una factura ya "paid": el cliente termino de pagar
 * el capital, pero ahora debe el cargo que se decidio despues. Es correcto.
 */
export async function aplicarCargoPorMora(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('aplicarCargoPorMora', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'ar', 'ar.latefee.apply')
    if (!permiso.ok) return permiso

    const invoiceId = String(fd.get('invoiceId') ?? '')
    const monto = num(String(fd.get('amount') ?? ''))
    const notas = String(fd.get('notes') ?? '').trim() || null
    if (!invoiceId) return { ok: false, error: 'Faltan datos.' }
    if (monto === null || monto <= 0) return { ok: false, error: 'El monto debe ser positivo.' }

    const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [inv] = await tx<{ status: string; due_date: string; customer_exempt: boolean }[]>`
        select i.status, i.due_date::text, c.late_fee_exempt as customer_exempt
        from public.customer_invoices i
        join public.customers c on c.id = i.customer_id
        where i.id = ${invoiceId} and i.tenant_id = ${ctx.tenantId} for update of i`
      if (!inv) return 'no-existe'

      const dias = daysOverdue(new Date(`${inv.due_date}T12:00:00`), new Date())
      if (!lateFeeEligible(inv.status as InvoiceStatus, inv.customer_exempt, dias)) {
        return 'no-elegible'
      }

      await tx`
        insert into public.invoice_late_fees
          (tenant_id, invoice_id, amount, days_late_at_charge, notes, applied_by)
        values (${ctx.tenantId}, ${invoiceId}, ${monto}, ${dias}, ${notas}, ${ctx.userId})`

      // Mismo calculo que el cobro: capital + TODA la mora - cobros - notas.
      await recalcularEstado(tx, ctx.tenantId, invoiceId)
      return 'ok'
    })

    if (res === 'no-existe') return { ok: false, error: 'Esa factura no existe.' }
    if (res === 'no-elegible') {
      return {
        ok: false,
        error:
          'Este cliente esta exento de mora, la factura esta anulada, o no tiene dias de atraso.',
      }
    }

    revalidatePath('/cobrar')
    revalidatePath(`/cobrar/${invoiceId}`)
    return { ok: true }
  })
}

// ── Anular ───────────────────────────────────────────────────────────────

/**
 * Anula la factura. No borra: la marca con motivo, como todo en el sistema.
 *
 * Con cobros VIGENTES no se anula (el dinero recibido quedaria sin
 * documento): se reversan primero si fueron un error, o se emite una nota
 * de credito. Con notas de credito tampoco: la nota ya modifico esta
 * factura ante la DGII.
 */
export async function anularFactura(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('anularFactura', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'ar', 'ar.invoice.void')
    if (!permiso.ok) return permiso

    const invoiceId = String(fd.get('invoiceId') ?? '')
    const motivo = String(fd.get('reason') ?? '').trim()
    // El codigo se declara en el 608; el texto explica. Los dos.
    const codigo = String(fd.get('voidType') ?? '').trim()
    if (!invoiceId) return { ok: false, error: 'Faltan datos.' }
    if (motivo.length < 4) return { ok: false, error: 'Escribe el motivo de la anulacion.' }
    if (!esMotivoDgii(codigo)) {
      return {
        ok: false,
        error:
          'Elige el motivo que pide la DGII: sin el, la factura no se puede declarar en el 608.',
      }
    }

    const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [inv] = await tx<{ id: string }[]>`
        select id from public.customer_invoices
        where id = ${invoiceId} and tenant_id = ${ctx.tenantId} for update`
      if (!inv) return 'no-existe'

      const [c] = await tx<{ cobros: string; notas: string }[]>`
        select (select count(*) from public.customer_payments
                 where invoice_id = ${invoiceId} and reversed_at is null)::text as cobros,
               (select count(*) from public.customer_credit_notes
                 where invoice_id = ${invoiceId})::text as notas`
      if (Number(c!.cobros) > 0) return 'con-cobros'
      if (Number(c!.notas) > 0) return 'con-notas'

      await tx`
        update public.customer_invoices
        set status = 'void', void_type = ${codigo}, void_reason = ${motivo}
        where id = ${invoiceId} and tenant_id = ${ctx.tenantId} and status <> 'void'`
      return 'ok'
    })

    if (res === 'no-existe') return { ok: false, error: 'Esa factura no existe.' }
    if (res === 'con-cobros') {
      return {
        ok: false,
        error:
          'Esta factura tiene cobros. Si fueron un error, reversalos primero; si no, lo que ' +
          'corresponde es una nota de credito.',
      }
    }
    if (res === 'con-notas') {
      return {
        ok: false,
        error: 'Esta factura ya tiene notas de credito: la DGII la ve modificada, no se anula.',
      }
    }

    revalidatePath('/cobrar')
    revalidatePath(`/cobrar/${invoiceId}`)
    return { ok: true }
  })
}

// ── Nota de credito (B04) ────────────────────────────────────────────────

/**
 * Emite una nota de credito sobre una factura de credito.
 *
 * - `return` (devolucion): por lineas de la factura, con la cantidad que
 *   vuelve (`qty_<lineaId>`). Puede reponer inventario en el almacen del
 *   pedido, como entrada sin costo (el promedio no cambia).
 * - `adjustment` (rebaja): un monto con ITBIS, que se separa en base e
 *   impuesto en la proporcion de la factura.
 *
 * Lleva NCF B04 y el NCF de la factura que modifica, si la factura tiene
 * comprobante. No puede pasar del saldo pendiente: si el cliente ya
 * pago, devolverle dinero es un reembolso, y eso todavia no esta en el
 * sistema (ver la ficha de `ar`).
 */
export async function emitirNotaDeCredito(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('emitirNotaDeCredito', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'ar', 'ar.creditnote.create')
    if (!permiso.ok) return permiso

    const invoiceId = String(fd.get('invoiceId') ?? '')
    const kind = String(fd.get('kind') ?? '')
    const motivo = String(fd.get('reason') ?? '').trim()
    const reponer = String(fd.get('restock') ?? '') === '1'
    if (!invoiceId) return { ok: false, error: 'Faltan datos.' }
    if (kind !== 'return' && kind !== 'adjustment') {
      return { ok: false, error: 'Elige si es devolucion de mercancia o rebaja de monto.' }
    }
    if (motivo.length < 4) return { ok: false, error: 'Escribe el motivo de la nota de credito.' }

    const res = await asUser(ctx.userId, ctx.tenantId, async (tx): Promise<ActionResult> => {
      const [inv] = await tx<
        {
          number: string
          status: string
          customer_id: string
          total: string
          tax: string
          ncf: string | null
          ncf_type: string | null
          source_type: string | null
          source_id: string | null
        }[]
      >`
        select number, status, customer_id, total::text, tax::text, ncf, ncf_type,
               source_type, source_id
        from public.customer_invoices
        where id = ${invoiceId} and tenant_id = ${ctx.tenantId} for update`
      if (!inv) return { ok: false, error: 'Esa factura no existe.' }
      if (inv.status === 'void') {
        return { ok: false, error: 'La factura esta anulada: no lleva nota de credito.' }
      }

      const [s] = await tx<{ saldo: string; notas: string }[]>`
        select public.invoice_balance(${invoiceId})::text as saldo,
               coalesce((select sum(total) from public.customer_credit_notes
                          where invoice_id = ${invoiceId}), 0)::text as notas`
      const saldo = r2(Number(s!.saldo))
      const capitalRestante = r2(Number(inv.total) - Number(s!.notas))

      type LineaNota = {
        invoiceLineId: string | null
        productId: string | null
        description: string
        qty: number
        unitPrice: number
        discountPct: number
        taxRate: number
        tracksStock: boolean
      }
      const lineasNota: LineaNota[] = []
      let subtotal = 0
      let tax = 0
      let total = 0

      if (kind === 'return') {
        const lineas = await tx<
          {
            id: string
            product_id: string | null
            description: string
            qty: string
            devuelto: string
            unit_price: string
            discount_pct: string
            tax_rate: string
            tracks_stock: boolean | null
          }[]
        >`
          select il.id, il.product_id, il.description, il.qty::text,
                 coalesce((select sum(nl.qty) from public.customer_credit_note_lines nl
                            where nl.invoice_line_id = il.id), 0)::text as devuelto,
                 il.unit_price::text, il.discount_pct::text, il.tax_rate::text,
                 p.tracks_stock
          from public.customer_invoice_lines il
          left join public.products p on p.id = il.product_id
          where il.invoice_id = ${invoiceId} and il.tenant_id = ${ctx.tenantId}`
        if (lineas.length === 0) {
          return {
            ok: false,
            error:
              'Esta factura no tiene lineas (es anterior a las lineas): usa una rebaja de monto.',
          }
        }

        for (const l of lineas) {
          const q = num(String(fd.get(`qty_${l.id}`) ?? ''))
          if (q === null || q === 0) continue
          const quedan = r2(Number(l.qty) - Number(l.devuelto))
          if (q < 0 || q > quedan) {
            return {
              ok: false,
              error: `De "${l.description}" se pueden devolver hasta ${quedan}; se indico ${q}.`,
            }
          }
          lineasNota.push({
            invoiceLineId: l.id,
            productId: l.product_id,
            description: l.description,
            qty: q,
            unitPrice: Number(l.unit_price),
            discountPct: Number(l.discount_pct),
            taxRate: Number(l.tax_rate),
            tracksStock: l.tracks_stock === true,
          })
        }
        if (lineasNota.length === 0) {
          return { ok: false, error: 'Indica cuanto se devuelve de al menos una linea.' }
        }
        const t = documentTotals(
          lineasNota.map((l) => ({
            quantity: l.qty,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            taxRate: l.taxRate,
          })),
        )
        subtotal = t.subtotal
        tax = t.tax
        total = t.total
      } else {
        const monto = num(String(fd.get('amount') ?? ''))
        if (monto === null || monto <= 0) {
          return { ok: false, error: 'El monto de la rebaja debe ser positivo (con ITBIS).' }
        }
        const partes = splitTaxInclusive(r2(monto), Number(inv.tax), Number(inv.total))
        subtotal = partes.subtotal
        tax = partes.tax
        total = r2(monto)
      }

      if (total > capitalRestante) {
        return {
          ok: false,
          error: `La nota (${rd(total)}) pasa de lo que queda de la factura ${inv.number} (${rd(capitalRestante)}).`,
        }
      }
      if (total > saldo) {
        return {
          ok: false,
          error:
            `La nota (${rd(total)}) pasa del saldo pendiente (${rd(saldo)}). Si el cliente ya ` +
            'pago, devolverle dinero es un reembolso y todavia no esta en el sistema; si el ' +
            'cobro fue un error, reversalo primero.',
        }
      }

      // Almacen del pedido de origen, para reponer.
      let warehouseId: string | null = null
      const reponerAqui = kind === 'return' && reponer
      if (reponerAqui) {
        if (inv.source_type === 'sales_order' && inv.source_id) {
          const [o] = await tx<{ warehouse_id: string }[]>`
            select warehouse_id from public.sales_orders
            where id = ${inv.source_id} and tenant_id = ${ctx.tenantId}`
          warehouseId = o?.warehouse_id ?? null
        }
        if (!warehouseId) {
          return { ok: false, error: 'No se sabe de que almacen salio: no se puede reponer.' }
        }
      }

      const [n] = await tx<{ next_credit_note_number: string }[]>`
        select public.next_credit_note_number(${ctx.tenantId})`

      // B04 si la factura tiene comprobante; E34 si era electronica.
      let ncf: string | null = null
      let ncfType: string | null = null
      if (inv.ncf) {
        ncfType = inv.ncf_type?.startsWith('E') ? 'E34' : 'B04'
        const [c] = await tx<{ assign_ncf: string }[]>`
          select public.assign_ncf(${ctx.tenantId}, ${ncfType})`
        ncf = c!.assign_ncf
      }

      const [nota] = await tx<{ id: string }[]>`
        insert into public.customer_credit_notes
          (tenant_id, number, invoice_id, customer_id, kind, issue_date, ncf, ncf_type,
           modified_ncf, reason, subtotal, tax, total, restocked, warehouse_id, created_by)
        values (${ctx.tenantId}, ${n!.next_credit_note_number}, ${invoiceId}, ${inv.customer_id},
                ${kind}, ${fechaFiscal(new Date())}, ${ncf}, ${ncfType}, ${inv.ncf}, ${motivo},
                ${subtotal}, ${tax}, ${total}, ${reponerAqui}, ${warehouseId}, ${ctx.userId})
        returning id`

      for (const l of lineasNota) {
        const t = lineTotals({
          quantity: l.qty,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          taxRate: l.taxRate,
        })
        await tx`
          insert into public.customer_credit_note_lines
            (credit_note_id, tenant_id, invoice_line_id, product_id, description, qty,
             unit_price, discount_pct, tax_rate, subtotal, tax, line_total)
          values (${nota!.id}, ${ctx.tenantId}, ${l.invoiceLineId}, ${l.productId},
                  ${l.description}, ${l.qty}, ${l.unitPrice}, ${l.discountPct}, ${l.taxRate},
                  ${t.subtotal}, ${t.tax}, ${t.total})`

        if (reponerAqui && l.tracksStock && l.productId) {
          // Entrada SIN costo: el promedio no cambia (0019). La devolucion
          // vuelve al costo al que salio, no a uno inventado.
          //
          // Si inventario esta apagado lo dice su RLS (no un `if` por id de
          // modulo, §2.2): se traduce aqui, donde se sabe que significa.
          try {
            await tx`
              insert into public.inventory_movements
                (tenant_id, warehouse_id, product_id, movement_type, qty, reason,
                 reference_type, reference_id, created_by)
              values (${ctx.tenantId}, ${warehouseId}, ${l.productId}, 'adjustment_in', ${l.qty},
                      ${`Devolucion de cliente ${n!.next_credit_note_number}`},
                      'customer_credit_note', ${nota!.id}, ${ctx.userId})`
          } catch (e) {
            if ((e as { code?: unknown }).code === '42501') {
              throw new ErrorDeNegocio(
                'No se pudo reponer el inventario: el modulo de inventario no esta activo. ' +
                  'Emite la nota sin marcar "Reponer inventario", o activalo primero.',
              )
            }
            throw e
          }
        }
      }

      await recalcularEstado(tx, ctx.tenantId, invoiceId)

      await tx`
        select public.emit_event('ar.credit-note.issued',
          ${JSON.stringify({ invoiceId, creditNoteId: nota!.id, total, kind })}::text::jsonb, 'ar')`
      return { ok: true }
    })

    if (!res.ok) return res
    revalidatePath('/cobrar')
    revalidatePath(`/cobrar/${invoiceId}`)
    revalidatePath('/inventory')
    return { ok: true }
  })
}

// ── Politica y exenciones ───────────────────────────────────────────────

/**
 * Cuantos dias de atraso tolera el negocio antes de dejar de fiar.
 * Vacio o 0 = no bloquear por vencidas (solo el limite, si hay).
 */
export async function guardarPoliticaDeCredito(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('guardarPoliticaDeCredito', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'ar', 'ar.credit.manage')
    if (!permiso.ok) return permiso

    const raw = num(String(fd.get('overdueDays') ?? ''))
    const dias = raw === null || raw === 0 ? null : raw
    if (dias !== null && (!Number.isInteger(dias) || dias < 1 || dias > 365)) {
      return { ok: false, error: 'Los dias van de 1 a 365; vacio para no bloquear por vencidas.' }
    }

    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.ar_credit_policy (tenant_id, overdue_block_days, updated_by, updated_at)
      values (${ctx.tenantId}, ${dias}, ${ctx.userId}, now())
      on conflict (tenant_id) do update
      set overdue_block_days = excluded.overdue_block_days,
          updated_by = excluded.updated_by, updated_at = now()`,
    )

    revalidatePath('/cobrar/cartera')
    revalidatePath('/cobrar')
    return { ok: true }
  })
}

/**
 * Marca o desmarca a un cliente como exento de cargos por mora. Es una
 * decision del negocio (relacion, volumen, acuerdo) y queda fija hasta que
 * alguien la cambie a mano — no se calcula sola por comportamiento.
 */
export async function alternarExentoMora(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('alternarExentoMora', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'ar', 'ar.latefee.apply')
    if (!permiso.ok) return permiso

    const id = String(fd.get('id') ?? '')
    if (!id) return { ok: false, error: 'Faltan datos.' }

    await asUser(ctx.userId, ctx.tenantId, (tx) => {
      return tx`
        update public.customers set late_fee_exempt = not late_fee_exempt, updated_at = now()
        where id = ${id} and tenant_id = ${ctx.tenantId}`
    })

    revalidatePath('/pedidos/clientes')
    revalidatePath('/cobrar')
    return { ok: true }
  })
}

/** Marca vencidas las que pasaron su fecha. Idempotente. */
export async function marcarVencidas(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('marcarVencidas', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'ar', 'ar.view')
    if (!permiso.ok) return permiso

    await db()`select public.mark_overdue_invoices(${ctx.tenantId})`

    revalidatePath('/cobrar')
    revalidatePath('/cobrar/cartera')
    return { ok: true }
  })
}

// ── Envoltorios para <form action> ─────────────────────────────────────
export async function facturarPedidoForm(fd: FormData): Promise<void> {
  const r = await facturarPedido(fd)
  const conExcepcion = r.ok && String(fd.get('creditOverride') ?? '') === '1'
  // Lo siguiente despues de facturar a credito es entregarle al cliente su
  // factura con el NCF: el aviso trae el camino para imprimirla. Antes
  // decia "factura emitida" y habia que buscarla en la lista.
  const emitida = r.ok ? await facturaRecienEmitida(fd) : null
  await anotarAviso(
    r,
    'facturarPedido',
    (conExcepcion
      ? 'Facturado con excepcion de credito. Quedo escrita con tu nombre y el motivo.'
      : 'Listo, factura emitida.') +
      (emitida ? ` ${emitida.number}${emitida.ncf ? ` · ${emitida.ncf}` : ''}.` : ''),
    emitida
      ? { href: `/cobrar/${emitida.id}/imprimir${emitida.qs}`, texto: 'Imprimir factura' }
      : undefined,
  )
}

/** La ultima factura del pedido que se acaba de facturar, para el aviso. */
async function facturaRecienEmitida(
  fd: FormData,
): Promise<{ id: string; number: string; ncf: string | null; qs: string } | null> {
  const orderId = String(fd.get('orderId') ?? '')
  const demo = demoDe(fd)
  const ctx = await actionCtx(demo)
  if (!ctx || !orderId) return null
  const [f] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<{ id: string; number: string; ncf: string | null }[]>`
    select id, number, ncf from public.customer_invoices
    where tenant_id = ${ctx.tenantId} and source_type = 'sales_order' and source_id = ${orderId}
    order by created_at desc
    limit 1`,
  )
  if (!f) return null
  const qs = demo.tenant
    ? `?tenant=${demo.tenant}&rol=${encodeURIComponent(demo.rol ?? 'Owner')}`
    : ''
  return { ...f, qs }
}
export async function registrarCobroForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarCobro(fd), 'registrarCobro')
}
export async function reversarCobroForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await reversarCobro(fd),
    'reversarCobro',
    'Cobro reversado. Sigue en la ficha, tachado, con tu motivo.',
  )
}
export async function anularFacturaForm(fd: FormData): Promise<void> {
  await anotarAviso(await anularFactura(fd), 'anularFactura')
}
export async function emitirNotaDeCreditoForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await emitirNotaDeCredito(fd),
    'emitirNotaDeCredito',
    'Nota de credito emitida.',
  )
}
export async function aplicarCargoPorMoraForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await aplicarCargoPorMora(fd),
    'aplicarCargoPorMora',
    'Cargo por mora aplicado: ya forma parte del saldo de la factura.',
  )
}
export async function guardarPoliticaDeCreditoForm(fd: FormData): Promise<void> {
  await anotarAviso(await guardarPoliticaDeCredito(fd), 'guardarPoliticaDeCredito')
}
export async function alternarExentoMoraForm(fd: FormData): Promise<void> {
  await anotarAviso(await alternarExentoMora(fd), 'alternarExentoMora')
}
export async function marcarVencidasForm(fd: FormData): Promise<void> {
  await anotarAviso(await marcarVencidas(fd), 'marcarVencidas')
}
