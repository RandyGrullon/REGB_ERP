'use server'

import { revalidatePath } from 'next/cache'
import {
  clasificarAbc,
  frecuenciaConteoDias,
  transicionValidaConteo,
  type EstadoConteoCiclico,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de conteos ciclicos (modulo 51, F8/S47).
 *
 * `recalcularAbc()` corre clasificarAbc() (Pareto 80/15/5) sobre el
 * valor actual en inventario de cada producto -avg_cost * qty_on_hand,
 * sumado entre almacenes-. No es "ventas anuales reales" -esa
 * integracion con el historial de sales-orders es un paso futuro-,
 * pero clasifica sobre datos reales del tenant, no una etiqueta fija.
 *
 * `aprobarConteo()` es el unico lugar que toca inventory_movements: el
 * ajuste no se postea hasta que alguien con `stock-counts.approve` lo
 * aprueba.
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

/** Recalcula la clase ABC de cada producto a partir de su valor actual en inventario. */
export async function recalcularAbc(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'stock-counts', 'stock-counts.manage')
  if (!permiso.ok) return permiso

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const productos = await tx<{ product_id: string; valor: string }[]>`
        select p.id as product_id, coalesce(sum(s.qty_on_hand * s.avg_cost), 0)::text as valor
        from public.products p
        left join public.stock_levels s on s.product_id = p.id and s.tenant_id = p.tenant_id
        where p.tenant_id = ${ctx.tenantId} and p.active
        group by p.id`

      const clasificacion = clasificarAbc(
        productos.map((p) => ({ productId: p.product_id, valorAnual: Number(p.valor) })),
      )

      for (const c of clasificacion) {
        const frecuencia = frecuenciaConteoDias(c.clase)
        await tx`
          insert into public.count_schedules (tenant_id, product_id, abc_class, frequency_days)
          values (${ctx.tenantId}, ${c.productId}, ${c.clase}, ${frecuencia})
          on conflict (tenant_id, product_id)
          do update set abc_class = ${c.clase}, frequency_days = ${frecuencia}, updated_at = now()`
      }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/conteos-ciclicos')
  return { ok: true }
}

/** Inicia un conteo nuevo en un almacen, con una fila por cada producto que tiene existencia ahi. */
export async function iniciarConteo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'stock-counts', 'stock-counts.manage')
  if (!permiso.ok) return permiso

  const warehouseId = String(fd.get('warehouseId') ?? '')
  if (!warehouseId) return { ok: false, error: 'Elige el almacen.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [conteo] = await tx<{ id: string }[]>`
      insert into public.cycle_counts (tenant_id, warehouse_id, started_by)
      values (${ctx.tenantId}, ${warehouseId}, ${ctx.userId})
      returning id`
    const countId = conteo!.id

    // `public.existencias` y no `stock_levels`: desde 0109 la columna
    // `avg_cost` no es legible por `authenticated` -asi no se filtra por
    // PostgREST- y la vista la destapa solo a quien tiene
    // `inventory.cost.view`. Quien programa un conteo ciclico lo tiene.
    const existencias = await tx<{ product_id: string; qty_on_hand: string; avg_cost: string }[]>`
      select product_id, qty_on_hand::text, avg_cost::text from public.existencias()
      where tenant_id = ${ctx.tenantId} and warehouse_id = ${warehouseId} and qty_on_hand > 0`

    if (existencias.length === 0) return 'sin-existencias'

    for (const e of existencias) {
      await tx`
        insert into public.cycle_count_lines (count_id, tenant_id, product_id, system_qty, unit_cost)
        values (${countId}, ${ctx.tenantId}, ${e.product_id}, ${e.qty_on_hand}, ${e.avg_cost})`
    }

    return countId
  })

  if (resultado === 'sin-existencias') {
    return { ok: false, error: 'Ese almacen no tiene existencias para contar.' }
  }

  revalidatePath('/conteos-ciclicos')
  return { ok: true }
}

/** Registra lo contado en una linea -conteo ciego: el formulario nunca le muestra el numero del sistema-. */
export async function registrarLineaConteo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'stock-counts', 'stock-counts.count')
  if (!permiso.ok) return permiso

  const lineId = String(fd.get('lineId') ?? '')
  const countId = String(fd.get('countId') ?? '')
  const counted = num(String(fd.get('counted') ?? ''))
  if (!lineId) return { ok: false, error: 'Falta la linea.' }
  if (counted === null || counted < 0) return { ok: false, error: 'La cantidad contada no es valida.' }

  try {
    // Unica puerta desde 0115: comprueba que el conteo siga en
    // `counting`. Un UPDATE directo dejaba cambiar el numero cuando ya
    // estaba delante del supervisor o ya habia movido inventario.
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      select public.contar_ciclico(${lineId}, ${counted})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/conteos-ciclicos/${countId}`)
  return { ok: true }
}

/** Envia el conteo a aprobacion -solo si TODAS las lineas ya tienen algo contado-. */
export async function enviarConteo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'stock-counts', 'stock-counts.count')
  if (!permiso.ok) return permiso

  const countId = String(fd.get('countId') ?? '')
  if (!countId) return { ok: false, error: 'Falta el conteo.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [conteo] = await tx<{ status: string }[]>`
      select status from public.cycle_counts where id = ${countId} and tenant_id = ${ctx.tenantId}`
    if (!conteo) return 'no-existe'
    if (!transicionValidaConteo(conteo.status as EstadoConteoCiclico, 'pending_approval')) {
      return 'Ese conteo ya no se puede enviar a aprobacion.'
    }

    const [pendientes] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.cycle_count_lines
      where count_id = ${countId} and tenant_id = ${ctx.tenantId} and counted_qty is null`
    if (Number(pendientes!.n) > 0) {
      return 'Todavia hay productos sin contar en esta lista.'
    }

    await tx`
      update public.cycle_counts set status = 'pending_approval', submitted_at = now(), updated_at = now()
      where id = ${countId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('stock-counts.count.submitted',
        ${JSON.stringify({ countId })}::text::jsonb, 'stock-counts')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese conteo no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/conteos-ciclicos/${countId}`)
  revalidatePath('/conteos-ciclicos')
  return { ok: true }
}

/** Aprueba el conteo: postea el ajuste de cada linea con diferencia, y marca contados los productos. */
export async function aprobarConteo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'stock-counts', 'stock-counts.approve')
  if (!permiso.ok) return permiso

  const countId = String(fd.get('countId') ?? '')
  if (!countId) return { ok: false, error: 'Falta el conteo.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [conteo] = await tx<{ status: string; warehouse_id: string }[]>`
      select status, warehouse_id from public.cycle_counts
      where id = ${countId} and tenant_id = ${ctx.tenantId} for update`
    if (!conteo) return 'no-existe'
    if (!transicionValidaConteo(conteo.status as EstadoConteoCiclico, 'approved')) {
      return 'Ese conteo ya fue resuelto.'
    }

    const lineas = await tx<
      { id: string; product_id: string; system_qty: string; counted_qty: string; unit_cost: string }[]
    >`
      select id, product_id, system_qty::text, counted_qty::text, unit_cost::text
      from public.cycle_count_lines where count_id = ${countId} and tenant_id = ${ctx.tenantId}`

    for (const l of lineas) {
      const variance = Number(l.counted_qty) - Number(l.system_qty)
      if (variance !== 0) {
        await tx`
          insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by)
          values (${ctx.tenantId}, ${conteo.warehouse_id}, ${l.product_id},
                  'count_adjustment', ${variance}, ${l.unit_cost}, 'cycle_count', ${countId}, ${ctx.userId})`
      }

      await tx`
        insert into public.count_schedules (tenant_id, product_id, abc_class, frequency_days, last_counted_at)
        values (${ctx.tenantId}, ${l.product_id}, 'C', 180, now())
        on conflict (tenant_id, product_id) do update set last_counted_at = now(), updated_at = now()`
    }

    await tx`
      update public.cycle_counts set status = 'approved', approved_by = ${ctx.userId}, approved_at = now(), updated_at = now()
      where id = ${countId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('stock-counts.count.approved',
        ${JSON.stringify({ countId })}::text::jsonb, 'stock-counts')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese conteo no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/conteos-ciclicos/${countId}`)
  revalidatePath('/conteos-ciclicos')
  revalidatePath('/inventory')
  return { ok: true }
}

/** Rechaza el conteo -no ajusta nada-. */
export async function rechazarConteo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'stock-counts', 'stock-counts.approve')
  if (!permiso.ok) return permiso

  const countId = String(fd.get('countId') ?? '')
  if (!countId) return { ok: false, error: 'Falta el conteo.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [conteo] = await tx<{ status: string }[]>`
      select status from public.cycle_counts where id = ${countId} and tenant_id = ${ctx.tenantId}`
    if (!conteo) return 'no-existe'
    if (!transicionValidaConteo(conteo.status as EstadoConteoCiclico, 'rejected')) {
      return 'Ese conteo ya fue resuelto.'
    }

    await tx`
      update public.cycle_counts set status = 'rejected', updated_at = now()
      where id = ${countId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese conteo no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/conteos-ciclicos/${countId}`)
  revalidatePath('/conteos-ciclicos')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function recalcularAbcForm(fd: FormData): Promise<void> {
  await anotarAviso(await recalcularAbc(fd), 'recalcularAbc')
}
export async function iniciarConteoForm(fd: FormData): Promise<void> {
  await anotarAviso(await iniciarConteo(fd), 'iniciarConteo')
}
export async function registrarLineaConteoForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarLineaConteo(fd), 'registrarLineaConteo')
}
export async function enviarConteoForm(fd: FormData): Promise<void> {
  await anotarAviso(await enviarConteo(fd), 'enviarConteo')
}
export async function aprobarConteoForm(fd: FormData): Promise<void> {
  await anotarAviso(await aprobarConteo(fd), 'aprobarConteo')
}
export async function rechazarConteoForm(fd: FormData): Promise<void> {
  await anotarAviso(await rechazarConteo(fd), 'rechazarConteo')
}
