'use server'

import { revalidatePath } from 'next/cache'
import {
  deriveOrderStatus,
  documentTotals,
  lineTotals,
  isValidTaxId,
  normalizeTaxId,
  planFulfillment,
  validateDelivery,
  type OrderLineState,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { precioDeVenta } from '@/lib/precio'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de pedidos (S20).
 *
 * RESERVAR NO ES ENTREGAR: confirmar aparta unidades (movimiento
 * `reservation`, que solo sube `qty_reserved`); entregar es lo que las saca
 * del almacen (movimiento `sale`, que baja `qty_on_hand`). El almacenista
 * cuenta lo fisico y le cuadra en los dos momentos.
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

// ── Clientes ─────────────────────────────────────────────────────────────

export async function crearCliente(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'sales-orders', 'sales-orders.customers.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const taxIdRaw = String(fd.get('taxId') ?? '').trim()
  const phone = String(fd.get('phone') ?? '').trim() || null
  const email = String(fd.get('email') ?? '').trim() || null
  const terms = num(String(fd.get('terms') ?? '0')) ?? 0

  if (name.length < 2) return { ok: false, error: 'El nombre necesita al menos 2 letras.' }
  if (terms < 0) return { ok: false, error: 'Los dias de credito no pueden ser negativos.' }

  // El RNC se valida AQUI, no en la DGII.
  //
  // Un RNC mal tecleado no se nota al guardarlo: se nota el dia 20, cuando
  // el 607 rebota entero y hay que rehacerlo con la fecha limite encima.
  // El digito verificador (modulo 11 para RNC, Luhn para cedula) atrapa
  // ese error en el momento en que se comete, que es cuando cuesta un
  // segundo arreglarlo.
  //
  // Queda opcional a proposito: un consumidor final no tiene RNC y
  // obligarlo trancaria el alta de la mitad de los clientes de un colmado.
  const taxId = taxIdRaw === '' ? null : normalizeTaxId(taxIdRaw)
  if (taxId !== null && !isValidTaxId(taxId)) {
    return {
      ok: false,
      error:
        `"${taxIdRaw}" no es un RNC ni una cedula valida: el digito verificador no cuadra. ` +
        'Revisalo con el cliente — un RNC malo hace rebotar el 607 completo.',
    }
  }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      insert into public.customers (tenant_id, name, tax_id, phone, email, payment_terms)
      values (${ctx.tenantId}, ${name}, ${taxId}, ${phone}, ${email}, ${terms})`
  })

  revalidatePath('/pedidos/clientes')
  return { ok: true }
}

export async function alternarCliente(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'sales-orders', 'sales-orders.customers.manage')
  if (!permiso.ok) return permiso

  const id = String(fd.get('id') ?? '')
  if (!id) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.customers set is_active = not is_active, updated_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath('/pedidos/clientes')
  return { ok: true }
}

// ── Pedidos ──────────────────────────────────────────────────────────────

/** Crea el pedido en borrador. Las lineas se agregan despues. */
export async function crearPedido(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'sales-orders', 'sales-orders.create')
  if (!permiso.ok) return permiso

  const customerId = String(fd.get('customerId') ?? '')
  const warehouseId = String(fd.get('warehouseId') ?? '')
  if (!customerId || !warehouseId) return { ok: false, error: 'Elige cliente y almacen.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [n] = await tx<{ next_sales_order_number: string }[]>`
      select public.next_sales_order_number(${ctx.tenantId})`
    await tx`
      insert into public.sales_orders
        (tenant_id, number, customer_id, warehouse_id, created_by)
      values (${ctx.tenantId}, ${n!.next_sales_order_number}, ${customerId},
              ${warehouseId}, ${ctx.userId})`
  })

  revalidatePath('/pedidos')
  return { ok: true }
}

/** Recalcula totales del encabezado a partir de sus lineas. */
async function recalcular(
  tx: Parameters<Parameters<typeof asUser>[2]>[0],
  tenantId: string,
  orderId: string,
): Promise<void> {
  const lines = await tx<
    { qty_ordered: string; unit_price: string; discount_pct: string; tax_rate: string }[]
  >`
    select qty_ordered::text, unit_price::text, discount_pct::text, tax_rate::text
    from public.sales_order_lines
    where order_id = ${orderId} and tenant_id = ${tenantId}`

  // `tax_rate` va en FRACCION (0.18) en toda la base y en el motor. Ver la
  // migracion 0021: el check 0..1 impide que alguien vuelva a meter un 18.
  const totales = documentTotals(
    lines.map((l) => ({
      quantity: Number(l.qty_ordered),
      unitPrice: Number(l.unit_price),
      discountPct: Number(l.discount_pct),
      taxRate: Number(l.tax_rate),
    })),
  )

  await tx`
    update public.sales_orders
    set subtotal = ${totales.subtotal}, discount = ${totales.discount},
        tax = ${totales.tax}, total = ${totales.total}, updated_at = now()
    where id = ${orderId} and tenant_id = ${tenantId}`
}

export async function agregarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'sales-orders', 'sales-orders.edit')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const productId = String(fd.get('productId') ?? '')
  const qty = num(String(fd.get('qty') ?? ''))
  const descuento = num(String(fd.get('discountPct') ?? '0')) ?? 0

  if (!orderId || !productId) return { ok: false, error: 'Faltan datos.' }
  if (qty === null || qty <= 0) return { ok: false, error: 'La cantidad debe ser positiva.' }
  if (descuento < 0 || descuento > 100) return { ok: false, error: 'El descuento va de 0 a 100.' }

  // Aplicar descuento es un permiso aparte: el cajero vende, el gerente rebaja.
  if (descuento > 0) {
    const pd = exigir(ctx, 'sales-orders', 'sales-orders.discount')
    if (!pd.ok) return pd
  }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string; customer_id: string | null }[]>`
      select status, customer_id from public.sales_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    if (!order) return 'no-existe'
    if (order.status !== 'draft') return 'no-borrador'

    const [p] = await tx<{ price: string; tax_rate: string }[]>`
      select price::text, tax_rate::text from public.products
      where id = ${productId} and tenant_id = ${ctx.tenantId}`
    if (!p) return 'sin-producto'

    // El precio sale de la lista que le toque a ESTE cliente en ESTA
    // cantidad; si no hay lista aplicable, del catalogo. Antes se cobraba
    // siempre el catalogo y la lista de precios no servia de nada.
    const { precio } = await precioDeVenta(
      tx,
      ctx.tenantId,
      { productId, cantidad: qty, precioBase: Number(p.price) },
      { customerId: order.customer_id, channel: null },
    )

    const totals = lineTotals({
      quantity: qty,
      unitPrice: precio,
      discountPct: descuento,
      taxRate: Number(p.tax_rate), // fraccion en toda la base (0021)
    })

    await tx`
      insert into public.sales_order_lines
        (order_id, tenant_id, product_id, qty_ordered, unit_price, discount_pct, tax_rate, line_total)
      values (${orderId}, ${ctx.tenantId}, ${productId}, ${qty}, ${precio},
              ${descuento}, ${p.tax_rate}, ${totals.total})`

    await recalcular(tx, ctx.tenantId, orderId)
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese pedido no existe.' }
  if (resultado === 'no-borrador') {
    return { ok: false, error: 'Solo se pueden agregar lineas a un pedido en borrador.' }
  }
  if (resultado === 'sin-producto') return { ok: false, error: 'Ese producto no existe.' }

  revalidatePath(`/pedidos/${orderId}`)
  return { ok: true }
}

export async function quitarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'sales-orders', 'sales-orders.edit')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const lineId = String(fd.get('lineId') ?? '')
  if (!orderId || !lineId) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string }[]>`
      select status from public.sales_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    if (order?.status !== 'draft') return
    await tx`
      delete from public.sales_order_lines
      where id = ${lineId} and tenant_id = ${ctx.tenantId}`
    await recalcular(tx, ctx.tenantId, orderId)
  })

  revalidatePath(`/pedidos/${orderId}`)
  return { ok: true }
}

/**
 * Confirma el pedido y APARTA existencia.
 *
 * Reserva parcial permitida: si hay 8 de 10, aparta 8 y las 2 quedan en
 * backorder. Rechazar el pedido entero por faltar dos unidades no es como
 * opera un mostrador (planFulfillment, §5.3).
 */
export async function confirmarPedido(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'sales-orders', 'sales-orders.confirm')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  if (!orderId) return { ok: false, error: 'Faltan datos.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string; warehouse_id: string; total: string }[]>`
      select status, warehouse_id, total::text from public.sales_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
    if (!order) return 'no-existe'
    if (order.status !== 'draft') return 'no-borrador'

    const lines = await tx<
      { id: string; product_id: string; qty_ordered: string; tracks_stock: boolean }[]
    >`
      select sol.id, sol.product_id, sol.qty_ordered::text, p.tracks_stock
      from public.sales_order_lines sol
      join public.products p on p.id = sol.product_id
      where sol.order_id = ${orderId} and sol.tenant_id = ${ctx.tenantId}`
    if (lines.length === 0) return 'sin-lineas'

    for (const l of lines) {
      // Un concepto sin existencias (envio, instalacion) no se reserva
      // porque no hay nada que apartar. Se marca como servido igual, si
      // no el pedido se quedaria "parcialmente reservado" para siempre
      // esperando una mercancia que no existe.
      if (!l.tracks_stock) {
        await tx`
          update public.sales_order_lines set qty_reserved = qty_ordered
          where id = ${l.id} and tenant_id = ${ctx.tenantId}`
        continue
      }

      const [nivel] = await tx<{ qty_on_hand: string; qty_reserved: string }[]>`
        select qty_on_hand::text, qty_reserved::text from public.stock_levels
        where tenant_id = ${ctx.tenantId} and warehouse_id = ${order.warehouse_id}
          and product_id = ${l.product_id}`

      const disponible = nivel ? Number(nivel.qty_on_hand) - Number(nivel.qty_reserved) : 0
      const plan = planFulfillment(Number(l.qty_ordered), disponible)

      if (plan.toReserve > 0) {
        await tx`
          insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty,
             reference_type, reference_id, created_by)
          values (${ctx.tenantId}, ${order.warehouse_id}, ${l.product_id},
                  'reservation', ${plan.toReserve}, 'sales_order', ${orderId}, ${ctx.userId})`
        await tx`
          update public.sales_order_lines set qty_reserved = ${plan.toReserve}
          where id = ${l.id} and tenant_id = ${ctx.tenantId}`
      }
    }

    const estado = await tx<OrderLineState[]>`
      select qty_ordered::float8 as "qtyOrdered", qty_reserved::float8 as "qtyReserved",
             qty_delivered::float8 as "qtyDelivered"
      from public.sales_order_lines where order_id = ${orderId} and tenant_id = ${ctx.tenantId}`

    await tx`
      update public.sales_orders
      set status = ${deriveOrderStatus(estado)}, confirmed_at = now(), updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('sales-orders.order.confirmed',
        ${JSON.stringify({ orderId, total: Number(order.total) })}::text::jsonb, 'sales-orders')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese pedido no existe.' }
  if (resultado === 'no-borrador') return { ok: false, error: 'Este pedido ya fue confirmado.' }
  if (resultado === 'sin-lineas') {
    return { ok: false, error: 'Agrega al menos una linea antes de confirmar.' }
  }

  revalidatePath(`/pedidos/${orderId}`)
  revalidatePath('/pedidos')
  revalidatePath('/inventory')
  return { ok: true }
}

/**
 * Entrega una linea: libera la reserva y SACA la mercancia del almacen.
 * Es el unico momento en que baja `qty_on_hand`.
 */
export async function entregarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'sales-orders', 'sales-orders.deliver')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const lineId = String(fd.get('lineId') ?? '')
  const qty = num(String(fd.get('qty') ?? ''))
  if (!orderId || !lineId) return { ok: false, error: 'Faltan datos.' }
  if (qty === null) return { ok: false, error: 'Cantidad no valida.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string; warehouse_id: string }[]>`
      select status, warehouse_id from public.sales_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
    if (!order) return 'no-existe'
    if (order.status === 'draft') return 'sin-confirmar'
    if (order.status === 'cancelled') return 'cancelado'

    const [line] = await tx<
      {
        product_id: string
        qty_ordered: string
        qty_reserved: string
        qty_delivered: string
        tracks_stock: boolean
      }[]
    >`
      select sol.product_id, sol.qty_ordered::text, sol.qty_reserved::text,
             sol.qty_delivered::text, p.tracks_stock
      from public.sales_order_lines sol
      join public.products p on p.id = sol.product_id
      where sol.id = ${lineId} and sol.tenant_id = ${ctx.tenantId}`
    if (!line) return 'sin-linea'

    const estado: OrderLineState = {
      qtyOrdered: Number(line.qty_ordered),
      qtyReserved: Number(line.qty_reserved),
      qtyDelivered: Number(line.qty_delivered),
    }
    const check = validateDelivery(estado, qty)
    if (!check.ok) return check.error

    // Lo apartado que se consume al entregar. Se descuenta de la linea
    // tambien en los conceptos sin existencias -ahi solo es contabilidad
    // del pedido, no un movimiento de almacen-.
    const liberar = Math.min(qty, estado.qtyReserved)

    // Un concepto sin existencias se entrega igual -el envio se hizo-
    // pero no sale de ningun almacen: no hay nada que liberar ni que
    // descontar en el kardex.
    if (line.tracks_stock) {
      if (liberar > 0) {
        await tx`
          insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty,
             reference_type, reference_id, created_by)
          values (${ctx.tenantId}, ${order.warehouse_id}, ${line.product_id},
                  'reservation_release', ${liberar}, 'sales_order', ${orderId}, ${ctx.userId})`
      }

      await tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty,
           reference_type, reference_id, created_by)
        values (${ctx.tenantId}, ${order.warehouse_id}, ${line.product_id},
                'sale', ${-qty}, 'sales_order', ${orderId}, ${ctx.userId})`
    }

    await tx`
      update public.sales_order_lines
      set qty_delivered = qty_delivered + ${qty},
          qty_reserved  = greatest(0, qty_reserved - ${liberar})
      where id = ${lineId} and tenant_id = ${ctx.tenantId}`

    const nuevo = await tx<OrderLineState[]>`
      select qty_ordered::float8 as "qtyOrdered", qty_reserved::float8 as "qtyReserved",
             qty_delivered::float8 as "qtyDelivered"
      from public.sales_order_lines where order_id = ${orderId} and tenant_id = ${ctx.tenantId}`

    const estadoPedido = deriveOrderStatus(nuevo)
    await tx`
      update public.sales_orders set status = ${estadoPedido}, updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    if (estadoPedido === 'delivered') {
      await tx`
        select public.emit_event('sales-orders.order.delivered',
          ${JSON.stringify({ orderId })}::text::jsonb, 'sales-orders')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese pedido no existe.' }
  if (resultado === 'sin-confirmar') return { ok: false, error: 'Confirma el pedido primero.' }
  if (resultado === 'cancelado') return { ok: false, error: 'El pedido esta cancelado.' }
  if (resultado === 'sin-linea') return { ok: false, error: 'Esa linea no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/pedidos/${orderId}`)
  revalidatePath('/inventory')
  return { ok: true }
}

/** Cancela el pedido y devuelve lo apartado. Lo entregado NO se revierte. */
export async function cancelarPedido(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'sales-orders', 'sales-orders.cancel')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  if (!orderId) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string; warehouse_id: string }[]>`
      select status, warehouse_id from public.sales_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
    if (!order || order.status === 'cancelled') return

    const lines = await tx<
      { id: string; product_id: string; qty_reserved: string; tracks_stock: boolean }[]
    >`
      select sol.id, sol.product_id, sol.qty_reserved::text, p.tracks_stock
      from public.sales_order_lines sol
      join public.products p on p.id = sol.product_id
      where sol.order_id = ${orderId} and sol.tenant_id = ${ctx.tenantId}`

    for (const l of lines) {
      const reservado = Number(l.qty_reserved)
      if (reservado <= 0) continue
      // Un concepto sin existencias tiene qty_reserved lleno para que el
      // pedido no quede colgado, pero nunca aparto nada: solo se limpia.
      if (!l.tracks_stock) {
        await tx`
          update public.sales_order_lines set qty_reserved = 0
          where id = ${l.id} and tenant_id = ${ctx.tenantId}`
        continue
      }
      await tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, reason,
           reference_type, reference_id, created_by)
        values (${ctx.tenantId}, ${order.warehouse_id}, ${l.product_id},
                'reservation_release', ${reservado}, 'Pedido cancelado',
                'sales_order', ${orderId}, ${ctx.userId})`
      await tx`
        update public.sales_order_lines set qty_reserved = 0
        where id = ${l.id} and tenant_id = ${ctx.tenantId}`
    }

    await tx`
      update public.sales_orders
      set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('sales-orders.order.cancelled',
        ${JSON.stringify({ orderId })}::text::jsonb, 'sales-orders')`
  })

  revalidatePath(`/pedidos/${orderId}`)
  revalidatePath('/pedidos')
  revalidatePath('/inventory')
  return { ok: true }
}

// ── Envoltorios para <form action> ─────────────────────────────────────
export async function crearClienteForm(fd: FormData): Promise<void> {
  await crearCliente(fd)
}
export async function alternarClienteForm(fd: FormData): Promise<void> {
  await alternarCliente(fd)
}
export async function crearPedidoForm(fd: FormData): Promise<void> {
  await crearPedido(fd)
}
export async function agregarLineaForm(fd: FormData): Promise<void> {
  await agregarLinea(fd)
}
export async function quitarLineaForm(fd: FormData): Promise<void> {
  await quitarLinea(fd)
}
export async function confirmarPedidoForm(fd: FormData): Promise<void> {
  await confirmarPedido(fd)
}
export async function entregarLineaForm(fd: FormData): Promise<void> {
  await entregarLinea(fd)
}
export async function cancelarPedidoForm(fd: FormData): Promise<void> {
  await cancelarPedido(fd)
}
