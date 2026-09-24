'use server'

import { revalidatePath } from 'next/cache'
import { transicionValidaTransferencia, type EstadoTransferencia } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de transferencias (modulo 50, F8/S47).
 *
 * `despacharTransferencia()` fija `qty_sent` en cada linea (lo que de
 * verdad sale del almacen de origen) y postea `transfer_out`;
 * `recibirTransferencia()` fija `qty_received` (lo que de verdad llega
 * al destino, que puede diferir de lo despachado) y postea
 * `transfer_in`. Ninguna de las dos toca `stock_transfers` -la version
 * simple de un paso que ya trae `inventory`-.
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

/** Crea una transferencia en borrador -sin lineas todavia-. */
export async function crearTransferencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'transfers', 'transfers.create')
  if (!permiso.ok) return permiso

  const fromWarehouseId = String(fd.get('fromWarehouseId') ?? '')
  const toWarehouseId = String(fd.get('toWarehouseId') ?? '')
  const notes = String(fd.get('notes') ?? '').trim() || null

  if (!fromWarehouseId) return { ok: false, error: 'Elige el almacen de origen.' }
  if (!toWarehouseId) return { ok: false, error: 'Elige el almacen de destino.' }
  if (fromWarehouseId === toWarehouseId) {
    return { ok: false, error: 'El origen y el destino no pueden ser el mismo almacen.' }
  }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.transfer_orders
        (tenant_id, from_warehouse_id, to_warehouse_id, notes, created_by)
      values (${ctx.tenantId}, ${fromWarehouseId}, ${toWarehouseId}, ${notes}, ${ctx.userId})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/transferencias')
  return { ok: true }
}

/** Agrega una linea a una transferencia todavia en borrador. */
export async function agregarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'transfers', 'transfers.create')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const productId = String(fd.get('productId') ?? '')
  const qty = num(String(fd.get('qty') ?? ''))
  if (!orderId) return { ok: false, error: 'Falta la transferencia.' }
  if (!productId) return { ok: false, error: 'Elige el producto.' }
  if (qty === null || qty <= 0) return { ok: false, error: 'La cantidad debe ser mayor que cero.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string }[]>`
      select status from public.transfer_orders where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    if (!order) return 'no-existe'
    if (order.status !== 'draft') return 'Solo se puede agregar lineas mientras esta en borrador.'

    // Un servicio (envio, instalacion) no tiene existencias: aceptarlo aqui
    // solo aplazaba el error al momento de despachar el camion.
    const [p] = await tx<{ tracks_stock: boolean; sku: string }[]>`
      select tracks_stock, sku from public.products
      where id = ${productId} and tenant_id = ${ctx.tenantId}`
    if (!p) return 'Ese producto no existe.'
    if (!p.tracks_stock) return `${p.sku} es un servicio: no tiene existencias que trasladar.`

    await tx`
      insert into public.transfer_order_lines (order_id, tenant_id, product_id, qty_requested)
      values (${orderId}, ${ctx.tenantId}, ${productId}, ${qty})`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa transferencia no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/transferencias/${orderId}`)
  return { ok: true }
}

/** Quita una linea -solo posible mientras la transferencia sigue en borrador-. */
export async function quitarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'transfers', 'transfers.create')
  if (!permiso.ok) return permiso

  const lineId = String(fd.get('lineId') ?? '')
  const orderId = String(fd.get('orderId') ?? '')
  if (!lineId) return { ok: false, error: 'Falta la linea.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      delete from public.transfer_order_lines where id = ${lineId} and tenant_id = ${ctx.tenantId}`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/transferencias/${orderId}`)
  return { ok: true }
}

/** Despacha la transferencia: fija qty_sent en cada linea y saca el stock del origen. */
export async function despacharTransferencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'transfers', 'transfers.dispatch')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  if (!orderId) return { ok: false, error: 'Falta la transferencia.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string; from_warehouse_id: string }[]>`
      select status, from_warehouse_id from public.transfer_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
    if (!order) return 'no-existe'
    if (!transicionValidaTransferencia(order.status as EstadoTransferencia, 'in_transit')) {
      return 'Esa transferencia ya no se puede despachar.'
    }

    const lineas = await tx<{ id: string; product_id: string; qty_requested: string }[]>`
      select id, product_id, qty_requested::text from public.transfer_order_lines
      where order_id = ${orderId} and tenant_id = ${ctx.tenantId}`
    if (lineas.length === 0) return 'Agrega al menos una linea antes de despachar.'

    // No se despacha lo que no esta. El kardex suma y resta sin mirar: sin
    // esto, el origen quedaba en negativo y el destino recibia existencia
    // inventada -el mismo agujero que 0111 cerro para el movil-. Se suma
    // por producto (dos lineas del mismo cuentan juntas) y se mira lo
    // FISICO: lo reservado esta en el estante y se puede mover.
    const faltantes = await tx<{ sku: string; pedido: string; hay: string }[]>`
      select p.sku, sum(l.qty_requested)::text as pedido,
             coalesce(max(sl.qty_on_hand), 0)::text as hay
      from public.transfer_order_lines l
      join public.products p on p.id = l.product_id
      left join public.stock_levels sl
        on sl.tenant_id = l.tenant_id and sl.warehouse_id = ${order.from_warehouse_id}
       and sl.product_id = l.product_id
      where l.order_id = ${orderId} and l.tenant_id = ${ctx.tenantId}
      group by p.sku
      having sum(l.qty_requested) > coalesce(max(sl.qty_on_hand), 0)
      order by p.sku`
    if (faltantes.length > 0) {
      const detalle = faltantes
        .map((f) => `${f.sku}: hay ${Number(f.hay)}, se piden ${Number(f.pedido)}`)
        .join('; ')
      return `No hay suficiente en el almacen de origen (${detalle}).`
    }

    for (const l of lineas) {
      await tx`
        update public.transfer_order_lines set qty_sent = ${l.qty_requested}
        where id = ${l.id} and tenant_id = ${ctx.tenantId}`

      await tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, created_by)
        values (${ctx.tenantId}, ${order.from_warehouse_id}, ${l.product_id},
                'transfer_out', ${-Number(l.qty_requested)}, 'transfer_order', ${orderId}, ${ctx.userId})`
    }

    await tx`
      update public.transfer_orders set status = 'in_transit', dispatched_at = now(), updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('transfers.order.dispatched',
        ${JSON.stringify({ orderId })}::text::jsonb, 'transfers')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa transferencia no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/transferencias/${orderId}`)
  revalidatePath('/transferencias')
  revalidatePath('/inventory')
  return { ok: true }
}

/** Recibe la transferencia: fija qty_received en cada linea y entra el stock al destino. */
export async function recibirTransferencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'transfers', 'transfers.receive')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  if (!orderId) return { ok: false, error: 'Falta la transferencia.' }

  const lineIds = fd.getAll('lineId').map(String)
  const recibidos = fd.getAll('qtyReceived').map((v) => num(String(v)))

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string; to_warehouse_id: string }[]>`
      select status, to_warehouse_id from public.transfer_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
    if (!order) return 'no-existe'
    if (!transicionValidaTransferencia(order.status as EstadoTransferencia, 'received')) {
      return 'Esa transferencia ya no se puede recibir.'
    }

    // Se valida TODO antes de escribir nada. Antes una linea en blanco se
    // saltaba en silencio -la transferencia quedaba "recibida" con esa
    // linea sin recibir, y la mercancia en ningun almacen- y se podia
    // recibir mas de lo que salio, creando existencia de la nada.
    const lineas = await tx<{ id: string; product_id: string; sku: string; qty_sent: string }[]>`
      select l.id, l.product_id, p.sku, coalesce(l.qty_sent, 0)::text as qty_sent
      from public.transfer_order_lines l
      join public.products p on p.id = l.product_id
      where l.order_id = ${orderId} and l.tenant_id = ${ctx.tenantId}`
    const porId = new Map(lineIds.map((id, i) => [id, recibidos[i] ?? null]))
    const aRecibir: { id: string; productId: string; qty: number }[] = []
    for (const l of lineas) {
      const qty = porId.get(l.id)
      if (qty === null || qty === undefined) {
        return `${l.sku}: escribe cuanto llego (0 si no llego nada).`
      }
      if (qty < 0) return `${l.sku}: la cantidad recibida no puede ser negativa.`
      if (qty > Number(l.qty_sent)) {
        return `${l.sku}: salieron ${Number(l.qty_sent)} y no pueden llegar ${qty}. Si llego de mas, fue un error al despachar: cuentalo en el origen.`
      }
      aRecibir.push({ id: l.id, productId: l.product_id, qty })
    }

    for (const r of aRecibir) {
      await tx`
        update public.transfer_order_lines set qty_received = ${r.qty}
        where id = ${r.id} and tenant_id = ${ctx.tenantId}`

      // Sin unit_cost a proposito: el costo lo pone la base (0137), que
      // copia el de la salida del origen. Sin eso entraba a costo cero.
      if (r.qty > 0) {
        await tx`
          insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, created_by)
          values (${ctx.tenantId}, ${order.to_warehouse_id}, ${r.productId},
                  'transfer_in', ${r.qty}, 'transfer_order', ${orderId}, ${ctx.userId})`
      }
    }

    await tx`
      update public.transfer_orders set status = 'received', received_at = now(), updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('transfers.order.received',
        ${JSON.stringify({ orderId })}::text::jsonb, 'transfers')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa transferencia no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/transferencias/${orderId}`)
  revalidatePath('/transferencias')
  revalidatePath('/inventory')
  return { ok: true }
}

/** Cancela una transferencia -solo posible mientras sigue en borrador-. */
export async function cancelarTransferencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'transfers', 'transfers.create')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  if (!orderId) return { ok: false, error: 'Falta la transferencia.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string }[]>`
      select status from public.transfer_orders where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    if (!order) return 'no-existe'
    if (!transicionValidaTransferencia(order.status as EstadoTransferencia, 'cancelled')) {
      return 'Esa transferencia ya no se puede cancelar -ya salio del almacen-.'
    }

    await tx`
      update public.transfer_orders set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa transferencia no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/transferencias/${orderId}`)
  revalidatePath('/transferencias')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearTransferenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearTransferencia(fd), 'crearTransferencia')
}
export async function agregarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await agregarLinea(fd), 'agregarLinea')
}
export async function quitarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await quitarLinea(fd), 'quitarLinea')
}
export async function despacharTransferenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await despacharTransferencia(fd),
    'despacharTransferencia',
    'Listo, salio del almacen: queda en transito hasta que la reciban.',
  )
}
export async function recibirTransferenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await recibirTransferencia(fd),
    'recibirTransferencia',
    'Listo, la mercancia entro al almacen de destino.',
  )
}
export async function cancelarTransferenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(await cancelarTransferencia(fd), 'cancelarTransferencia')
}
