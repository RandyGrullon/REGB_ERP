'use server'

import { revalidatePath } from 'next/cache'
import { alcanzaFefo, seleccionFefo, type LoteDisponible } from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de lotes, series y vencimientos (modulo 49, F8/S46).
 *
 * `consumirFefo()` es la unica accion que corre `seleccionFefo()`
 * (@regb/operations) de verdad: reparte la cantidad pedida entre los
 * lotes disponibles, el que vence mas pronto primero, y postea UN
 * movimiento de inventario por cada lote que toca -no uno solo con el
 * total-. `stock_levels` (por producto) lo actualiza el MISMO trigger
 * de 0019 que ya existe con cada `inventory_movements` insertado;
 * `lot_stock` (por lote) lo actualiza esta accion a mano, porque el
 * trigger viejo no sabe que existe esta tabla nueva.
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

/** Registra un lote nuevo -o le suma cantidad a uno que ya existe- con su existencia inicial. */
export async function registrarLote(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'lots-serials', 'lots-serials.manage')
  if (!permiso.ok) return permiso

  const productId = String(fd.get('productId') ?? '')
  const warehouseId = String(fd.get('warehouseId') ?? '')
  const lotNumber = String(fd.get('lotNumber') ?? '').trim()
  const expiryDate = String(fd.get('expiryDate') ?? '') || null
  const qty = num(String(fd.get('qty') ?? ''))
  const unitCost = num(String(fd.get('unitCost') ?? ''))

  if (!productId) return { ok: false, error: 'Elige el producto.' }
  if (!warehouseId) return { ok: false, error: 'Elige el almacen.' }
  if (!lotNumber) return { ok: false, error: 'Escribe el numero de lote o de serie.' }
  if (qty === null || qty <= 0) return { ok: false, error: 'La cantidad debe ser mayor que cero.' }
  if (unitCost === null || unitCost < 0) return { ok: false, error: 'El costo no es valido.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [lote] = await tx<{ id: string }[]>`
        insert into public.product_lots (tenant_id, product_id, lot_number, expiry_date)
        values (${ctx.tenantId}, ${productId}, ${lotNumber}, ${expiryDate})
        on conflict (tenant_id, product_id, lot_number) do update set updated_at = now()
        returning id`
      const lotId = lote!.id

      await tx`
        insert into public.lot_stock (tenant_id, warehouse_id, lot_id, qty_on_hand)
        values (${ctx.tenantId}, ${warehouseId}, ${lotId}, ${qty})
        on conflict (tenant_id, warehouse_id, lot_id)
        do update set qty_on_hand = lot_stock.qty_on_hand + ${qty}, updated_at = now()`

      await tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, lot_id,
           reference_type, notes, created_by)
        values (${ctx.tenantId}, ${warehouseId}, ${productId}, 'adjustment_in', ${qty}, ${unitCost},
                ${lotId}, 'product_lot', 'Registro de lote', ${ctx.userId})`

      await tx`
        select public.emit_event('lots-serials.lot.registered',
          ${JSON.stringify({ productId, lotId, qty })}::text::jsonb, 'lots-serials')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/lotes')
  revalidatePath('/inventory')
  return { ok: true }
}

/** Consume cantidad de un producto en un almacen, eligiendo los lotes por FEFO. */
export async function consumirFefo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'lots-serials', 'lots-serials.manage')
  if (!permiso.ok) return permiso

  const productId = String(fd.get('productId') ?? '')
  const warehouseId = String(fd.get('warehouseId') ?? '')
  const qty = num(String(fd.get('qty') ?? ''))
  const notes = String(fd.get('notes') ?? '').trim() || null

  if (!productId) return { ok: false, error: 'Elige el producto.' }
  if (!warehouseId) return { ok: false, error: 'Elige el almacen.' }
  if (qty === null || qty <= 0) return { ok: false, error: 'La cantidad debe ser mayor que cero.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const filas = await tx<{ id: string; expiry_date: string | null; qty_on_hand: string }[]>`
      select pl.id, pl.expiry_date::text, ls.qty_on_hand::text
      from public.lot_stock ls
      join public.product_lots pl on pl.id = ls.lot_id
      where ls.tenant_id = ${ctx.tenantId} and ls.warehouse_id = ${warehouseId}
        and pl.product_id = ${productId} and ls.qty_on_hand > 0
      order by pl.expiry_date nulls last
      for update of ls`

    const lotes: LoteDisponible[] = filas.map((f) => ({
      lotId: f.id,
      expiryDate: f.expiry_date ? new Date(f.expiry_date) : null,
      qtyAvailable: Number(f.qty_on_hand),
    }))

    if (!alcanzaFefo(lotes, qty)) {
      return 'No hay suficiente cantidad disponible en lotes para cubrir esa cantidad.'
    }

    const asignaciones = seleccionFefo(lotes, qty)

    for (const a of asignaciones) {
      await tx`
        update public.lot_stock set qty_on_hand = qty_on_hand - ${a.qty}, updated_at = now()
        where tenant_id = ${ctx.tenantId} and warehouse_id = ${warehouseId} and lot_id = ${a.lotId}`

      await tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, lot_id, reference_type, notes, created_by)
        values (${ctx.tenantId}, ${warehouseId}, ${productId}, 'adjustment_out', ${-a.qty}, ${a.lotId},
                'product_lot', ${notes}, ${ctx.userId})`
    }

    return 'ok'
  })

  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/lotes')
  revalidatePath('/inventory')
  return { ok: true }
}

/** Abre un recall sobre un producto entero o un lote especifico. */
export async function abrirRecall(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'lots-serials', 'lots-serials.recall')
  if (!permiso.ok) return permiso

  const productId = String(fd.get('productId') ?? '')
  const lotId = String(fd.get('lotId') ?? '') || null
  const reason = String(fd.get('reason') ?? '').trim()
  if (!productId) return { ok: false, error: 'Elige el producto.' }
  if (!reason) return { ok: false, error: 'Escribe la razon del recall.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [r] = await tx<{ id: string }[]>`
        insert into public.product_recalls (tenant_id, product_id, lot_id, reason)
        values (${ctx.tenantId}, ${productId}, ${lotId}, ${reason})
        returning id`

      await tx`
        select public.emit_event('lots-serials.recall.opened',
          ${JSON.stringify({ productId, lotId, recallId: r!.id })}::text::jsonb, 'lots-serials')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/lotes')
  return { ok: true }
}

/** Cierra un recall abierto. */
export async function cerrarRecall(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'lots-serials', 'lots-serials.recall')
  if (!permiso.ok) return permiso

  const recallId = String(fd.get('recallId') ?? '')
  if (!recallId) return { ok: false, error: 'Falta el recall.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      update public.product_recalls set status = 'closed', closed_at = now()
      where id = ${recallId} and tenant_id = ${ctx.tenantId}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/lotes')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function registrarLoteForm(fd: FormData): Promise<void> {
  await registrarLote(fd)
}
export async function consumirFefoForm(fd: FormData): Promise<void> {
  await consumirFefo(fd)
}
export async function abrirRecallForm(fd: FormData): Promise<void> {
  await abrirRecall(fd)
}
export async function cerrarRecallForm(fd: FormData): Promise<void> {
  await cerrarRecall(fd)
}
