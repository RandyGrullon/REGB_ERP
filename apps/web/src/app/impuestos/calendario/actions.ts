'use server'

import { revalidatePath } from 'next/cache'
import { calendarioFiscal, type Formulario } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Calendario fiscal (modulo 24): anotar que un informativo ya se presento.
 *
 * El 606, el 607 y el 608 se GENERAN en /cobrar/dgii, que es de `ap` y
 * `ar`. Aqui solo se anota que ya se subieron, porque el sistema no tiene
 * forma de enterarse solo: la DGII no le avisa a nadie. Sin esta anotacion
 * el calendario tendria que adivinar, y un calendario que adivina el
 * estado es peor que no tener calendario.
 */

const INFORMATIVOS: Formulario[] = ['606', '607', '608', 'IR-17']

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const limpioError = (e: unknown): string =>
  (e instanceof Error ? e.message : 'Error inesperado').replace(/^.*ERROR:\s*/, '')

/** `Date` a `YYYY-MM-DD` por componentes locales: toISOString() se va un dia en UTC-4. */
function isoLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/**
 * Anota un informativo como presentado.
 *
 * El IT-1 NO pasa por aqui: ese se cierra en /impuestos/liquidacion, donde
 * se guarda la foto de los montos. Un informativo no lleva montos propios
 * -los suyos estan en el 606/607/608 que se descargo-, asi que esta fila
 * es solo el sello de "esto ya se entrego".
 */
export async function registrarInformativo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'taxes', 'taxes.filing.close')
  if (!permiso.ok) return permiso

  const form = String(fd.get('form') ?? '') as Formulario
  const period = String(fd.get('period') ?? '').trim()

  if (!INFORMATIVOS.includes(form)) {
    return { ok: false, error: 'El IT-1 se cierra en la pantalla de liquidacion, no aqui.' }
  }
  if (!/^[0-9]{6}$/.test(period)) return { ok: false, error: 'El periodo va como AAAAMM.' }

  const vence = calendarioFiscal(period, new Date()).find((o) => o.form === form)?.vence
  if (!vence) return { ok: false, error: 'No se pudo calcular el vencimiento de ese periodo.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        insert into public.tax_filings
          (tenant_id, form, period, due_date, status, filed_at, filed_by)
        values (${ctx.tenantId}, ${form}, ${period}, ${isoLocal(vence)}, 'filed', now(), ${ctx.userId})
        on conflict (tenant_id, form, period) do nothing`,
    )
  } catch (e) {
    return { ok: false, error: limpioError(e) }
  }

  revalidatePath('/impuestos/calendario')
  return { ok: true }
}

// ── Version para <form action> ──────────────────────────────────────────
export async function registrarInformativoForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await registrarInformativo(fd),
    'registrarInformativo',
    'Listo, lo anotamos como presentado.',
  )
}
