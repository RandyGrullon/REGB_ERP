'use server'

import { revalidatePath } from 'next/cache'
import { validateElimination } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de consolidacion (modulo 28, F11/S80).
 *
 * Doble candado en las siete: permiso en SERVIDOR con exigir() y escritura
 * bajo RLS con asUser(). Que la pantalla oculte el boton no cuenta (§8.3).
 *
 * La que de verdad tiene sustancia es generarCorrida(), y lo que hace es
 * llamar a public.consolidation_freeze(): la foto -los asientos YA
 * CONTABILIZADOS acumulados hasta la fecha de corte- se congela en SQL,
 * donde la regla se escribe una sola vez y la pantalla la lee en vez de
 * volver a inventarla.
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

const limpiarError = (e: unknown): string =>
  (e instanceof Error ? e.message : 'Error inesperado').replace(/^.*ERROR:\s*/, '')

/** Da de alta un grupo de consolidacion. */
export async function crearGrupo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'consolidation', 'consolidation.group.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const currency = String(fd.get('presentationCurrency') ?? 'DOP')
    .trim()
    .toUpperCase()

  if (name.length < 2) return { ok: false, error: 'Escribe el nombre del grupo.' }
  if (currency.length !== 3)
    return { ok: false, error: 'La moneda va en tres letras: DOP, USD, EUR.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        insert into public.consolidation_groups (tenant_id, name, presentation_currency)
        values (${ctx.tenantId}, ${name}, ${currency})`,
    )
  } catch (e) {
    const msg = limpiarError(e)
    if (msg.includes('duplicate key'))
      return { ok: false, error: 'Ya existe un grupo con ese nombre.' }
    return { ok: false, error: msg }
  }

  revalidatePath('/consolidacion')
  return { ok: true }
}

/**
 * Mete una empresa al grupo. La base exige que lleve la misma moneda que
 * el grupo presenta -este corte no traduce moneda- y que haya una sola
 * matriz; aqui solo se traduce el error a algo que se pueda leer.
 */
export async function agregarEmpresa(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'consolidation', 'consolidation.group.manage')
  if (!permiso.ok) return permiso

  const groupId = String(fd.get('groupId') ?? '')
  const companyId = String(fd.get('companyId') ?? '')
  const isParent = String(fd.get('isParent') ?? '') === 'on'

  if (!groupId) return { ok: false, error: 'Elige el grupo.' }
  if (!companyId) return { ok: false, error: 'Elige la empresa.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        insert into public.consolidation_group_members
          (tenant_id, group_id, company_id, is_parent)
        values (${ctx.tenantId}, ${groupId}, ${companyId}, ${isParent})`,
    )
  } catch (e) {
    const msg = limpiarError(e)
    if (msg.includes('duplicate key')) {
      return {
        ok: false,
        error: isParent
          ? 'Ese grupo ya tiene una matriz, o esa empresa ya esta dentro.'
          : 'Esa empresa ya esta en el grupo.',
      }
    }
    return { ok: false, error: msg }
  }

  revalidatePath('/consolidacion')
  return { ok: true }
}

/** Saca una empresa del grupo. */
export async function quitarEmpresa(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'consolidation', 'consolidation.group.manage')
  if (!permiso.ok) return permiso

  const memberId = String(fd.get('memberId') ?? '')
  if (!memberId) return { ok: false, error: 'No se dijo que empresa sacar.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        delete from public.consolidation_group_members
        where id = ${memberId} and tenant_id = ${ctx.tenantId}`,
    )
  } catch (e) {
    return { ok: false, error: limpiarError(e) }
  }

  revalidatePath('/consolidacion')
  return { ok: true }
}

/**
 * Genera la corrida de un periodo y congela su foto de entrada.
 *
 * La foto se arma con un solo insert...select desde las lineas de asientos
 * YA CONTABILIZADOS -un borrador no es un hecho contable, mismo criterio
 * que la balanza de accounting-. Se guarda la ENTRADA, no el resultado: el
 * consolidado se deriva de esta foto mas las eliminaciones cada vez que se
 * pinta la pantalla.
 */
export async function generarCorrida(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'consolidation', 'consolidation.run.create')
  if (!permiso.ok) return permiso

  const groupId = String(fd.get('groupId') ?? '')
  const periodStart = String(fd.get('periodStart') ?? '').trim()
  const periodEnd = String(fd.get('periodEnd') ?? '').trim()

  if (!groupId) return { ok: false, error: 'Elige el grupo a consolidar.' }
  if (!periodStart || !periodEnd) return { ok: false, error: 'Dime desde cuando y hasta cuando.' }
  if (periodEnd < periodStart) {
    return { ok: false, error: 'El periodo no puede terminar antes de empezar.' }
  }

  let runId = ''
  try {
    runId = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const miembros = await tx<{ c: string }[]>`
        select count(*) as c from public.consolidation_group_members
        where group_id = ${groupId} and tenant_id = ${ctx.tenantId}`
      if (Number(miembros[0]?.c ?? 0) < 2) {
        throw new Error('Un grupo con menos de dos empresas no tiene nada que consolidar.')
      }

      const [corrida] = await tx<{ id: string }[]>`
        insert into public.consolidation_runs
          (tenant_id, group_id, period_start, period_end, created_by)
        values (${ctx.tenantId}, ${groupId}, ${periodStart}::date, ${periodEnd}::date, ${ctx.userId})
        returning id`
      const id = corrida!.id

      // Congelar la foto es un insert...select de cientos de filas y, sobre
      // todo, UNA REGLA: que ventana mira -acumulado hasta period_end- y
      // que hace con los asientos que nadie etiqueto. La pantalla necesita
      // esa misma regla para avisar sin mentir, y cuando estaba escrita
      // dos veces las dos versiones se separaron: la pantalla contaba
      // `between period_start and period_end` y decia cero mientras la
      // foto ya los habia sumado. Ahora se escribe una sola vez, en
      // public.consolidation_freeze() (0117), que ademas anota en la
      // corrida cuantos eran, por cuanto, y si de verdad entraron.
      await tx`select public.consolidation_freeze(${id}::uuid)`

      await tx`
        select public.emit_event('consolidation.run.created',
          ${JSON.stringify({ groupId, periodStart, periodEnd })}::text::jsonb, 'consolidation')`

      return id
    })
  } catch (e) {
    const msg = limpiarError(e)
    if (msg.includes('duplicate key')) {
      return { ok: false, error: 'Ese grupo ya tiene una corrida para ese mismo periodo.' }
    }
    return { ok: false, error: msg }
  }

  revalidatePath('/consolidacion')
  revalidatePath(`/consolidacion/${runId}`)
  return { ok: true }
}

/** Captura una eliminacion inter-compania sobre una corrida en borrador. */
export async function capturarEliminacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'consolidation', 'consolidation.elimination.create')
  if (!permiso.ok) return permiso

  const runId = String(fd.get('runId') ?? '')
  const fromCompanyId = String(fd.get('fromCompanyId') ?? '')
  const toCompanyId = String(fd.get('toCompanyId') ?? '')
  const debitAccountId = String(fd.get('debitAccountId') ?? '')
  const creditAccountId = String(fd.get('creditAccountId') ?? '')
  const amount = num(String(fd.get('amount') ?? ''))
  const kind = String(fd.get('kind') ?? 'other')
  const description = String(fd.get('description') ?? '').trim()
  const memberIds = fd.getAll('memberId').map((v) => String(v))

  if (!runId) return { ok: false, error: 'No se dijo sobre que corrida.' }
  if (description.length < 3) return { ok: false, error: 'Describe que se esta eliminando.' }

  // Avisa antes de enviar. Los checks de la tabla y los triggers de la
  // 0117 son los que de verdad protegen el dato.
  const revision = validateElimination({
    fromCompanyId,
    toCompanyId,
    debitAccountId,
    creditAccountId,
    amount: amount ?? 0,
    memberIds,
  })
  if (!revision.ok) return revision

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.consolidation_eliminations
          (tenant_id, run_id, from_company_id, to_company_id,
           debit_account_id, credit_account_id, amount, kind, description, created_by)
        values (${ctx.tenantId}, ${runId}, ${fromCompanyId}, ${toCompanyId},
                ${debitAccountId}, ${creditAccountId}, ${amount}, ${kind}, ${description},
                ${ctx.userId})`
    })
  } catch (e) {
    return { ok: false, error: limpiarError(e) }
  }

  revalidatePath(`/consolidacion/${runId}`)
  return { ok: true }
}

/** Borra una eliminacion mal capturada. La base la bloquea si la corrida ya cerro. */
export async function quitarEliminacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'consolidation', 'consolidation.elimination.create')
  if (!permiso.ok) return permiso

  const runId = String(fd.get('runId') ?? '')
  const eliminationId = String(fd.get('eliminationId') ?? '')
  if (!eliminationId) return { ok: false, error: 'No se dijo cual eliminacion quitar.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        delete from public.consolidation_eliminations
        where id = ${eliminationId} and tenant_id = ${ctx.tenantId}`,
    )
  } catch (e) {
    return { ok: false, error: limpiarError(e) }
  }

  revalidatePath(`/consolidacion/${runId}`)
  return { ok: true }
}

/**
 * Cierra la corrida. A partir de aqui no se edita ni se borra -ni la
 * corrida, ni su foto, ni sus eliminaciones-: lo garantizan los triggers
 * de la 0117, no esta funcion.
 */
export async function cerrarCorrida(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'consolidation', 'consolidation.run.close')
  if (!permiso.ok) return permiso

  const runId = String(fd.get('runId') ?? '')
  if (!runId) return { ok: false, error: 'No se dijo que corrida cerrar.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const filas = await tx<{ id: string }[]>`
        update public.consolidation_runs
        set status = 'closed', closed_at = now()
        where id = ${runId} and tenant_id = ${ctx.tenantId} and status = 'draft'
        returning id`
      if (filas.length === 0) {
        throw new Error('Esa corrida ya estaba cerrada.')
      }
      await tx`
        select public.emit_event('consolidation.run.closed',
          ${JSON.stringify({ runId })}::text::jsonb, 'consolidation')`
    })
  } catch (e) {
    return { ok: false, error: limpiarError(e) }
  }

  revalidatePath('/consolidacion')
  revalidatePath(`/consolidacion/${runId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearGrupoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearGrupo(fd), 'crearGrupo')
}
export async function agregarEmpresaForm(fd: FormData): Promise<void> {
  await anotarAviso(await agregarEmpresa(fd), 'agregarEmpresa')
}
export async function quitarEmpresaForm(fd: FormData): Promise<void> {
  await anotarAviso(await quitarEmpresa(fd), 'quitarEmpresa')
}
export async function generarCorridaForm(fd: FormData): Promise<void> {
  await anotarAviso(await generarCorrida(fd), 'generarCorrida')
}
export async function capturarEliminacionForm(fd: FormData): Promise<void> {
  await anotarAviso(await capturarEliminacion(fd), 'capturarEliminacion')
}
export async function quitarEliminacionForm(fd: FormData): Promise<void> {
  await anotarAviso(await quitarEliminacion(fd), 'quitarEliminacion')
}
export async function cerrarCorridaForm(fd: FormData): Promise<void> {
  await anotarAviso(await cerrarCorrida(fd), 'cerrarCorrida', 'Listo, la corrida quedo cerrada.')
}
