'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { sinExcepciones } from '@/lib/accion-segura'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de listas de precios (modulo 41, F8/S43).
 *
 * Toda accion pasa por `sinExcepciones`: antes un error de la base se
 * mostraba tal cual, en ingles y con el nombre del indice ("duplicate key
 * value violates unique constraint price_list_entries_...").
 */

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
  return sinExcepciones('crearLista', async () => {
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
    if (endDate && endDate < startDate) {
      return { ok: false, error: 'La fecha "hasta" no puede ser antes de la fecha "desde".' }
    }

    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.price_lists (tenant_id, name, scope, customer_id, channel, start_date, end_date)
        values (${ctx.tenantId}, ${name}, ${scope}, ${scope === 'customer' ? customerId : null},
                ${scope === 'channel' ? channel : null}, ${startDate}, ${endDate})`

      await tx`
        select public.emit_event('price-lists.list.created',
          ${JSON.stringify({ name, scope })}::text::jsonb, 'price-lists')`
    })

    revalidatePath('/listas-precio')
    return { ok: true }
  })
}

/** Activa o desactiva una lista de precios. */
export async function cambiarEstadoLista(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('cambiarEstadoLista', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'price-lists', 'price-lists.manage')
    if (!permiso.ok) return permiso

    const listId = String(fd.get('listId') ?? '')
    const status = String(fd.get('status') ?? '')
    if (!listId) return { ok: false, error: 'Falta la lista.' }
    if (!ESTADOS.includes(status)) return { ok: false, error: 'Estado invalido.' }

    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      update public.price_lists set status = ${status}, updated_at = now()
      where id = ${listId} and tenant_id = ${ctx.tenantId}`,
    )

    revalidatePath('/listas-precio')
    return { ok: true }
  })
}

/** Lo que paso al guardar una cuota: si era nueva o si se corrigio el precio. */
export type CuotaGuardada = ActionResult & { actualizada?: boolean }

/**
 * Agrega una cuota de precio -por producto y cantidad minima- a una lista.
 *
 * Si la lista ya tenia una cuota para ese producto desde esa cantidad, se
 * le CORRIGE el precio. Antes daba el error crudo del indice unico y no
 * habia otra forma de arreglar un precio mal escrito: la cuota no se podia
 * editar ni quitar.
 */
export async function crearEntrada(fd: FormData): Promise<CuotaGuardada> {
  let actualizada = false
  const r = await sinExcepciones('crearEntrada', async () => {
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
    if (unitPrice === null || unitPrice < 0)
      return { ok: false, error: 'El precio debe ser un numero valido.' }
    if (minQuantity <= 0) return { ok: false, error: 'La cantidad minima debe ser mayor que cero.' }

    const [fila] = await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx<{ nueva: boolean }[]>`
      insert into public.price_list_entries (tenant_id, price_list_id, product_id, min_quantity, unit_price)
      values (${ctx.tenantId}, ${listId}, ${productId}, ${minQuantity}, ${unitPrice})
      on conflict (tenant_id, price_list_id, product_id, min_quantity)
      do update set unit_price = excluded.unit_price
      returning (xmax = 0) as nueva`,
    )
    actualizada = fila ? !fila.nueva : false

    revalidatePath(`/listas-precio/${listId}`)
    return { ok: true }
  })
  return r.ok ? { ...r, actualizada } : r
}

/** Quita una cuota de precio de una lista. */
export async function quitarEntrada(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('quitarEntrada', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'price-lists', 'price-lists.manage')
    if (!permiso.ok) return permiso

    const listId = String(fd.get('listId') ?? '')
    const entryId = String(fd.get('entryId') ?? '')
    if (!listId || !entryId) return { ok: false, error: 'Faltan datos.' }

    const filas = await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      delete from public.price_list_entries
      where id = ${entryId} and price_list_id = ${listId} and tenant_id = ${ctx.tenantId}
      returning id`,
    )
    if (filas.length === 0) return { ok: false, error: 'Esa cuota ya no existe.' }

    revalidatePath(`/listas-precio/${listId}`)
    return { ok: true }
  })
}

/** Asigna -o quita- la lista de precios de un cliente. */
export async function asignarListaCliente(fd: FormData): Promise<ActionResult> {
  return sinExcepciones('asignarListaCliente', async () => {
    const ctx = await actionCtx(demoDe(fd))
    if (!ctx) return { ok: false, error: 'Sesion no valida.' }
    const permiso = exigir(ctx, 'price-lists', 'price-lists.manage')
    if (!permiso.ok) return permiso

    const customerId = String(fd.get('customerId') ?? '')
    const listId = String(fd.get('listId') ?? '') || null
    if (!customerId) return { ok: false, error: 'Falta el cliente.' }

    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      update public.customers set price_list_id = ${listId}, updated_at = now()
      where id = ${customerId} and tenant_id = ${ctx.tenantId}`,
    )

    revalidatePath('/listas-precio')
    revalidatePath(`/pedidos/clientes/${customerId}`)
    return { ok: true }
  })
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearListaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearLista(fd), 'crearLista')
}
export async function cambiarEstadoListaForm(fd: FormData): Promise<void> {
  await anotarAviso(await cambiarEstadoLista(fd), 'cambiarEstadoLista')
}
export async function crearEntradaForm(fd: FormData): Promise<void> {
  const r = await crearEntrada(fd)
  await anotarAviso(
    r,
    'crearEntrada',
    r.ok && r.actualizada ? 'Esa cuota ya existia: le corregimos el precio.' : undefined,
  )
}
export async function quitarEntradaForm(fd: FormData): Promise<void> {
  await anotarAviso(await quitarEntrada(fd), 'quitarEntrada')
}
export async function asignarListaClienteForm(fd: FormData): Promise<void> {
  await anotarAviso(await asignarListaCliente(fd), 'asignarListaCliente')
}
