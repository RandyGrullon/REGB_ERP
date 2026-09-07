'use server'

import { revalidatePath } from 'next/cache'
import {
  explotarCantidad,
  ordenCompleta,
  transicionValidaOrdenProduccion,
  type EstadoOrdenProduccion,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de ordenes de produccion (modulo 56, F8.5/S50-51).
 *
 * `liberarOrden()` es el unico momento que consume inventario:
 * explota la receta del BOM ACTIVO con `explotarCantidad()`
 * (@regb/operations, reutilizada de bom.ts) y postea un ajuste de
 * salida por cada componente -de una sola vez, no proporcional al
 * avance-. `reportarAvance()` postea la entrada del producto
 * terminado por lo completado, y completa la orden sola cuando
 * `ordenCompleta()` lo confirma.
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

/** Crea una orden en borrador sobre el BOM activo elegido. */
export async function crearOrden(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'manufacturing', 'manufacturing.manage')
  if (!permiso.ok) return permiso

  const bomId = String(fd.get('bomId') ?? '')
  const warehouseId = String(fd.get('warehouseId') ?? '')
  const qtyPlanned = num(String(fd.get('qtyPlanned') ?? ''))

  if (!bomId) return { ok: false, error: 'Elige el BOM.' }
  if (!warehouseId) return { ok: false, error: 'Elige el almacen.' }
  if (qtyPlanned === null || qtyPlanned <= 0) {
    return { ok: false, error: 'La cantidad planificada debe ser mayor que cero.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.production_orders (tenant_id, bom_id, warehouse_id, qty_planned, created_by)
      values (${ctx.tenantId}, ${bomId}, ${warehouseId}, ${qtyPlanned}, ${ctx.userId})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/produccion')
  return { ok: true }
}

/** Libera la orden: explota la receta y consume los componentes de una sola vez. */
export async function liberarOrden(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'manufacturing', 'manufacturing.manage')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  if (!orderId) return { ok: false, error: 'Falta la orden.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [orden] = await tx<{ status: string; bom_id: string; warehouse_id: string; qty_planned: string }[]>`
      select status, bom_id, warehouse_id, qty_planned::text from public.production_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
    if (!orden) return 'no-existe'
    if (!transicionValidaOrdenProduccion(orden.status as EstadoOrdenProduccion, 'released')) {
      return 'Esa orden ya no se puede liberar.'
    }

    const [bom] = await tx<{ output_qty: string; status: string }[]>`
      select output_qty::text, status from public.bill_of_materials
      where id = ${orden.bom_id} and tenant_id = ${ctx.tenantId}`
    if (!bom || bom.status !== 'active') return 'El BOM de esta orden ya no esta activo.'

    const lineasBom = await tx<{ component_product_id: string; quantity_per_unit: string }[]>`
      select component_product_id, quantity_per_unit::text from public.bom_lines
      where bom_id = ${orden.bom_id} and tenant_id = ${ctx.tenantId} and is_substitute_for is null`
    if (lineasBom.length === 0) return 'Ese BOM no tiene componentes.'

    for (const l of lineasBom) {
      const cantidadPorUnidad = Number(l.quantity_per_unit) / Number(bom.output_qty)
      const qtyRequerida = explotarCantidad(cantidadPorUnidad, Number(orden.qty_planned))

      await tx`
        insert into public.production_order_lines
          (order_id, tenant_id, component_product_id, qty_required, qty_consumed)
        values (${orderId}, ${ctx.tenantId}, ${l.component_product_id}, ${qtyRequerida}, ${qtyRequerida})`

      await tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, created_by)
        values (${ctx.tenantId}, ${orden.warehouse_id}, ${l.component_product_id},
                'adjustment_out', ${-qtyRequerida}, 'production_order', ${orderId}, ${ctx.userId})`
    }

    await tx`
      update public.production_orders set status = 'released', released_at = now(), updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('manufacturing.order.released',
        ${JSON.stringify({ orderId })}::text::jsonb, 'manufacturing')`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa orden no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/produccion/${orderId}`)
  revalidatePath('/produccion')
  revalidatePath('/inventory')
  return { ok: true }
}

/** Registra avance -completado y/o merma-, entra el producto terminado, y completa la orden sola si ya cubre lo planificado. */
export async function reportarAvance(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'manufacturing', 'manufacturing.report')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const qtyCompletedDelta = num(String(fd.get('qtyCompletedDelta') ?? '')) ?? 0
  const qtyScrappedDelta = num(String(fd.get('qtyScrappedDelta') ?? '')) ?? 0
  const notes = String(fd.get('notes') ?? '').trim() || null

  if (!orderId) return { ok: false, error: 'Falta la orden.' }
  if (qtyCompletedDelta < 0 || qtyScrappedDelta < 0) return { ok: false, error: 'Las cantidades no pueden ser negativas.' }
  if (qtyCompletedDelta === 0 && qtyScrappedDelta === 0) {
    return { ok: false, error: 'Reporta al menos algo completado o mermado.' }
  }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [orden] = await tx<
      { status: string; warehouse_id: string; qty_planned: string; qty_completed: string; qty_scrapped: string; product_id: string }[]
    >`
      select po.status, po.warehouse_id, po.qty_planned::text, po.qty_completed::text, po.qty_scrapped::text,
             bm.product_id
      from public.production_orders po
      join public.bill_of_materials bm on bm.id = po.bom_id
      where po.id = ${orderId} and po.tenant_id = ${ctx.tenantId} for update`
    if (!orden) return 'no-existe'
    if (orden.status !== 'released' && orden.status !== 'in_progress') {
      return 'Solo se puede reportar avance en una orden liberada o en progreso.'
    }

    await tx`
      insert into public.production_reports (order_id, tenant_id, qty_completed_delta, qty_scrapped_delta, reported_by, notes)
      values (${orderId}, ${ctx.tenantId}, ${qtyCompletedDelta}, ${qtyScrappedDelta}, ${ctx.userId}, ${notes})`

    if (qtyCompletedDelta > 0) {
      await tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, created_by)
        values (${ctx.tenantId}, ${orden.warehouse_id}, ${orden.product_id},
                'adjustment_in', ${qtyCompletedDelta}, 'production_order', ${orderId}, ${ctx.userId})`
    }

    const nuevoCompletado = Number(orden.qty_completed) + qtyCompletedDelta
    const nuevoMermado = Number(orden.qty_scrapped) + qtyScrappedDelta
    const completa = ordenCompleta(nuevoCompletado, nuevoMermado, Number(orden.qty_planned))
    const nuevoEstado = completa ? 'completed' : 'in_progress'

    await tx`
      update public.production_orders
      set qty_completed = ${nuevoCompletado}, qty_scrapped = ${nuevoMermado}, status = ${nuevoEstado},
          completed_at = ${completa ? new Date() : null}, updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    if (completa) {
      await tx`
        select public.emit_event('manufacturing.order.completed',
          ${JSON.stringify({ orderId })}::text::jsonb, 'manufacturing')`
    }
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa orden no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/produccion/${orderId}`)
  revalidatePath('/produccion')
  revalidatePath('/inventory')
  return { ok: true }
}

/** Cancela una orden -solo mientras sigue en borrador, antes de consumir nada-. */
export async function cancelarOrden(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'manufacturing', 'manufacturing.manage')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  if (!orderId) return { ok: false, error: 'Falta la orden.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [orden] = await tx<{ status: string }[]>`
      select status from public.production_orders where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    if (!orden) return 'no-existe'
    if (!transicionValidaOrdenProduccion(orden.status as EstadoOrdenProduccion, 'cancelled')) {
      return 'Esa orden ya no se puede cancelar -ya consumio inventario-.'
    }

    await tx`
      update public.production_orders set status = 'cancelled', updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa orden no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/produccion/${orderId}`)
  revalidatePath('/produccion')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearOrdenForm(fd: FormData): Promise<void> {
  await crearOrden(fd)
}
export async function liberarOrdenForm(fd: FormData): Promise<void> {
  await liberarOrden(fd)
}
export async function reportarAvanceForm(fd: FormData): Promise<void> {
  await reportarAvance(fd)
}
export async function cancelarOrdenForm(fd: FormData): Promise<void> {
  await cancelarOrden(fd)
}
