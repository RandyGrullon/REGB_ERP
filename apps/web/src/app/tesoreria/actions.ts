'use server'

import { revalidatePath } from 'next/cache'
import { validateTransfer } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de tesoreria (modulo 19, F6/S30).
 *
 * Nada de "editar" ni "borrar": un movimiento bancario nace definitivo y
 * se corrige con el movimiento contrario. La base lo impone con triggers
 * (0044) — aqui simplemente no existen esas acciones.
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

/** Da de alta una cuenta bancaria del negocio. */
export async function crearCuenta(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'treasury', 'treasury.account.create')
  if (!permiso.ok) return permiso

  const bankName = String(fd.get('bankName') ?? '').trim()
  const accountName = String(fd.get('accountName') ?? '').trim()
  const accountNumber = String(fd.get('accountNumber') ?? '').trim()
  const accountType = String(fd.get('accountType') ?? 'checking')
  const opening = num(String(fd.get('openingBalance') ?? '0')) ?? 0

  if (bankName.length < 2) return { ok: false, error: 'Escribe el nombre del banco.' }
  if (accountName.length < 2) return { ok: false, error: 'Ponle un nombre a la cuenta.' }
  if (accountNumber.length < 3) return { ok: false, error: 'Escribe el numero de cuenta.' }
  if (!['checking', 'savings'].includes(accountType)) {
    return { ok: false, error: 'Tipo de cuenta no valido.' }
  }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        insert into public.bank_accounts
          (tenant_id, bank_name, account_name, account_number, account_type, opening_balance)
        values (${ctx.tenantId}, ${bankName}, ${accountName}, ${accountNumber},
                ${accountType}, ${opening})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key')) {
      return { ok: false, error: 'Ya tienes registrada esa cuenta en ese banco.' }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/tesoreria')
  return { ok: true }
}

/** Registra un deposito o un retiro. Queda fijo: no se edita ni se borra. */
export async function registrarMovimiento(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'treasury', 'treasury.transaction.record')
  if (!permiso.ok) return permiso

  const accountId = String(fd.get('accountId') ?? '')
  const tipo = String(fd.get('type') ?? '')
  const monto = num(String(fd.get('amount') ?? ''))
  const descripcion = String(fd.get('description') ?? '').trim()
  const referencia = String(fd.get('reference') ?? '').trim() || null
  const fechaRaw = String(fd.get('transactionDate') ?? '').trim()

  if (!accountId) return { ok: false, error: 'Elige la cuenta.' }
  // transfer_in/transfer_out no se registran a mano: los crea el trigger de
  // una transferencia, para que nunca exista una mitad sin la otra.
  if (!['deposit', 'withdrawal'].includes(tipo)) {
    return { ok: false, error: 'Un movimiento a mano solo puede ser deposito o retiro.' }
  }
  if (monto === null || monto <= 0) return { ok: false, error: 'El monto debe ser mayor que cero.' }
  if (descripcion.length < 3) return { ok: false, error: 'Describe el movimiento.' }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [cuenta] = await tx<{ id: string }[]>`
      select id from public.bank_accounts
      where id = ${accountId} and tenant_id = ${ctx.tenantId} and is_active`
    if (!cuenta) return 'sin-cuenta'

    await tx`
      insert into public.bank_transactions
        (tenant_id, bank_account_id, type, amount, description, reference, transaction_date, created_by)
      values (${ctx.tenantId}, ${accountId}, ${tipo}, ${monto}, ${descripcion}, ${referencia},
              coalesce(${fechaRaw || null}::date, current_date), ${ctx.userId})`

    await tx`
      select public.emit_event('treasury.transaction.recorded',
        ${JSON.stringify({ accountId, tipo, monto })}::text::jsonb, 'treasury')`

    return 'ok'
  })

  if (res === 'sin-cuenta') return { ok: false, error: 'Esa cuenta no existe o esta inactiva.' }

  revalidatePath('/tesoreria')
  revalidatePath(`/tesoreria/${accountId}`)
  return { ok: true }
}

/** Mueve dinero entre dos cuentas propias. La base crea las dos mitades juntas. */
export async function registrarTransferencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'treasury', 'treasury.transfer.create')
  if (!permiso.ok) return permiso

  const desde = String(fd.get('fromAccountId') ?? '')
  const hacia = String(fd.get('toAccountId') ?? '')
  const monto = num(String(fd.get('amount') ?? '')) ?? 0
  const descripcion = String(fd.get('description') ?? '').trim() || null
  const fechaRaw = String(fd.get('transferDate') ?? '').trim()

  const valida = validateTransfer(desde, hacia, monto)
  if (!valida.ok) return valida

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const cuentas = await tx<{ id: string }[]>`
      select id from public.bank_accounts
      where tenant_id = ${ctx.tenantId} and is_active and id in (${desde}, ${hacia})`
    if (cuentas.length < 2) return 'sin-cuenta'

    await tx`
      insert into public.bank_transfers
        (tenant_id, from_account_id, to_account_id, amount, transfer_date, description, created_by)
      values (${ctx.tenantId}, ${desde}, ${hacia}, ${monto},
              coalesce(${fechaRaw || null}::date, current_date), ${descripcion}, ${ctx.userId})`

    await tx`
      select public.emit_event('treasury.transfer.recorded',
        ${JSON.stringify({ desde, hacia, monto })}::text::jsonb, 'treasury')`

    return 'ok'
  })

  if (res === 'sin-cuenta')
    return { ok: false, error: 'Alguna de las dos cuentas no existe o esta inactiva.' }

  revalidatePath('/tesoreria')
  revalidatePath('/tesoreria/flujo')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearCuentaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearCuenta(fd), 'crearCuenta')
}
export async function registrarMovimientoForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarMovimiento(fd), 'registrarMovimiento')
}
export async function registrarTransferenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarTransferencia(fd), 'registrarTransferencia')
}
