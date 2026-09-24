'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de conciliacion bancaria (modulo 20, F6/S30-31).
 *
 * Confirmar/desconciliar delegan TODO en match_statement_line()/
 * unmatch_statement_line() (0045): esta capa no repite la validacion de
 * tenant/cuenta, porque repetirla aqui y en SQL es la forma mas facil de
 * que un dia se desincronicen.
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

interface LineaParseada {
  fecha: string
  descripcion: string
  monto: number
}

/**
 * Formato de pegado: una linea por movimiento, `fecha,descripcion,monto`.
 * El monto es positivo si entro, negativo si salio -el mismo signo que trae
 * el estado de cuenta del banco-. La descripcion puede tener comas: se
 * parte por la PRIMERA (fecha) y la ULTIMA (monto), lo de en medio es la
 * descripcion completa.
 */
function parsearLineas(texto: string): LineaParseada[] {
  const lineas: LineaParseada[] = []
  for (const raw of texto.split('\n')) {
    const linea = raw.trim()
    if (!linea) continue
    const partes = linea.split(',')
    if (partes.length < 3) continue
    const fecha = partes[0]!.trim()
    const monto = num(partes[partes.length - 1]!)
    const descripcion = partes.slice(1, -1).join(',').trim()
    if (!fecha || !descripcion || monto === null || monto === 0) continue
    lineas.push({ fecha, descripcion, monto })
  }
  return lineas
}

/** Registra un import: el encabezado del estado de cuenta y sus lineas pegadas. */
export async function crearImport(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bank-rec', 'bank-rec.import.create')
  if (!permiso.ok) return permiso

  const accountId = String(fd.get('accountId') ?? '')
  const periodStart = String(fd.get('periodStart') ?? '').trim()
  const periodEnd = String(fd.get('periodEnd') ?? '').trim()
  const statementBalance = num(String(fd.get('statementBalance') ?? ''))
  const textoLineas = String(fd.get('lines') ?? '')

  if (!accountId) return { ok: false, error: 'Elige la cuenta bancaria.' }
  if (!periodStart || !periodEnd) return { ok: false, error: 'Falta el periodo del estado.' }
  if (statementBalance === null) return { ok: false, error: 'El saldo del estado no es valido.' }

  const lineas = parsearLineas(textoLineas)
  if (lineas.length === 0) {
    return {
      ok: false,
      error: 'Pega al menos una linea con el formato fecha,descripcion,monto.',
    }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [cuenta] = await tx<{ id: string }[]>`
        select id from public.bank_accounts
        where id = ${accountId} and tenant_id = ${ctx.tenantId} and is_active`
      if (!cuenta) throw new Error('sin-cuenta')

      const [imp] = await tx<{ id: string }[]>`
        insert into public.bank_statement_imports
          (tenant_id, bank_account_id, period_start, period_end, statement_balance, imported_by)
        values (${ctx.tenantId}, ${accountId}, ${periodStart}, ${periodEnd},
                ${statementBalance}, ${ctx.userId})
        returning id`

      for (const l of lineas) {
        await tx`
          insert into public.bank_statement_lines
            (tenant_id, import_id, bank_account_id, line_date, description, amount)
          values (${ctx.tenantId}, ${imp!.id}, ${accountId}, ${l.fecha}, ${l.descripcion}, ${l.monto})`
      }

      await tx`
        select public.emit_event('bank-rec.import.created',
          ${JSON.stringify({ accountId, lineas: lineas.length })}::text::jsonb, 'bank-rec')`
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'sin-cuenta') {
      return { ok: false, error: 'Esa cuenta no existe o esta inactiva.' }
    }
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/conciliacion')
  return { ok: true }
}

/** Confirma un emparejamiento -sugerido por el sistema o elegido a mano-. */
export async function confirmarMatch(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bank-rec', 'bank-rec.match.confirm')
  if (!permiso.ok) return permiso

  const lineId = String(fd.get('lineId') ?? '')
  const transactionId = String(fd.get('transactionId') ?? '')
  const importId = String(fd.get('importId') ?? '')
  if (!lineId || !transactionId)
    return { ok: false, error: 'Elige el movimiento con el que concilia.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`select public.match_statement_line(${lineId}, ${transactionId})`,
    )
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) =>
        tx`select public.emit_event('bank-rec.line.matched',
        ${JSON.stringify({ lineId, transactionId })}::text::jsonb, 'bank-rec')`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
      return { ok: false, error: 'Ese movimiento ya se concilio con otra linea.' }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/conciliacion/${importId}`)
  return { ok: true }
}

/** Deshace un emparejamiento: la linea vuelve a pendiente. */
export async function desconciliar(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bank-rec', 'bank-rec.match.confirm')
  if (!permiso.ok) return permiso

  const lineId = String(fd.get('lineId') ?? '')
  const importId = String(fd.get('importId') ?? '')
  if (!lineId) return { ok: false, error: 'Falta la linea.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`select public.unmatch_statement_line(${lineId})`,
  )

  revalidatePath(`/conciliacion/${importId}`)
  return { ok: true }
}

/** Marca una linea como ignorada: nunca va a tener pareja, pero no se borra. */
export async function ignorarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bank-rec', 'bank-rec.match.confirm')
  if (!permiso.ok) return permiso

  const lineId = String(fd.get('lineId') ?? '')
  const importId = String(fd.get('importId') ?? '')
  if (!lineId) return { ok: false, error: 'Falta la linea.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    update public.bank_statement_lines set match_status = 'ignored'
    where id = ${lineId} and tenant_id = ${ctx.tenantId} and match_status = 'pending'`,
  )

  revalidatePath(`/conciliacion/${importId}`)
  return { ok: true }
}

/** Vuelve una linea ignorada a pendiente. */
export async function reactivarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bank-rec', 'bank-rec.match.confirm')
  if (!permiso.ok) return permiso

  const lineId = String(fd.get('lineId') ?? '')
  const importId = String(fd.get('importId') ?? '')
  if (!lineId) return { ok: false, error: 'Falta la linea.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    update public.bank_statement_lines set match_status = 'pending'
    where id = ${lineId} and tenant_id = ${ctx.tenantId} and match_status = 'ignored'`,
  )

  revalidatePath(`/conciliacion/${importId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearImportForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearImport(fd), 'crearImport')
}
export async function confirmarMatchForm(fd: FormData): Promise<void> {
  await anotarAviso(await confirmarMatch(fd), 'confirmarMatch')
}
export async function desconciliarForm(fd: FormData): Promise<void> {
  await anotarAviso(await desconciliar(fd), 'desconciliar')
}
export async function ignorarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await ignorarLinea(fd), 'ignorarLinea')
}
export async function reactivarLineaForm(fd: FormData): Promise<void> {
  await anotarAviso(await reactivarLinea(fd), 'reactivarLinea')
}
