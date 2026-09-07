'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de lista de materiales / BOM (modulo 55, F8.5/S50-51).
 *
 * `activarBom()` es la unica accion que toca dos filas del encabezado:
 * primero retira la version activa anterior del mismo producto (si
 * existe), despues activa la nueva -en ese orden, porque el indice
 * unico parcial solo permite una `active` a la vez y el trigger de
 * inmutabilidad permite la transicion `active -> obsolete` como caso
 * especial, no como edicion-.
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

/** Crea un BOM nuevo en borrador -la version siguiente disponible para ese producto-. */
export async function crearBom(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bom', 'bom.manage')
  if (!permiso.ok) return permiso

  const productId = String(fd.get('productId') ?? '')
  const outputQty = num(String(fd.get('outputQty') ?? '')) ?? 1
  if (!productId) return { ok: false, error: 'Elige el producto.' }
  if (outputQty <= 0) return { ok: false, error: 'La cantidad producida debe ser mayor que cero.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [v] = await tx<{ n: string }[]>`
        select coalesce(max(version), 0)::text as n from public.bill_of_materials
        where tenant_id = ${ctx.tenantId} and product_id = ${productId}`
      await tx`
        insert into public.bill_of_materials (tenant_id, product_id, version, output_qty)
        values (${ctx.tenantId}, ${productId}, ${Number(v!.n) + 1}, ${outputQty})`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/bom')
  return { ok: true }
}

/** Agrega una linea -principal o sustituto de otra- mientras el BOM sigue en borrador. */
export async function agregarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bom', 'bom.manage')
  if (!permiso.ok) return permiso

  const bomId = String(fd.get('bomId') ?? '')
  const componentProductId = String(fd.get('componentProductId') ?? '')
  const quantityPerUnit = num(String(fd.get('quantityPerUnit') ?? ''))
  const isSubstituteFor = String(fd.get('isSubstituteFor') ?? '') || null

  if (!bomId) return { ok: false, error: 'Falta el BOM.' }
  if (!componentProductId) return { ok: false, error: 'Elige el componente.' }
  if (quantityPerUnit === null || quantityPerUnit <= 0) {
    return { ok: false, error: 'La cantidad por unidad debe ser mayor que cero.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.bom_lines (bom_id, tenant_id, component_product_id, quantity_per_unit, is_substitute_for)
      values (${bomId}, ${ctx.tenantId}, ${componentProductId}, ${quantityPerUnit}, ${isSubstituteFor})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/bom/${bomId}`)
  return { ok: true }
}

/** Quita una linea -solo posible mientras el BOM sigue en borrador-. */
export async function quitarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bom', 'bom.manage')
  if (!permiso.ok) return permiso

  const lineId = String(fd.get('lineId') ?? '')
  const bomId = String(fd.get('bomId') ?? '')
  if (!lineId) return { ok: false, error: 'Falta la linea.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      delete from public.bom_lines where id = ${lineId} and tenant_id = ${ctx.tenantId}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/bom/${bomId}`)
  return { ok: true }
}

/** Activa un BOM en borrador -retira la version activa anterior del mismo producto, si existe-. */
export async function activarBom(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bom', 'bom.manage')
  if (!permiso.ok) return permiso

  const bomId = String(fd.get('bomId') ?? '')
  if (!bomId) return { ok: false, error: 'Falta el BOM.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [bom] = await tx<{ status: string; product_id: string }[]>`
      select status, product_id from public.bill_of_materials where id = ${bomId} and tenant_id = ${ctx.tenantId}`
    if (!bom) return 'no-existe'
    if (bom.status !== 'draft') return 'Solo un BOM en borrador se puede activar.'

    const [lineas] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.bom_lines where bom_id = ${bomId} and tenant_id = ${ctx.tenantId}`
    if (Number(lineas!.n) === 0) return 'Agrega al menos un componente antes de activar.'

    await tx`
      update public.bill_of_materials set status = 'obsolete', updated_at = now()
      where tenant_id = ${ctx.tenantId} and product_id = ${bom.product_id} and status = 'active'`

    await tx`
      update public.bill_of_materials set status = 'active', updated_at = now()
      where id = ${bomId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('bom.version.activated',
        ${JSON.stringify({ bomId, productId: bom.product_id })}::text::jsonb, 'bom')`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese BOM no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/bom/${bomId}`)
  revalidatePath('/bom')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearBomForm(fd: FormData): Promise<void> {
  await crearBom(fd)
}
export async function agregarLineaForm(fd: FormData): Promise<void> {
  await agregarLinea(fd)
}
export async function quitarLineaForm(fd: FormData): Promise<void> {
  await quitarLinea(fd)
}
export async function activarBomForm(fd: FormData): Promise<void> {
  await activarBom(fd)
}
