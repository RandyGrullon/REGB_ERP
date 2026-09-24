'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de activos fijos (modulo 21, F6/S34).
 *
 * Revaluar y dar de baja delegan TODO en revalue_fixed_asset()/
 * dispose_fixed_asset() (0046): la validacion de tenant y de estado vive
 * una sola vez, en SQL, no repetida aqui.
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

/** Da de alta un activo fijo. */
export async function crearActivo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'fixed-assets', 'fixed-assets.asset.create')
  if (!permiso.ok) return permiso

  const code = String(fd.get('code') ?? '').trim()
  const name = String(fd.get('name') ?? '').trim()
  const category = String(fd.get('category') ?? 'other')
  const acquisitionDate = String(fd.get('acquisitionDate') ?? '').trim()
  const acquisitionCost = num(String(fd.get('acquisitionCost') ?? ''))
  const salvageValue = num(String(fd.get('salvageValue') ?? '0')) ?? 0
  const usefulLifeMonths = Number.parseInt(String(fd.get('usefulLifeMonths') ?? ''), 10)
  const depreciationMethod = String(fd.get('depreciationMethod') ?? 'straight_line')

  if (code.length < 1) return { ok: false, error: 'Escribe el codigo del activo.' }
  if (name.length < 2) return { ok: false, error: 'Escribe el nombre del activo.' }
  if (!acquisitionDate) return { ok: false, error: 'Falta la fecha de adquisicion.' }
  if (acquisitionCost === null || acquisitionCost <= 0) {
    return { ok: false, error: 'El costo de adquisicion debe ser mayor que cero.' }
  }
  if (salvageValue < 0) return { ok: false, error: 'El valor de rescate no puede ser negativo.' }
  if (salvageValue > acquisitionCost) {
    return { ok: false, error: 'El valor de rescate no puede ser mayor que el costo.' }
  }
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths <= 0) {
    return { ok: false, error: 'La vida util debe ser un numero de meses mayor que cero.' }
  }
  if (!['straight_line', 'declining_balance'].includes(depreciationMethod)) {
    return { ok: false, error: 'Metodo de depreciacion no valido.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.fixed_assets
          (tenant_id, code, name, category, acquisition_date, acquisition_cost,
           salvage_value, useful_life_months, depreciation_method)
        values (${ctx.tenantId}, ${code}, ${name}, ${category}, ${acquisitionDate},
                ${acquisitionCost}, ${salvageValue}, ${usefulLifeMonths}, ${depreciationMethod})`

      await tx`
        select public.emit_event('fixed-assets.asset.created',
          ${JSON.stringify({ code, name, acquisitionCost })}::text::jsonb, 'fixed-assets')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key')) {
      return { ok: false, error: 'Ya existe un activo con ese codigo.' }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/activos-fijos')
  return { ok: true }
}

/** Corre la depreciacion del periodo para todos los activos activos del tenant. */
export async function correrDepreciacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'fixed-assets', 'fixed-assets.depreciation.run')
  if (!permiso.ok) return permiso

  const periodo = String(fd.get('period') ?? '').trim() || new Date().toISOString().slice(0, 10)

  const [n] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) =>
      tx<
        { n: string }[]
      >`select public.run_fixed_asset_depreciation(${ctx.tenantId}, ${periodo})::text as n`,
  )

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) =>
      tx`select public.emit_event('fixed-assets.depreciation.run',
      ${JSON.stringify({ period: periodo, n: Number(n?.n ?? 0) })}::text::jsonb, 'fixed-assets')`,
  )

  revalidatePath('/activos-fijos')
  return { ok: true }
}

/** Registra un revaluo: nunca sobreescribe el anterior. */
export async function revaluarActivo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'fixed-assets', 'fixed-assets.asset.revalue')
  if (!permiso.ok) return permiso

  const assetId = String(fd.get('assetId') ?? '')
  const newValue = num(String(fd.get('newValue') ?? ''))
  const reason = String(fd.get('reason') ?? '').trim()

  if (!assetId) return { ok: false, error: 'Falta el activo.' }
  if (newValue === null || newValue < 0) return { ok: false, error: 'El nuevo valor no es valido.' }
  if (reason.length < 4) return { ok: false, error: 'Escribe el motivo del revaluo.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`select public.revalue_fixed_asset(${assetId}, ${newValue}, ${reason})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/activos-fijos/${assetId}`)
  return { ok: true }
}

/** Da de baja un activo: registra la ganancia o perdida contra su valor en libros. */
export async function darDeBajaActivo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'fixed-assets', 'fixed-assets.asset.dispose')
  if (!permiso.ok) return permiso

  const assetId = String(fd.get('assetId') ?? '')
  const disposedAt =
    String(fd.get('disposedAt') ?? '').trim() || new Date().toISOString().slice(0, 10)
  const disposedAmount = num(String(fd.get('disposedAmount') ?? '')) ?? 0
  const reason = String(fd.get('reason') ?? '').trim()

  if (!assetId) return { ok: false, error: 'Falta el activo.' }
  if (disposedAmount < 0) return { ok: false, error: 'El monto de la baja no puede ser negativo.' }
  if (reason.length < 4) return { ok: false, error: 'Escribe el motivo de la baja.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`select public.dispose_fixed_asset(${assetId}, ${disposedAt}, ${disposedAmount}, ${reason})`
      await tx`select public.emit_event('fixed-assets.asset.disposed',
        ${JSON.stringify({ assetId, disposedAmount })}::text::jsonb, 'fixed-assets')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/activos-fijos')
  revalidatePath(`/activos-fijos/${assetId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearActivoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearActivo(fd), 'crearActivo')
}
export async function correrDepreciacionForm(fd: FormData): Promise<void> {
  await anotarAviso(await correrDepreciacion(fd), 'correrDepreciacion')
}
export async function revaluarActivoForm(fd: FormData): Promise<void> {
  await anotarAviso(await revaluarActivo(fd), 'revaluarActivo')
}
export async function darDeBajaActivoForm(fd: FormData): Promise<void> {
  await anotarAviso(await darDeBajaActivo(fd), 'darDeBajaActivo')
}
