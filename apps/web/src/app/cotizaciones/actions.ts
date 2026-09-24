'use server'

import { revalidatePath } from 'next/cache'
import { mejorCotizacion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/** Acciones de cotizacion a proveedores / RFQ (modulo 44, F8/S44). */

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

/** Crea un RFQ nuevo. */
export async function crearRfq(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'rfq', 'rfq.manage')
  if (!permiso.ok) return permiso

  const title = String(fd.get('title') ?? '').trim()
  const description = String(fd.get('description') ?? '').trim() || null
  const deadline = String(fd.get('deadline') ?? '') || null

  if (!title) return { ok: false, error: 'Escribe el titulo.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.rfqs (tenant_id, title, description, deadline)
      values (${ctx.tenantId}, ${title}, ${description}, ${deadline})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/cotizaciones')
  return { ok: true }
}

/** Invita a un proveedor a cotizar. */
export async function invitarProveedor(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'rfq', 'rfq.manage')
  if (!permiso.ok) return permiso

  const rfqId = String(fd.get('rfqId') ?? '')
  const supplierId = String(fd.get('supplierId') ?? '')
  if (!rfqId) return { ok: false, error: 'Falta el RFQ.' }
  if (!supplierId) return { ok: false, error: 'Elige el proveedor.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.rfq_invitations (tenant_id, rfq_id, supplier_id)
      values (${ctx.tenantId}, ${rfqId}, ${supplierId})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key'))
      return { ok: false, error: 'Ese proveedor ya esta invitado.' }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/cotizaciones/${rfqId}`)
  return { ok: true }
}

/** Registra la cotizacion de un proveedor -queda fija desde el momento en que se registra-. */
export async function registrarCotizacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'rfq', 'rfq.manage')
  if (!permiso.ok) return permiso

  const rfqId = String(fd.get('rfqId') ?? '')
  const supplierId = String(fd.get('supplierId') ?? '')
  const totalAmount = num(String(fd.get('totalAmount') ?? ''))
  const leadTimeDays = Number.parseInt(String(fd.get('leadTimeDays') ?? ''), 10)
  const notes = String(fd.get('notes') ?? '').trim() || null

  if (!rfqId) return { ok: false, error: 'Falta el RFQ.' }
  if (!supplierId) return { ok: false, error: 'Elige el proveedor.' }
  if (totalAmount === null || totalAmount <= 0)
    return { ok: false, error: 'El monto debe ser mayor que cero.' }
  if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0) {
    return { ok: false, error: 'El plazo de entrega debe ser un entero de 0 o mas dias.' }
  }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.rfq_quotes (tenant_id, rfq_id, supplier_id, total_amount, lead_time_days, notes)
      values (${ctx.tenantId}, ${rfqId}, ${supplierId}, ${totalAmount}, ${leadTimeDays}, ${notes})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key')) {
      return {
        ok: false,
        error: 'Ese proveedor ya cotizo en este RFQ. Una cotizacion registrada no se cambia.',
      }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/cotizaciones/${rfqId}`)
  return { ok: true }
}

/** Adjudica el RFQ a un proveedor. */
export async function adjudicarRfq(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'rfq', 'rfq.award')
  if (!permiso.ok) return permiso

  const rfqId = String(fd.get('rfqId') ?? '')
  const supplierId = String(fd.get('supplierId') ?? '')
  if (!rfqId) return { ok: false, error: 'Falta el RFQ.' }
  if (!supplierId) return { ok: false, error: 'Elige el proveedor ganador.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [row] = await tx<{ status: string }[]>`
        select status from public.rfqs where id = ${rfqId} and tenant_id = ${ctx.tenantId}`
      if (!row) throw new Error('Ese RFQ no existe.')
      if (row.status !== 'open') throw new Error('Ese RFQ ya fue resuelto.')

      // La regla que el modulo promete -"gana siempre el monto mas bajo,
      // nunca a criterio de quien compra"- la hace cumplir el servidor, no
      // solo la insignia de la pantalla. Antes cualquier fila tenia su
      // boton "Adjudicar" y la accion aceptaba cualquier proveedor, aunque
      // no hubiera cotizado.
      const cotizaciones = await tx<
        { supplier_id: string; total_amount: string; lead_time_days: number }[]
      >`
        select supplier_id, total_amount::text, lead_time_days from public.rfq_quotes
        where rfq_id = ${rfqId} and tenant_id = ${ctx.tenantId}`
      if (cotizaciones.length === 0)
        throw new Error('Registra al menos una cotizacion antes de adjudicar.')
      const ganador = mejorCotizacion(
        cotizaciones.map((c) => ({
          supplierId: c.supplier_id,
          totalAmount: Number(c.total_amount),
          leadTimeDays: c.lead_time_days,
        })),
      )
      if (!cotizaciones.some((c) => c.supplier_id === supplierId)) {
        throw new Error('Ese proveedor no cotizo en este RFQ.')
      }
      if (supplierId !== ganador) {
        throw new Error(
          'Se adjudica a la mejor oferta: el monto mas bajo y, si empatan, el plazo mas corto.',
        )
      }

      await tx`
        update public.rfqs
        set status = 'awarded', awarded_supplier_id = ${supplierId}, awarded_at = now(), updated_at = now()
        where id = ${rfqId} and tenant_id = ${ctx.tenantId}`

      await tx`
        select public.emit_event('rfq.supplier.awarded',
          ${JSON.stringify({ rfqId, supplierId })}::text::jsonb, 'rfq')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/cotizaciones/${rfqId}`)
  revalidatePath('/cotizaciones')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearRfqForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearRfq(fd), 'crearRfq')
}
export async function invitarProveedorForm(fd: FormData): Promise<void> {
  await anotarAviso(await invitarProveedor(fd), 'invitarProveedor', 'Listo, quedo invitado.')
}
export async function registrarCotizacionForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await registrarCotizacion(fd),
    'registrarCotizacion',
    'Listo, anotamos su cotizacion.',
  )
}
export async function adjudicarRfqForm(fd: FormData): Promise<void> {
  // "adjudicar" no esta entre los verbos que el aviso reconoce: salia
  // "Guardamos tu cambio", que no dice a quien se le dio la compra.
  await anotarAviso(
    await adjudicarRfq(fd),
    'adjudicarRfq',
    'Listo, quedo adjudicado a la mejor oferta.',
  )
}
