'use server'

import { revalidatePath } from 'next/cache'
import { splitAmount } from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de centros de costo (modulo 23, F6/S35).
 *
 * El prorrateo se calcula con splitAmount() (@regb/operations) ANTES de
 * insertar: cada centro recibe su monto ya calculado, cuadrado exacto
 * contra el total -la base solo guarda el resultado, no reimplementa el
 * reparto-.
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

/** Da de alta un centro de costo. */
export async function crearCentro(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'cost-centers', 'cost-centers.center.create')
  if (!permiso.ok) return permiso

  const code = String(fd.get('code') ?? '').trim()
  const name = String(fd.get('name') ?? '').trim()

  if (code.length < 1) return { ok: false, error: 'Escribe el codigo del centro.' }
  if (name.length < 2) return { ok: false, error: 'Escribe el nombre del centro.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        insert into public.cost_centers (tenant_id, code, name)
        values (${ctx.tenantId}, ${code}, ${name})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key')) {
      return { ok: false, error: 'Ya existe un centro con ese codigo.' }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/centros-costo')
  return { ok: true }
}

/** Registra una asignacion manual en UN solo centro. */
export async function asignarCosto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'cost-centers', 'cost-centers.allocation.create')
  if (!permiso.ok) return permiso

  const costCenterId = String(fd.get('costCenterId') ?? '')
  const amount = num(String(fd.get('amount') ?? ''))
  const description = String(fd.get('description') ?? '').trim()
  const allocationDate = String(fd.get('allocationDate') ?? '').trim()

  if (!costCenterId) return { ok: false, error: 'Elige el centro de costo.' }
  if (amount === null || amount <= 0) return { ok: false, error: 'El monto debe ser mayor que cero.' }
  if (description.length < 3) return { ok: false, error: 'Describe el gasto.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.cost_center_allocations
          (tenant_id, cost_center_id, amount, description, allocation_date, created_by)
        values (${ctx.tenantId}, ${costCenterId}, ${amount}, ${description},
                coalesce(${allocationDate || null}::date, current_date), ${ctx.userId})`

      await tx`
        select public.emit_event('cost-centers.allocation.created',
          ${JSON.stringify({ costCenterId, amount })}::text::jsonb, 'cost-centers')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/centros-costo')
  revalidatePath(`/centros-costo/${costCenterId}`)
  return { ok: true }
}

/**
 * Prorratea un monto entre varios centros por peso. Recibe pares
 * `costCenterId:peso` -uno por renglon-, calcula el reparto con
 * splitAmount() y registra una asignacion por centro, todas con la misma
 * descripcion y fecha para que se lean como un solo gasto repartido.
 */
export async function prorratearCosto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'cost-centers', 'cost-centers.allocation.create')
  if (!permiso.ok) return permiso

  const total = num(String(fd.get('total') ?? ''))
  const description = String(fd.get('description') ?? '').trim()
  const allocationDate = String(fd.get('allocationDate') ?? '').trim()
  const pesos = fd.getAll('weight').map((v) => num(String(v)) ?? 0)
  const centros = fd.getAll('weightCenterId').map((v) => String(v))

  if (total === null || total <= 0) return { ok: false, error: 'El monto total debe ser mayor que cero.' }
  if (description.length < 3) return { ok: false, error: 'Describe el gasto.' }

  const pesosValidos = centros
    .map((costCenterId, i) => ({ costCenterId, weight: pesos[i] ?? 0 }))
    .filter((p) => p.costCenterId && p.weight > 0)

  if (pesosValidos.length < 2) {
    return { ok: false, error: 'Pon un peso mayor que cero en al menos dos centros para prorratear.' }
  }

  const reparto = splitAmount(total, pesosValidos)

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      for (const r of reparto) {
        await tx`
          insert into public.cost_center_allocations
            (tenant_id, cost_center_id, amount, description, allocation_date, created_by)
          values (${ctx.tenantId}, ${r.costCenterId}, ${r.amount}, ${description},
                  coalesce(${allocationDate || null}::date, current_date), ${ctx.userId})`
      }
      await tx`
        select public.emit_event('cost-centers.allocation.created',
          ${JSON.stringify({ total, centros: reparto.length })}::text::jsonb, 'cost-centers')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/centros-costo')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearCentroForm(fd: FormData): Promise<void> {
  await crearCentro(fd)
}
export async function asignarCostoForm(fd: FormData): Promise<void> {
  await asignarCosto(fd)
}
export async function prorratearCostoForm(fd: FormData): Promise<void> {
  await prorratearCosto(fd)
}
