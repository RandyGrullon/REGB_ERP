import 'server-only'

import type { TransactionSql } from 'postgres'
import {
  DIAS_BLOQUEO_POR_DEFECTO,
  creditBlockMessage,
  evaluateCredit,
  type CreditDecision,
} from '@regb/operations'
import { exigir, type ActionResult, type ModulePageCtx } from './module-page'

/**
 * El credito de un cliente, visto desde pedidos y desde por cobrar.
 *
 * Vive aqui -y no en cada accion- porque confirmar un pedido y facturarlo
 * TIENEN que medir igual: si una pantalla contara los pedidos sin
 * facturar y la otra no, el vendedor veria "tiene credito" y el cobrador
 * "no tiene", sobre el mismo cliente, el mismo dia.
 *
 * Sin `ar` activo no hay cartera, y eso lo decide la RLS, no un `if` por
 * id de modulo (§2.2): las facturas, la politica y las excepciones son
 * invisibles, asi que no hay vencidas que bloqueen y el pedido funciona
 * como antes. Lo unico que sigue midiendo es el limite contra los pedidos
 * confirmados sin facturar -los pedidos si se ven-, que es credito
 * comprometido igual.
 */

export interface SituacionDeCredito extends CreditDecision {
  customerName: string
  creditLimit: number | null
  overdueBlockDays: number | null
  /** Pedidos confirmados sin facturar, sin contar el documento evaluado. */
  uninvoicedOrders: number
  /** El porque del bloqueo, listo para el aviso. null si no hay bloqueo. */
  mensaje: string | null
}

/** Dias de atraso que bloquean. Sin fila, el valor por defecto (30). */
export async function politicaDeCredito(
  tx: TransactionSql,
  tenantId: string,
): Promise<number | null> {
  const [p] = await tx<{ d: number | null }[]>`
    select overdue_block_days as d from public.ar_credit_policy where tenant_id = ${tenantId}`
  return p ? p.d : DIAS_BLOQUEO_POR_DEFECTO
}

/**
 * Credito comprometido en pedidos que todavia no se facturan.
 *
 * Por linea: lo pedido (o, si el pedido se cancelo, solo lo que alcanzo a
 * entregarse) menos lo ya facturado, a su precio con ITBIS. Una factura
 * anterior a la 0130 no tiene lineas: si el pedido tiene una, se da por
 * facturado entero, que es lo que esa factura cobro.
 */
async function pedidosSinFacturar(
  tx: TransactionSql,
  tenantId: string,
  customerId: string,
  excluirPedido: string | null,
): Promise<number> {
  const [r] = await tx<{ pendiente: string }[]>`
    with lin as (
      select case when o.status = 'cancelled' then l.qty_delivered else l.qty_ordered end
               as comprometido,
             l.unit_price, l.discount_pct, l.tax_rate,
             coalesce((
               select sum(il.qty) from public.customer_invoice_lines il
               join public.customer_invoices i on i.id = il.invoice_id
               where il.order_line_id = l.id and i.status <> 'void'
             ), 0) as facturado
      from public.sales_orders o
      join public.sales_order_lines l on l.order_id = o.id
      where o.tenant_id = ${tenantId} and o.customer_id = ${customerId}
        and o.status <> 'draft'
        and (${excluirPedido}::uuid is null or o.id <> ${excluirPedido}::uuid)
        and not exists (
          select 1 from public.customer_invoices i
          where i.tenant_id = o.tenant_id and i.source_type = 'sales_order'
            and i.source_id = o.id and i.status <> 'void'
            and not exists (select 1 from public.customer_invoice_lines il where il.invoice_id = i.id))
    )
    select coalesce(round(sum(
             greatest(comprometido - facturado, 0) * unit_price
             * (1 - discount_pct / 100) * (1 + tax_rate)), 2), 0)::text as pendiente
    from lin`
  return Number(r?.pendiente ?? 0)
}

export async function situacionDeCredito(
  tx: TransactionSql,
  tenantId: string,
  customerId: string,
  opciones: { excluirPedido?: string | null; montoDocumento: number; asOf?: Date },
): Promise<SituacionDeCredito> {
  const [cli] = await tx<{ name: string; credit_limit: string | null }[]>`
    select name, credit_limit::text from public.customers
    where id = ${customerId} and tenant_id = ${tenantId}`

  const facturas = await tx<{ number: string; saldo: string; due_date: string }[]>`
    select number, public.invoice_balance(id)::text as saldo, due_date::text
    from public.customer_invoices
    where tenant_id = ${tenantId} and customer_id = ${customerId} and status <> 'void'`

  const uninvoicedOrders = await pedidosSinFacturar(
    tx,
    tenantId,
    customerId,
    opciones.excluirPedido ?? null,
  )
  const overdueBlockDays = await politicaDeCredito(tx, tenantId)
  const limite = cli?.credit_limit ?? null
  const creditLimit = limite === null ? null : Number(limite)

  const d = evaluateCredit({
    creditLimit,
    invoices: facturas.map((f) => ({
      number: f.number,
      balance: Number(f.saldo),
      dueDate: new Date(`${f.due_date}T12:00:00`),
    })),
    uninvoicedOrders,
    documentTotal: opciones.montoDocumento,
    overdueBlockDays,
    asOf: opciones.asOf ?? new Date(),
  })

  const customerName = cli?.name ?? 'este cliente'
  return {
    ...d,
    customerName,
    creditLimit,
    overdueBlockDays,
    uninvoicedOrders,
    mensaje: d.allowed ? null : creditBlockMessage(customerName, d.blocks),
  }
}

/** Si ya hay una excepcion autorizada para ESTE pedido (en cualquier etapa). */
export async function excepcionDelPedido(
  tx: TransactionSql,
  tenantId: string,
  orderId: string,
): Promise<boolean> {
  const [r] = await tx<{ hay: boolean }[]>`
    select exists (select 1 from public.credit_overrides
                   where tenant_id = ${tenantId} and order_id = ${orderId}) as hay`
  return r?.hay ?? false
}

export interface PedidoDeCredito {
  customerId: string
  orderId: string
  montoDocumento: number
  etapa: 'confirm' | 'invoice'
  /** Lo que mando el formulario: si se pidio la excepcion y por que. */
  excepcion: { pedida: boolean; motivo: string }
}

/**
 * La puerta del credito. Devuelve ok, o el porque del bloqueo.
 *
 * Con excepcion pedida: exige `ar.credit.override` -con el monto, para
 * que un tope de `max_amount` del rol tambien aplique-, un motivo, y la
 * deja escrita en `credit_overrides` (con su linea en audit.log) y en el
 * evento `ar.credit.overridden`. Todo dentro de la misma transaccion que
 * confirma o factura: si la venta no se completa, la excepcion tampoco
 * queda.
 *
 * La excepcion autorizada al confirmar cubre la factura de ESE pedido: la
 * mercancia ya salio con la firma de alguien, y pedir otra firma para
 * cobrarla no protege nada.
 */
export async function exigirCredito(
  tx: TransactionSql,
  ctx: ModulePageCtx,
  p: PedidoDeCredito,
): Promise<ActionResult> {
  if (p.etapa === 'invoice' && (await excepcionDelPedido(tx, ctx.tenantId, p.orderId))) {
    return { ok: true }
  }

  const s = await situacionDeCredito(tx, ctx.tenantId, p.customerId, {
    excluirPedido: p.orderId,
    montoDocumento: p.montoDocumento,
  })
  if (s.allowed) return { ok: true }
  if (!p.excepcion.pedida) return { ok: false, error: s.mensaje! }

  const permiso = exigir(ctx, 'ar', 'ar.credit.override', p.montoDocumento)
  if (!permiso.ok) {
    return {
      ok: false,
      error: `${s.mensaje} Autorizar la excepcion requiere el permiso ar.credit.override: ${permiso.error}`,
    }
  }
  const motivo = p.excepcion.motivo.trim()
  if (motivo.length < 4) {
    return {
      ok: false,
      error:
        'Escribe el motivo de la excepcion (quien responde, cuando paga): queda en la bitacora con tu nombre.',
    }
  }

  const bloqueos = s.blocks.map((b) => b.code)
  await tx`
    insert into public.credit_overrides
      (tenant_id, customer_id, order_id, stage, blocks, document_total, exposure,
       credit_limit, oldest_overdue_days, overdue_block_days, reason, authorized_by)
    values (${ctx.tenantId}, ${p.customerId}, ${p.orderId}, ${p.etapa}, ${bloqueos}::text[],
            ${p.montoDocumento}, ${s.exposure}, ${s.creditLimit}, ${s.oldestOverdueDays},
            ${s.overdueBlockDays}, ${motivo}, ${ctx.userId})`

  await tx`
    select public.emit_event('ar.credit.overridden',
      ${JSON.stringify({
        orderId: p.orderId,
        customerId: p.customerId,
        stage: p.etapa,
        blocks: bloqueos,
        documentTotal: p.montoDocumento,
      })}::text::jsonb, 'ar')`

  return { ok: true }
}
