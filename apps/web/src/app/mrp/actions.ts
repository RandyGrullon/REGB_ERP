'use server'

import { revalidatePath } from 'next/cache'
import { explotarNecesidadesMrp, necesidadNeta, type NodoExplosionMrp } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'
import type postgres from 'postgres'

/**
 * Acciones de planificacion MRP (modulo 57, F8.5/S52).
 *
 * `correrMrp()` arma el arbol de necesidades resolviendo, para cada
 * componente, si tiene su propio BOM activo (se expande, igual que el
 * costeo multinivel de `bom`) o no (es una hoja comprada), y
 * `explotarNecesidadesMrp()` (@regb/operations) acumula la necesidad
 * bruta real -sumando la misma materia prima entre ramas repetidas-.
 * `necesidadNeta()` resta el stock disponible de cada una.
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

async function resolverNodoMrp(
  tx: postgres.TransactionSql,
  tenantId: string,
  productId: string,
  cantidadNecesaria: number,
  profundidad: number,
): Promise<NodoExplosionMrp> {
  if (profundidad >= 10) return { productId, cantidadNecesaria, esComprado: true }

  const [bom] = await tx<{ id: string; output_qty: string }[]>`
    select id, output_qty::text from public.bill_of_materials
    where tenant_id = ${tenantId} and product_id = ${productId} and status = 'active'`
  if (!bom) return { productId, cantidadNecesaria, esComprado: true }

  const lineas = await tx<{ component_product_id: string; quantity_per_unit: string }[]>`
    select component_product_id, quantity_per_unit::text from public.bom_lines
    where bom_id = ${bom.id} and tenant_id = ${tenantId} and is_substitute_for is null`
  if (lineas.length === 0) return { productId, cantidadNecesaria, esComprado: true }

  const subComponentes = await Promise.all(
    lineas.map((l) =>
      resolverNodoMrp(
        tx,
        tenantId,
        l.component_product_id,
        (Number(l.quantity_per_unit) / Number(bom.output_qty)) * cantidadNecesaria,
        profundidad + 1,
      ),
    ),
  )
  return { productId, cantidadNecesaria, esComprado: false, subComponentes }
}

/** Corre MRP para producir `targetQty` de un producto terminado con BOM activo. */
export async function correrMrp(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'mrp', 'mrp.run')
  if (!permiso.ok) return permiso

  const productId = String(fd.get('productId') ?? '')
  const targetQty = num(String(fd.get('targetQty') ?? ''))
  const notes = String(fd.get('notes') ?? '').trim() || null

  if (!productId) return { ok: false, error: 'Elige el producto.' }
  if (targetQty === null || targetQty <= 0)
    return { ok: false, error: 'La cantidad debe ser mayor que cero.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const nodo = await resolverNodoMrp(tx, ctx.tenantId, productId, targetQty, 0)
    if (nodo.esComprado || !nodo.subComponentes) {
      return 'Ese producto no tiene un BOM activo -no hay nada que explotar-.'
    }

    const necesidades = explotarNecesidadesMrp(nodo.subComponentes)
    if (necesidades.length === 0) return 'Ese BOM no tiene componentes.'

    const [run] = await tx<{ id: string }[]>`
      insert into public.mrp_runs (tenant_id, target_product_id, target_qty, created_by, notes)
      values (${ctx.tenantId}, ${productId}, ${targetQty}, ${ctx.userId}, ${notes}) returning id`
    const runId = run!.id

    for (const n of necesidades) {
      const [stock] = await tx<{ total: string }[]>`
        select coalesce(sum(qty_on_hand), 0)::text as total from public.stock_levels
        where tenant_id = ${ctx.tenantId} and product_id = ${n.productId}`
      const neta = necesidadNeta(n.cantidadBruta, Number(stock!.total))
      if (neta > 0) {
        await tx`
          insert into public.mrp_suggestions (run_id, tenant_id, product_id, action, qty_suggested)
          values (${runId}, ${ctx.tenantId}, ${n.productId}, ${n.accion}, ${neta})`
      }
    }

    await tx`
      select public.emit_event('mrp.run.completed',
        ${JSON.stringify({ runId, productId, targetQty })}::text::jsonb, 'mrp')`

    return runId
  })

  if (
    resultado === 'Ese producto no tiene un BOM activo -no hay nada que explotar-.' ||
    resultado === 'Ese BOM no tiene componentes.'
  ) {
    return { ok: false, error: resultado }
  }

  revalidatePath('/mrp')
  return { ok: true }
}

/** Acepta una sugerencia: si es "producir", crea la orden en borrador; si es "comprar", solo queda registrada. */
export async function aceptarSugerencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'mrp', 'mrp.resolve')
  if (!permiso.ok) return permiso

  const suggestionId = String(fd.get('suggestionId') ?? '')
  const warehouseId = String(fd.get('warehouseId') ?? '') || null
  if (!suggestionId) return { ok: false, error: 'Falta la sugerencia.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [sug] = await tx<
      { status: string; action: string; product_id: string; qty_suggested: string }[]
    >`
      select status, action, product_id, qty_suggested::text from public.mrp_suggestions
      where id = ${suggestionId} and tenant_id = ${ctx.tenantId} for update`
    if (!sug) return 'no-existe'
    if (sug.status !== 'pending') return 'Esa sugerencia ya fue resuelta.'

    let productionOrderId: string | null = null
    if (sug.action === 'produce') {
      if (!warehouseId) return 'Elige el almacen para crear la orden de produccion.'
      const [bom] = await tx<{ id: string }[]>`
        select id from public.bill_of_materials
        where tenant_id = ${ctx.tenantId} and product_id = ${sug.product_id} and status = 'active'`
      if (!bom) return 'Ese producto ya no tiene un BOM activo.'

      const [orden] = await tx<{ id: string }[]>`
        insert into public.production_orders (tenant_id, bom_id, warehouse_id, qty_planned, created_by)
        values (${ctx.tenantId}, ${bom.id}, ${warehouseId}, ${sug.qty_suggested}, ${ctx.userId})
        returning id`
      productionOrderId = orden!.id
    }

    await tx`
      update public.mrp_suggestions
      set status = 'accepted', production_order_id = ${productionOrderId}, updated_at = now()
      where id = ${suggestionId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('mrp.suggestion.accepted',
        ${JSON.stringify({ suggestionId })}::text::jsonb, 'mrp')`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa sugerencia no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/mrp')
  return { ok: true }
}

/** Descarta una sugerencia -no crea nada-. */
export async function descartarSugerencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'mrp', 'mrp.resolve')
  if (!permiso.ok) return permiso

  const suggestionId = String(fd.get('suggestionId') ?? '')
  if (!suggestionId) return { ok: false, error: 'Falta la sugerencia.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [sug] = await tx<{ status: string }[]>`
      select status from public.mrp_suggestions where id = ${suggestionId} and tenant_id = ${ctx.tenantId}`
    if (!sug) return 'no-existe'
    if (sug.status !== 'pending') return 'Esa sugerencia ya fue resuelta.'

    await tx`
      update public.mrp_suggestions set status = 'dismissed', updated_at = now()
      where id = ${suggestionId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa sugerencia no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/mrp')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function correrMrpForm(fd: FormData): Promise<void> {
  await anotarAviso(await correrMrp(fd), 'correrMrp')
}
export async function aceptarSugerenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(await aceptarSugerencia(fd), 'aceptarSugerencia')
}
export async function descartarSugerenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(await descartarSugerencia(fd), 'descartarSugerencia')
}
