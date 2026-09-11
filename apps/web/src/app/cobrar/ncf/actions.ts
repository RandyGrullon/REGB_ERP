'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Alta de secuencias NCF autorizadas por la DGII (F6 · base fiscal).
 *
 * Registrar la autorizacion es lo primero que hace un cliente nuevo: sin
 * secuencia no puede emitir una sola factura valida.
 */

const TIPOS = ['B01', 'B02', 'B04', 'B14', 'B15', 'B16', 'E31', 'E32', 'E33', 'E34']

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function registrarSecuencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ar', 'ar.invoice.create')
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
  if (new Date(`${vence}T12:00:00`) < new Date()) {
    return { ok: false, error: 'Esa autorizacion ya vencio: no se puede emitir con ella.' }
  }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    // Solo una secuencia activa por tipo: con dos, nadie sabria de cual
    // sale el proximo numero. La anterior se archiva, no se borra —su
    // historial de comprobantes emitidos tiene que seguir siendo auditable.
    await tx`
      update public.ncf_sequences set is_active = false
      where tenant_id = ${ctx.tenantId} and ncf_type = ${tipo} and is_active`

    await tx`
      insert into public.ncf_sequences
        (tenant_id, ncf_type, range_from, range_to, next_number, expires_on, authorization_ref)
      values (${ctx.tenantId}, ${tipo}, ${desde}, ${hasta}, ${desde}, ${vence}, ${ref})`
    return 'ok'
  })

  if (res !== 'ok') return { ok: false, error: 'No se pudo registrar.' }

  revalidatePath('/cobrar/ncf')
  return { ok: true }
}

export async function registrarSecuenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarSecuencia(fd), 'registrarSecuencia')
}
