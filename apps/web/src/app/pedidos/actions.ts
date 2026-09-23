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
import { anotarAviso } from '@/lib/aviso'
import { precioDeVenta } from '@/lib/precio'
import { sinExcepciones } from '@/lib/accion-segura'
import { exigirCredito } from '@/lib/credito'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de pedidos (S20).
 *
 * RESERVAR NO ES ENTREGAR: confirmar aparta unidades (movimiento
 * `reservation`, que solo sube `qty_reserved`); entregar es lo que las saca
 * del almacen (movimiento `sale`, que baja `qty_on_hand`). El almacenista
 * cuenta lo fisico y le cuadra en los dos momentos.
 *
 * Toda accion pasa por `sinExcepciones`: un error de la base se devuelve
 * como aviso y no tira la pantalla (analisis de flujo, hallazgo 2).
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

interface DatosCliente {
  name: string
  taxId: string | null
  phone: string | null
  email: string | null
  address: string | null
  terms: number
}

/**
 * Lee y valida lo que comparten alta y edicion.
 *
 * El RNC se valida AQUI, no en la DGII. Un RNC mal tecleado no se nota al
 * guardarlo: se nota el dia 20, cuando el 607 rebota entero y hay que
 * rehacerlo con la fecha limite encima. El digito verificador (modulo 11
 * para RNC, Luhn para cedula) atrapa ese error en el momento en que se
 * comete, que es cuando cuesta un segundo arreglarlo.
 *
 * Queda opcional a proposito: un consumidor final no tiene RNC y
 * obligarlo trancaria el alta de la mitad de los clientes de un colmado.
 */
function leerCliente(fd: FormData): DatosCliente | { error: string } {
  const name = String(fd.get('name') ?? '').trim()
  const taxIdRaw = String(fd.get('taxId') ?? '').trim()
  const phone = String(fd.get('phone') ?? '').trim() || null
  const email = String(fd.get('email') ?? '').trim() || null
  const address = String(fd.get('address') ?? '').trim() || null
  const terms = num(String(fd.get('terms') ?? '0')) ?? 0

  if (name.length < 2) return { error: 'El nombre necesita al menos 2 letras.' }
  if (!Number.isInteger(terms) || terms < 0 || terms > 365) {
    return { error: 'Los dias de credito van de 0 (contado) a 365.' }
  }

  const taxId = taxIdRaw === '' ? null : normalizeTaxId(taxIdRaw)
  if (taxId !== null && !isValidTaxId(taxId)) {
    return {
      error:
        `"${taxIdRaw}" no es un RNC ni una cedula valida: el digito verificador no cuadra. ` +
        'Revisalo con el cliente — un RNC malo hace rebotar el 607 completo.',
    }
  }
  return { name, taxId, phone, email, address, terms }
}

/**
 * El limite de credito, si vino en el formulario.
 *
 * - campo ausente: no se toca (el rol no lo ve, y no lo cambia).
 * - campo vacio: sin limite (null).
 * - numero: el limite. Exige `ar.credit.manage`: el vendedor da de alta
 *   clientes, pero no decide cuanto se les fia.
 */
function leerLimite(
  fd: FormData,
  ctx: Parameters<typeof exigir>[0],
): { presente: false } | { presente: true; valor: number | null } | { error: string } {
  if (!fd.has('creditLimit')) return { presente: false }
  const raw = String(fd.get('creditLimit') ?? '').trim()
  const permiso = exigir(ctx, 'ar', 'ar.credit.manage')
  if (!permiso.ok) {
    return { error: `Fijar el limite de credito requiere ar.credit.manage: ${permiso.error}` }
  }
  if (raw === '') return { presente: true, valor: null }
  const valor = num(raw)
  if (valor === null || valor < 0) {
    return { error: 'El limite de credito es un monto de 0 en adelante, o vacio para no tener limite.' }
  }
  return { presente: true, valor: Math.round(valor * 100) / 100 }
}

export async function crearCliente(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('crearCliente', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'sales-orders', 'sales-orders.customers.manage')
    if (!permiso.ok) return permiso

    const datos = leerCliente(fd)
    if ('error' in datos) return { ok: false, error: datos.error }
    const limite = leerLimite(fd, ctx)
    if ('error' in limite) return { ok: false, error: limite.error }

    await asUser(ctx.userId, ctx.tenantId, (tx) => {
      return tx`
        insert into public.customers
          (tenant_id, name, tax_id, phone, email, address, payment_terms, credit_limit)
        values (${ctx.tenantId}, ${datos.name}, ${datos.taxId}, ${datos.phone}, ${datos.email},
                ${datos.address}, ${datos.terms}, ${limite.presente ? limite.valor : null})`
    })

    revalidatePath('/pedidos/clientes')
    return { ok: true }
  })
}

/**
 * Corrige los datos de un cliente.
 *
 * Antes no existia: un RNC mal digitado se quedaba asi para siempre, y
 * con el cada factura salia en B02 sin avisar. Las facturas ya emitidas
 * NO cambian -`buyer_tax_id` se congelo al emitir, como pide el 607-.
 */
export async function editarCliente(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('editarCliente', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'sales-orders', 'sales-orders.customers.manage')
    if (!permiso.ok) return permiso

    const id = String(fd.get('id') ?? '')
    if (!id) return { ok: false, error: 'Faltan datos.' }
    const datos = leerCliente(fd)
    if ('error' in datos) return { ok: false, error: datos.error }
    const limite = leerLimite(fd, ctx)
    if ('error' in limite) return { ok: false, error: limite.error }

    const filas = await asUser(ctx.userId, ctx.tenantId, (tx) =>
      limite.presente
        ? tx`
            update public.customers
            set name = ${datos.name}, tax_id = ${datos.taxId}, phone = ${datos.phone},
                email = ${datos.email}, address = ${datos.address},
                payment_terms = ${datos.terms}, credit_limit = ${limite.valor},
                updated_at = now()
            where id = ${id} and tenant_id = ${ctx.tenantId}
            returning id`
        : tx`
            update public.customers
            set name = ${datos.name}, tax_id = ${datos.taxId}, phone = ${datos.phone},
                email = ${datos.email}, address = ${datos.address},
                payment_terms = ${datos.terms}, updated_at = now()
            where id = ${id} and tenant_id = ${ctx.tenantId}
            returning id`,
    )
    if (filas.length === 0) return { ok: false, error: 'Ese cliente no existe.' }

    revalidatePath('/pedidos/clientes')
    revalidatePath(`/pedidos/clientes/${id}`)
    revalidatePath('/cobrar')
    return { ok: true }
  })
}

export async function alternarCliente(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('alternarCliente', async () => {
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
  })
}

// ── Pedidos ──────────────────────────────────────────────────────────────

/** Crea el pedido en borrador. Las lineas se agregan despues. */
export async function crearPedido(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('crearPedido', async () => {
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
  })
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
  return sinExcepciones('agregarLinea', async () => {
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
      // cantidad; si no hay lista aplicable, del catalogo. La lista
      // ASIGNADA en su ficha gana a todo (antes se guardaba y se ignoraba).
      const { precio } = await precioDeVenta(
        tx,
        ctx.tenantId,
        { productId, cantidad: qty, precioBase: Number(p.price) },
        { customerId: order.customer_id, channel: null, usarListaAsignada: true },
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
  })
}

export async function quitarLinea(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('quitarLinea', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'sales-orders', 'sales-orders.edit')
    if (!permiso.ok) return permiso

    const orderId = String(fd.get('orderId') ?? '')
    const lineId = String(fd.get('lineId') ?? '')
    if (!orderId || !lineId) return { ok: false, error: 'Faltan datos.' }

    const r = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [order] = await tx<{ status: string }[]>`
        select status from public.sales_orders
        where id = ${orderId} and tenant_id = ${ctx.tenantId}`
      if (order?.status !== 'draft') return 'no-borrador'
      await tx`
        delete from public.sales_order_lines
        where id = ${lineId} and order_id = ${orderId} and tenant_id = ${ctx.tenantId}`
      await recalcular(tx, ctx.tenantId, orderId)
      return 'ok'
    })
    if (r === 'no-borrador') {
      return { ok: false, error: 'Solo se quitan lineas de un pedido en borrador.' }
    }

    revalidatePath(`/pedidos/${orderId}`)
    return { ok: true }
  })
}

/**
 * Confirma el pedido y APARTA existencia.
 *
 * Reserva parcial permitida: si hay 8 de 10, aparta 8 y las 2 quedan en
 * backorder. Rechazar el pedido entero por faltar dos unidades no es como
 * opera un mostrador (planFulfillment, §5.3). Sin NADA de existencia el
 * pedido queda igual confirmado, con todo en backorder: antes volvia a
 * borrador mientras el aviso decia "quedo hecho".
 *
 * Antes de apartar se mira el CREDITO del cliente (0130): limite y
 * facturas vencidas. Bloqueado, no se confirma -salvo excepcion autorizada
 * por quien tiene `ar.credit.override`, que queda escrita-.
 */
export async function confirmarPedido(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('confirmarPedido', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'sales-orders', 'sales-orders.confirm')
    if (!permiso.ok) return permiso

    const orderId = String(fd.get('orderId') ?? '')
    if (!orderId) return { ok: false, error: 'Faltan datos.' }
    const excepcion = {
      pedida: String(fd.get('creditOverride') ?? '') === '1',
      motivo: String(fd.get('overrideReason') ?? ''),
    }

    const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [order] = await tx<
        { status: string; warehouse_id: string; total: string; customer_id: string }[]
      >`
        select status, warehouse_id, total::text, customer_id from public.sales_orders
        where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
      if (!order) return { ok: false as const, error: 'Ese pedido no existe.' }
      if (order.status !== 'draft') {
        return { ok: false as const, error: 'Este pedido ya fue confirmado.' }
      }

      const lines = await tx<
        { id: string; product_id: string; qty_ordered: string; tracks_stock: boolean }[]
      >`
        select sol.id, sol.product_id, sol.qty_ordered::text, p.tracks_stock
        from public.sales_order_lines sol
        join public.products p on p.id = sol.product_id
        where sol.order_id = ${orderId} and sol.tenant_id = ${ctx.tenantId}`
      if (lines.length === 0) {
        return { ok: false as const, error: 'Agrega al menos una linea antes de confirmar.' }
      }

      const credito = await exigirCredito(tx, ctx, {
        customerId: order.customer_id,
        orderId,
        montoDocumento: Number(order.total),
        etapa: 'confirm',
        excepcion,
      })
      if (!credito.ok) return credito

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
        set status = ${deriveOrderStatus(estado, false, true)}, confirmed_at = now(),
            updated_at = now()
        where id = ${orderId} and tenant_id = ${ctx.tenantId}`

      await tx`
        select public.emit_event('sales-orders.order.confirmed',
          ${JSON.stringify({ orderId, total: Number(order.total) })}::text::jsonb, 'sales-orders')`

      return { ok: true as const }
    })

    if (!resultado.ok) return resultado

    revalidatePath(`/pedidos/${orderId}`)
    revalidatePath('/pedidos')
    revalidatePath('/inventory')
    return { ok: true }
  })
}

/**
 * Entrega una linea: libera la reserva y SACA la mercancia del almacen.
 * Es el unico momento en que baja `qty_on_hand`.
 */
export async function entregarLinea(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('entregarLinea', async () => {
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
        where sol.id = ${lineId} and sol.order_id = ${orderId} and sol.tenant_id = ${ctx.tenantId}
        for update of sol`
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

      // Ya esta confirmado: entregar nunca lo devuelve a borrador.
      const estadoPedido = deriveOrderStatus(nuevo, false, true)
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
    revalidatePath('/cobrar')
    return { ok: true }
  })
}

/**
 * Cancela lo PENDIENTE del pedido y devuelve lo apartado.
 *
 * - Entregado completo: no se cancela. La mercancia ya salio; si el
 *   cliente la devuelve, eso es una nota de credito sobre la factura, no
 *   borrar el pedido. Antes se podia, y un pedido entregado y facturado
 *   quedaba "cancelado" con su factura viva.
 * - Entregado a medias: se cancela el resto. Lo entregado NO se revierte
 *   y sigue apareciendo en "sin facturar" hasta que se facture: cancelar
 *   no puede ser la forma de regalar lo que ya salio.
 */
export async function cancelarPedido(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('cancelarPedido', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'sales-orders', 'sales-orders.cancel')
    if (!permiso.ok) return permiso

    const orderId = String(fd.get('orderId') ?? '')
    if (!orderId) return { ok: false, error: 'Faltan datos.' }

    const r = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [order] = await tx<{ status: string; warehouse_id: string }[]>`
        select status, warehouse_id from public.sales_orders
        where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
      if (!order) return 'no-existe'
      if (order.status === 'cancelled') return 'ya-cancelado'
      if (order.status === 'delivered') return 'entregado'

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
      return 'ok'
    })

    if (r === 'no-existe') return { ok: false, error: 'Ese pedido no existe.' }
    if (r === 'ya-cancelado') return { ok: false, error: 'Ese pedido ya estaba cancelado.' }
    if (r === 'entregado') {
      return {
        ok: false,
        error:
          'Este pedido ya se entrego completo: no se cancela. Si el cliente devuelve mercancia, ' +
          'emite una nota de credito sobre su factura.',
      }
    }

    revalidatePath(`/pedidos/${orderId}`)
    revalidatePath('/pedidos')
    revalidatePath('/inventory')
    revalidatePath('/cobrar')
    return { ok: true }
  })
}

// ── Envoltorios para <form action> ─────────────────────────────────────
export async function crearClienteForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearCliente(fd), 'crearCliente')
}
export async function editarClienteForm(fd: FormData): Promise<void> {
  await anotarAviso(await editarCliente(fd), 'editarCliente')
}
export async function alternarClienteForm(fd: FormData): Promise<void> {
  await anotarAviso(await alternarCliente(fd), 'alternarCliente')
}
export async function crearPedidoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearPedido(fd), 'crearPedido')
}
export async function agregarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await agregarLinea(fd), 'agregarLinea')
}
export async function quitarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await quitarLinea(fd), 'quitarLinea')
}
export async function confirmarPedidoForm(fd: FormData): Promise<void> {
  const r = await confirmarPedido(fd)
  // Una excepcion autorizada no es un "quedo hecho" cualquiera: el aviso
  // lo dice, para que quien firmo sepa que quedo escrito.
  const conExcepcion = r.ok && String(fd.get('creditOverride') ?? '') === '1'
  await anotarAviso(
    r,
    'confirmarPedido',
    conExcepcion ? 'Confirmado con excepcion de credito. Quedo escrita con tu nombre y el motivo.' : undefined,
  )
}
export async function entregarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await entregarLinea(fd), 'entregarLinea')
}
export async function cancelarPedidoForm(fd: FormData): Promise<void> {
  await anotarAviso(await cancelarPedido(fd), 'cancelarPedido')
}
