'use server'

import { revalidatePath } from 'next/cache'
import { PROPOSITOS_CONTABLES, fechaFiscal } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'
import { TIPO_CUENTA } from './estados'

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

  // Un codigo repetido lanzaba la excepcion de la base sin atrapar y la
  // pantalla entera caia en el error generico: el contador perdia lo que
  // escribio sin saber por que.
  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => {
      return tx`
        insert into public.accounts (tenant_id, code, name, type)
        values (${ctx.tenantId}, ${code}, ${name}, ${type})`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key')) {
      return { ok: false, error: `Ya tienes una cuenta con el codigo ${code}.` }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

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

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [cuenta] = await tx<{ code: string; name: string; is_active: boolean }[]>`
      select code, name, is_active from public.accounts
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    if (!cuenta) return 'Esa cuenta no existe.'

    // Desactivar una cuenta que usa el mapa rompe los asientos automaticos
    // en silencio: el despachador reintenta y reintenta, y las ventas y
    // pagos de ese rato no llegan al mayor hasta que alguien lo nota. Se
    // dice aqui, en palabras del contador, que uso hay que mover primero.
    if (cuenta.is_active) {
      const usos = await tx<{ purpose: string }[]>`
        select purpose from public.accounting_account_map
        where tenant_id = ${ctx.tenantId} and account_id = ${id}`
      if (usos.length > 0) {
        const nombres = usos
          .map(
            (u) =>
              PROPOSITOS_CONTABLES.find((p) => p.proposito === u.purpose)?.etiqueta ?? u.purpose,
          )
          .join(', ')
        return `La cuenta ${cuenta.code} ${cuenta.name} la usan los asientos automaticos (${nombres}). Asigna otra en el Mapa de cuentas antes de desactivarla.`
      }
    }

    await tx`
      update public.accounts set is_active = not is_active, updated_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (res !== 'ok') return { ok: false, error: res }
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
  if (entryDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    return { ok: false, error: 'La fecha del asiento no es valida.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [n] = await tx<{ next_journal_entry_number: string }[]>`
        select public.next_journal_entry_number(${ctx.tenantId})`

      // Sin fecha, HOY en Santo Domingo. `toISOString()` es el dia de UTC:
      // un asiento creado despues de las 8 de la noche salia con fecha de
      // mañana -y el ultimo dia del mes, en el mes siguiente-.
      await tx`
        insert into public.journal_entries (tenant_id, number, description, entry_date, created_by)
        values (${ctx.tenantId}, ${n!.next_journal_entry_number}, ${description},
                ${entryDate || fechaFiscal(new Date())}, ${ctx.userId})`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

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
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`select public.post_journal_entry(${entryId})`)
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
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) =>
        tx`delete from public.journal_entries where id = ${entryId} and tenant_id = ${ctx.tenantId}`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/contabilidad')
  return { ok: true }
}

// ── Mapa contable (asientos automaticos) ────────────────────────────────

/**
 * Asigna la cuenta del catalogo que usan los asientos automaticos para un
 * proposito ("la caja", "el ITBIS por pagar"). El tipo lo exige tambien
 * la base (trigger de 0131); aqui se comprueba antes para decirlo en
 * palabras del contador y no con el texto de un trigger.
 */
export async function guardarMapaCuenta(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'accounting', 'accounting.accounts.manage')
  if (!permiso.ok) return permiso

  const purpose = String(fd.get('purpose') ?? '')
  const accountId = String(fd.get('accountId') ?? '')
  const def = PROPOSITOS_CONTABLES.find((p) => p.proposito === purpose)
  if (!def) return { ok: false, error: 'Ese uso de cuenta no existe.' }
  if (!accountId) return { ok: false, error: 'Elige la cuenta.' }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [cuenta] = await tx<{ code: string; name: string; type: string; is_active: boolean }[]>`
      select code, name, type, is_active from public.accounts
      where id = ${accountId} and tenant_id = ${ctx.tenantId}`
    if (!cuenta) return 'Esa cuenta no existe.'
    if (!cuenta.is_active) return `La cuenta ${cuenta.code} ${cuenta.name} esta desactivada.`
    if (cuenta.type !== def.tipo) {
      const quiere = (TIPO_CUENTA[def.tipo] ?? def.tipo).toLowerCase()
      const tiene = (TIPO_CUENTA[cuenta.type] ?? cuenta.type).toLowerCase()
      return `«${def.etiqueta}» necesita una cuenta de ${quiere}; ${cuenta.code} ${cuenta.name} es de ${tiene}.`
    }

    await tx`
      insert into public.accounting_account_map (tenant_id, purpose, account_id)
      values (${ctx.tenantId}, ${purpose}, ${accountId})
      on conflict (tenant_id, purpose) do update
        set account_id = excluded.account_id, updated_at = now()`
    return 'ok'
  })

  if (res !== 'ok') return { ok: false, error: res }
  revalidatePath('/contabilidad/mapa')
  return { ok: true }
}

/**
 * Crea las cuentas del catalogo minimo que falten y asigna los usos que
 * esten vacios. Lo mismo hace el primer asiento automatico; esto es para
 * el que quiere verlo y ajustarlo ANTES de la primera venta.
 */
export async function crearCuentasPorDefecto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'accounting', 'accounting.accounts.manage')
  if (!permiso.ok) return permiso

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`select public.asegurar_mapa_contable(${ctx.tenantId})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/contabilidad/mapa')
  revalidatePath('/contabilidad/cuentas')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function guardarMapaCuentaForm(fd: FormData): Promise<void> {
  await anotarAviso(await guardarMapaCuenta(fd), 'guardarMapaCuenta')
}
export async function crearCuentasPorDefectoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearCuentasPorDefecto(fd), 'crearCuentasPorDefecto')
}
export async function crearCuentaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearCuenta(fd), 'crearCuenta')
}
export async function alternarCuentaForm(fd: FormData): Promise<void> {
  await anotarAviso(await alternarCuenta(fd), 'alternarCuenta')
}
export async function crearAsientoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearAsiento(fd), 'crearAsiento')
}
export async function agregarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await agregarLinea(fd), 'agregarLinea')
}
export async function quitarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await quitarLinea(fd), 'quitarLinea')
}
export async function contabilizarAsientoForm(fd: FormData): Promise<void> {
  await anotarAviso(await contabilizarAsiento(fd), 'contabilizarAsiento')
}
export async function borrarAsientoForm(fd: FormData): Promise<void> {
  await anotarAviso(await borrarAsiento(fd), 'borrarAsiento')
}
