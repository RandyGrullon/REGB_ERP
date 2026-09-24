'use server'

import { revalidatePath } from 'next/cache'
import { transicionValidaPedidoCanal, type EstadoPedidoCanal } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de E-commerce sync (modulo 36, F9/S60).
 *
 * Deliberadamente sin llamadas reales a Shopify/WooCommerce/
 * Tiendanube: "sincronizar" solo registra la fecha, y "simular pedido
 * entrante" registra el pedido tal cual llegaria por un webhook -el
 * total nunca se recalcula despues, es el mismo que se capturo al
 * recibirlo-.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function crearCanal(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ecommerce', 'ecommerce.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const platform = String(fd.get('platform') ?? '')
  const storeUrl = String(fd.get('storeUrl') ?? '').trim() || null

  if (!name) return { ok: false, error: 'Falta el nombre del canal.' }
  if (!['shopify', 'woocommerce', 'tiendanube'].includes(platform))
    return { ok: false, error: 'Elige una plataforma valida.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.sales_channels (tenant_id, name, platform, store_url)
    values (${ctx.tenantId}, ${name}, ${platform}, ${storeUrl})`,
  )

  revalidatePath('/ecommerce')
  return { ok: true }
}

export async function vincularProducto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ecommerce', 'ecommerce.manage')
  if (!permiso.ok) return permiso

  const channelId = String(fd.get('channelId') ?? '')
  const productId = String(fd.get('productId') ?? '')
  const externalSku = String(fd.get('externalSku') ?? '').trim()

  if (!channelId) return { ok: false, error: 'Elige el canal.' }
  if (!productId) return { ok: false, error: 'Elige el producto.' }
  if (!externalSku) return { ok: false, error: 'Falta el SKU externo.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.channel_product_links (tenant_id, channel_id, product_id, external_sku, synced_at)
    values (${ctx.tenantId}, ${channelId}, ${productId}, ${externalSku}, now())`,
  )

  revalidatePath('/ecommerce')
  return { ok: true }
}

/** Re-sincronizar solo registra la fecha -no hay una llamada real al canal externo-. */
export async function sincronizarVinculo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ecommerce', 'ecommerce.manage')
  if (!permiso.ok) return permiso

  const linkId = String(fd.get('linkId') ?? '')

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    update public.channel_product_links set synced_at = now()
    where id = ${linkId} and tenant_id = ${ctx.tenantId}`,
  )

  revalidatePath('/ecommerce')
  return { ok: true }
}

/** Registra un pedido tal cual llegaria por un webhook real -una linea, total = cantidad x precio unitario-. */
export async function simularPedidoEntrante(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ecommerce', 'ecommerce.manage')
  if (!permiso.ok) return permiso

  const channelId = String(fd.get('channelId') ?? '')
  const externalOrderId = String(fd.get('externalOrderId') ?? '').trim()
  const customerName = String(fd.get('customerName') ?? '').trim()
  const customerEmail = String(fd.get('customerEmail') ?? '').trim() || null
  const productId = String(fd.get('productId') ?? '') || null
  const externalSku = String(fd.get('externalSku') ?? '').trim()
  const quantity = Number(fd.get('quantity') ?? '')
  const unitPrice = Number(fd.get('unitPrice') ?? '')

  if (!channelId) return { ok: false, error: 'Elige el canal.' }
  if (!externalOrderId) return { ok: false, error: 'Falta el numero de pedido externo.' }
  if (!customerName) return { ok: false, error: 'Falta el nombre del cliente.' }
  if (!externalSku) return { ok: false, error: 'Falta el SKU externo.' }
  if (!Number.isFinite(quantity) || quantity <= 0)
    return { ok: false, error: 'La cantidad debe ser mayor que cero.' }
  if (!Number.isFinite(unitPrice) || unitPrice < 0)
    return { ok: false, error: 'El precio unitario no puede ser negativo.' }

  const total = Math.round(quantity * unitPrice * 100) / 100

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [pedido] = await tx<{ id: string }[]>`
      insert into public.channel_orders (tenant_id, channel_id, external_order_id, customer_name, customer_email, total)
      values (${ctx.tenantId}, ${channelId}, ${externalOrderId}, ${customerName}, ${customerEmail}, ${total})
      returning id`

    await tx`
      insert into public.channel_order_lines (tenant_id, order_id, product_id, external_sku, quantity, unit_price)
      values (${ctx.tenantId}, ${pedido!.id}, ${productId}, ${externalSku}, ${quantity}, ${unitPrice})`

    await tx`
      select public.emit_event('ecommerce.order.received',
        ${JSON.stringify({ orderId: pedido!.id })}::text::jsonb, 'ecommerce')`
  })

  revalidatePath('/ecommerce')
  return { ok: true }
}

/** Avanza el estado del pedido -recibido a importado o cancelado, ambos terminales-. */
export async function transicionarPedido(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ecommerce', 'ecommerce.manage')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoPedidoCanal

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [p] = await tx<{ status: EstadoPedidoCanal }[]>`
      select status from public.channel_orders where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
    if (!p) return 'no-existe'
    if (!transicionValidaPedidoCanal(p.status, siguiente)) return 'Ese pedido ya se resolvio.'

    await tx`
      update public.channel_orders set status = ${siguiente}, resolved_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    if (siguiente === 'imported') {
      await tx`
        select public.emit_event('ecommerce.order.imported',
          ${JSON.stringify({ orderId })}::text::jsonb, 'ecommerce')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese pedido no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/ecommerce/${orderId}`)
  revalidatePath('/ecommerce')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearCanalForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearCanal(fd), 'crearCanal')
}
export async function vincularProductoForm(fd: FormData): Promise<void> {
  await anotarAviso(await vincularProducto(fd), 'vincularProducto')
}
export async function sincronizarVinculoForm(fd: FormData): Promise<void> {
  await anotarAviso(await sincronizarVinculo(fd), 'sincronizarVinculo')
}
export async function simularPedidoEntranteForm(fd: FormData): Promise<void> {
  await anotarAviso(await simularPedidoEntrante(fd), 'simularPedidoEntrante')
}
export async function transicionarPedidoForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarPedido(fd), 'transicionarPedido')
}
