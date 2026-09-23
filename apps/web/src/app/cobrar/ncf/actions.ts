'use server'

import { revalidatePath } from 'next/cache'
import { fechaFiscal } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { PUERTAS_NCF, exigirAlguna } from '@/lib/fiscal'
import { actionCtx, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Alta y ajuste de secuencias NCF autorizadas por la DGII (F6 · base fiscal).
 *
 * Registrar la autorizacion es lo primero que hace un cliente nuevo: sin
 * secuencia no puede emitir una sola factura valida.
 *
 * Se llega por `ar` (Por cobrar › Comprobantes) o por `pos` (Caja ›
 * Comprobantes): un colmado que solo vende en mostrador tambien emite
 * NCF. Ver PUERTAS_NCF en lib/fiscal.ts.
 *
 * Desde la 0129 una secuencia nueva NO archiva la anterior: conviven y se
 * consumen en orden. Lo que la base rechaza -un rango que pisa a otro, un
 * numero ya emitido- vuelve como mensaje, no como pantalla rota.
 */

const TIPOS = ['B01', 'B02', 'B04', 'B14', 'B15', 'B16', 'E31', 'E32', 'E33', 'E34']

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

/** El mensaje de la base, sin el prefijo tecnico. */
const limpioError = (e: unknown): string =>
  (e instanceof Error ? e.message : 'Error inesperado').replace(/^.*ERROR:\s*/, '')

function revalidar(): void {
  for (const p of ['/cobrar/ncf', '/pos/comprobantes', '/pos']) revalidatePath(p)
}

export async function registrarSecuencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigirAlguna(ctx, PUERTAS_NCF)
  if (!permiso.ok) return permiso

  const tipo = String(fd.get('ncfType') ?? '')
  const desde = Number(String(fd.get('rangeFrom') ?? '').replace(/\D/g, ''))
  const hasta = Number(String(fd.get('rangeTo') ?? '').replace(/\D/g, ''))
  const vence = String(fd.get('expiresOn') ?? '')
  const ref = String(fd.get('authRef') ?? '').trim() || null

  if (!TIPOS.includes(tipo)) return { ok: false, error: 'Tipo de comprobante no valido.' }
  if (!desde || !hasta || hasta < desde) {
    return { ok: false, error: 'El rango debe ir de menor a mayor.' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vence)) {
    return { ok: false, error: 'Indica la fecha de vencimiento de la autorizacion.' }
  }
  // Se compara el DIA en RD: la autorizacion vale hasta el final de su
  // ultimo dia, no hasta el mediodia del servidor.
  if (vence < fechaFiscal(new Date())) {
    return { ok: false, error: 'Esa autorizacion ya vencio: no se puede emitir con ella.' }
  }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        insert into public.ncf_sequences
          (tenant_id, ncf_type, range_from, range_to, next_number, expires_on, authorization_ref)
        values (${ctx.tenantId}, ${tipo}, ${desde}, ${hasta}, ${desde}, ${vence}, ${ref})`,
    )
  } catch (e) {
    return { ok: false, error: limpioError(e) }
  }

  revalidar()
  return { ok: true }
}

/**
 * Corrige el vencimiento o da de baja una secuencia, con motivo.
 *
 * No toca rangos ni el proximo numero -lo emitido, emitido esta-. El
 * motivo queda en la secuencia y el antes y el despues en la bitacora.
 * La funcion de la base vuelve a comprobar tenant y permiso: no confia en
 * que la accion lo hizo.
 */
export async function ajustarSecuencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigirAlguna(ctx, PUERTAS_NCF)
  if (!permiso.ok) return permiso

  const id = String(fd.get('id') ?? '')
  const accion = String(fd.get('accion') ?? '')
  const motivo = String(fd.get('reason') ?? '').trim()
  const vence = String(fd.get('expiresOn') ?? '')

  if (!id) return { ok: false, error: 'Falta la secuencia.' }
  if (accion !== 'vencimiento' && accion !== 'baja') {
    return { ok: false, error: 'Elige que quieres cambiar.' }
  }
  if (motivo.length < 4) {
    return { ok: false, error: 'Escribe el motivo del cambio: queda en la bitacora.' }
  }
  if (accion === 'vencimiento' && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) {
    return { ok: false, error: 'Indica la fecha de vencimiento correcta.' }
  }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        select public.ajustar_secuencia_ncf(
          ${id},
          ${accion === 'vencimiento' ? vence : null}::date,
          ${accion === 'baja' ? false : null}::boolean,
          ${motivo})`,
    )
  } catch (e) {
    return { ok: false, error: limpioError(e) }
  }

  revalidar()
  return { ok: true }
}

export async function registrarSecuenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarSecuencia(fd), 'registrarSecuencia')
}
export async function ajustarSecuenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(await ajustarSecuencia(fd), 'ajustarSecuencia')
}
