'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/** Acciones de listas de precios (modulo 41, F8/S43). */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const ALCANCES = ['customer', 'channel', 'general']
const ESTADOS = ['active', 'inactive']

const num = (raw: string): number | null => {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Crea una lista de precios nueva. */
export async function crearLista(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'price-lists', 'price-lists.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const scope = String(fd.get('scope') ?? '')
  const customerId = String(fd.get('customerId') ?? '') || null
  const channel = String(fd.get('channel') ?? '').trim() || null
  const startDate = String(fd.get('startDate') ?? '')
  const endDate = String(fd.get('endDate') ?? '') || null

  if (!name) return { ok: false, error: 'Escribe el nombre de la lista.' }
  if (!ALCANCES.includes(scope)) return { ok: false, error: 'Elige un alcance valido.' }
  if (scope === 'customer' && !customerId) return { ok: false, error: 'Elige el cliente.' }
  if (scope === 'channel' && !channel) return { ok: false, error: 'Escribe el canal.' }
  if (!startDate) return { ok: false, error: 'Elige la fecha de inicio.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.price_lists (tenant_id, name, scope, customer_id, channel, start_date, end_date)
        values (${ctx.tenantId}, ${name}, ${scope}, ${scope === 'customer' ? customerId : null},
                ${scope === 'channel' ? channel : null}, ${startDate}, ${endDate})`

      await tx`
        select public.emit_event('price-lists.list.created',
          ${JSON.stringify({ name, scope })}::text::jsonb, 'price-lists')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/listas-precio')
  return { ok: true }
}

/** Activa o desactiva una lista de precios. */
export async function cambiarEstadoLista(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'price-lists', 'price-lists.manage')
  if (!permiso.ok) return permiso

  const listId = String(fd.get('listId') ?? '')
  const status = String(fd.get('status') ?? '')
  if (!listId) return { ok: false, error: 'Falta la lista.' }
  if (!ESTADOS.includes(status)) return { ok: false, error: 'Estado invalido.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      update public.price_lists set status = ${status}, updated_at = now()
      where id = ${listId} and tenant_id = ${ctx.tenantId}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/listas-precio')
  return { ok: true }
}

/** Agrega una cuota de precio -por producto y cantidad minima- a una lista. */
export async function crearEntrada(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'price-lists', 'price-lists.manage')
  if (!permiso.ok) return permiso

  const listId = String(fd.get('listId') ?? '')
  const productId = String(fd.get('productId') ?? '')
  const minQuantity = num(String(fd.get('minQuantity') ?? '1')) ?? 1
  const unitPrice = num(String(fd.get('unitPrice') ?? ''))

  if (!listId) return { ok: false, error: 'Falta la lista.' }
  if (!productId) return { ok: false, error: 'Elige el producto.' }
  if (unitPrice === null || unitPrice < 0) return { ok: false, error: 'El precio debe ser un numero valido.' }
  if (minQuantity <= 0) return { ok: false, error: 'La cantidad minima debe ser mayor que cero.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.price_list_entries (tenant_id, price_list_id, product_id, min_quantity, unit_price)
      values (${ctx.tenantId}, ${listId}, ${productId}, ${minQuantity}, ${unitPrice})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/listas-precio/${listId}`)
  return { ok: true }
}

/** Asigna -o quita- la lista de precios de un cliente. */
export async function asignarListaCliente(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'price-lists', 'price-lists.manage')
  if (!permiso.ok) return permiso

  const customerId = String(fd.get('customerId') ?? '')
  const listId = String(fd.get('listId') ?? '') || null
  if (!customerId) return { ok: false, error: 'Falta el cliente.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      update public.customers set price_list_id = ${listId}, updated_at = now()
      where id = ${customerId} and tenant_id = ${ctx.tenantId}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/listas-precio')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearListaForm(fd: FormData): Promise<void> {
  await crearLista(fd)
}
export async function cambiarEstadoListaForm(fd: FormData): Promise<void> {
  await cambiarEstadoLista(fd)
}
export async function crearEntradaForm(fd: FormData): Promise<void> {
  await crearEntrada(fd)
}
export async function asignarListaClienteForm(fd: FormData): Promise<void> {
  await asignarListaCliente(fd)
}
