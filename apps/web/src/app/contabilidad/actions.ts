'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de contabilidad (modulo 16, F6/S28-29).
 *
 * UN ASIENTO CONTABILIZADO ES INMUTABLE: la garantia real vive en el
 * trigger de 0041, no aqui — esto solo evita el viaje al servidor cuando
 * ya se sabe que va a fallar (ej. no ofrecer "agregar linea" en un
 * asiento que ya se contabilizo).
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

// ── Catalogo de cuentas ──────────────────────────────────────────────────

export async function crearCuenta(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'accounting', 'accounting.accounts.manage')
  if (!permiso.ok) return permiso

  const code = String(fd.get('code') ?? '').trim()
  const name = String(fd.get('name') ?? '').trim()
  const type = String(fd.get('type') ?? '')
  if (code.length < 1) return { ok: false, error: 'El codigo de cuenta no puede estar vacio.' }
  if (name.length < 2) return { ok: false, error: 'El nombre necesita al menos 2 letras.' }
  if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(type)) {
    return { ok: false, error: 'Elige un tipo de cuenta valido.' }
  }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      insert into public.accounts (tenant_id, code, name, type)
      values (${ctx.tenantId}, ${code}, ${name}, ${type})`
  })

  revalidatePath('/contabilidad/cuentas')
  return { ok: true }
}

export async function alternarCuenta(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'accounting', 'accounting.accounts.manage')
  if (!permiso.ok) return permiso

  const id = String(fd.get('id') ?? '')
  if (!id) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.accounts set is_active = not is_active, updated_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath('/contabilidad/cuentas')
  return { ok: true }
}

// ── Asientos ─────────────────────────────────────────────────────────────

/** Crea el asiento en borrador. Las lineas se agregan despues. */
export async function crearAsiento(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'accounting', 'accounting.entry.create')
  if (!permiso.ok) return permiso

  const description = String(fd.get('description') ?? '').trim()
  const entryDate = String(fd.get('entryDate') ?? '').trim()
  if (description.length < 3) return { ok: false, error: 'Describe de que trata el asiento.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [n] = await tx<{ next_journal_entry_number: string }[]>`
      select public.next_journal_entry_number(${ctx.tenantId})`

    await tx`
      insert into public.journal_entries (tenant_id, number, description, entry_date, created_by)
      values (${ctx.tenantId}, ${n!.next_journal_entry_number}, ${description},
              ${entryDate || new Date().toISOString().slice(0, 10)}, ${ctx.userId})`
  })

  revalidatePath('/contabilidad')
  return { ok: true }
}

export async function agregarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'accounting', 'accounting.entry.create')
  if (!permiso.ok) return permiso

  const entryId = String(fd.get('entryId') ?? '')
  const accountId = String(fd.get('accountId') ?? '')
  const lado = String(fd.get('lado') ?? '') // 'debit' | 'credit'
  const monto = num(String(fd.get('amount') ?? ''))
  const memo = String(fd.get('memo') ?? '').trim() || null
  if (!entryId || !accountId) return { ok: false, error: 'Elige cuenta.' }
  if (monto === null || monto <= 0) return { ok: false, error: 'El monto debe ser positivo.' }
  if (lado !== 'debit' && lado !== 'credit') return { ok: false, error: 'Elige debito o credito.' }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [entry] = await tx<{ status: string }[]>`
      select status from public.journal_entries
      where id = ${entryId} and tenant_id = ${ctx.tenantId}`
    if (!entry) return 'no-existe'
    if (entry.status !== 'draft') return 'no-borrador'

    await tx`
      insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit, memo)
      values (${entryId}, ${ctx.tenantId}, ${accountId},
              ${lado === 'debit' ? monto : 0}, ${lado === 'credit' ? monto : 0}, ${memo})`
    return 'ok'
  })

  if (res === 'no-existe') return { ok: false, error: 'Ese asiento no existe.' }
  if (res === 'no-borrador') return { ok: false, error: 'Solo se agregan lineas a un borrador.' }

  revalidatePath(`/contabilidad/${entryId}`)
  return { ok: true }
}

export async function quitarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'accounting', 'accounting.entry.create')
  if (!permiso.ok) return permiso

  const entryId = String(fd.get('entryId') ?? '')
  const lineId = String(fd.get('lineId') ?? '')
  if (!entryId || !lineId) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      delete from public.journal_entry_lines
      where id = ${lineId} and entry_id = ${entryId} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath(`/contabilidad/${entryId}`)
  return { ok: true }
}

/**
 * Contabiliza el asiento. La validacion de verdad -al menos dos lineas,
 * debito = credito- vive en `post_journal_entry()`; aqui solo se traduce
 * el error de SQL a algo legible.
 */
export async function contabilizarAsiento(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'accounting', 'accounting.entry.post')
  if (!permiso.ok) return permiso

  const entryId = String(fd.get('entryId') ?? '')
  if (!entryId) return { ok: false, error: 'Faltan datos.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) =>
      tx`select public.post_journal_entry(${entryId})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/contabilidad/${entryId}`)
  revalidatePath('/contabilidad')
  return { ok: true }
}

/** Borra un asiento en borrador. Uno contabilizado lo rechaza el trigger. */
export async function borrarAsiento(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'accounting', 'accounting.entry.delete')
  if (!permiso.ok) return permiso

  const entryId = String(fd.get('entryId') ?? '')
  if (!entryId) return { ok: false, error: 'Faltan datos.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) =>
      tx`delete from public.journal_entries where id = ${entryId} and tenant_id = ${ctx.tenantId}`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/contabilidad')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearCuentaForm(fd: FormData): Promise<void> {
  await crearCuenta(fd)
}
export async function alternarCuentaForm(fd: FormData): Promise<void> {
  await alternarCuenta(fd)
}
export async function crearAsientoForm(fd: FormData): Promise<void> {
  await crearAsiento(fd)
}
export async function agregarLineaForm(fd: FormData): Promise<void> {
  await agregarLinea(fd)
}
export async function quitarLineaForm(fd: FormData): Promise<void> {
  await quitarLinea(fd)
}
export async function contabilizarAsientoForm(fd: FormData): Promise<void> {
  await contabilizarAsiento(fd)
}
export async function borrarAsientoForm(fd: FormData): Promise<void> {
  await borrarAsiento(fd)
}
