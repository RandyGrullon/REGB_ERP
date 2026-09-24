'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Facturacion electronica (modulo 25).
 *
 * Lo que hay hoy es la CONFIGURACION: el ambiente, el token de las URL
 * publicas y el interruptor de contingencia. Emitir todavia no: eso
 * necesita el certificado digital y la firma XAdES.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const AMBIENTES = ['testecf', 'certecf', 'ecf']
const CONTINGENCIAS = ['sin-conexion', 'sin-sistema']

/** Crea la configuracion si no existe. El token se genera en la base. */
async function asegurarConfig(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'e-invoice', 'e-invoice.manage')
  if (!permiso.ok) return permiso

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.ecf_config (tenant_id) values (${ctx.tenantId})
    on conflict (tenant_id) do nothing`,
  )

  revalidatePath('/facturacion-electronica')
  return { ok: true }
}

async function cambiarAmbiente(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'e-invoice', 'e-invoice.manage')
  if (!permiso.ok) return permiso

  const ambiente = String(fd.get('ambiente') ?? '')
  if (!AMBIENTES.includes(ambiente)) return { ok: false, error: 'Ese ambiente no existe.' }

  // Pasar a produccion sin estar certificado emite comprobantes que la
  // DGII va a rechazar uno por uno, quemando secuencias autorizadas.
  const bloqueo = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [c] = await tx<{ certificado: boolean }[]>`
      select certificado from public.ecf_config where tenant_id = ${ctx.tenantId}`
    if (!c) return 'Todavia no has configurado la facturacion electronica.'
    if (ambiente === 'ecf' && !c.certificado) {
      return 'No puedes pasar a produccion sin estar certificado por la DGII: cada comprobante seria rechazado y quemaria una secuencia.'
    }
    await tx`
      update public.ecf_config set ambiente = ${ambiente}, updated_at = now()
      where tenant_id = ${ctx.tenantId}`
    return null
  })

  revalidatePath('/facturacion-electronica')
  return bloqueo === null ? { ok: true } : { ok: false, error: bloqueo }
}

/**
 * Enciende o apaga la contingencia.
 *
 * Las dos del Art. 40 del Decreto 587-24 no son la misma cosa: sin
 * conexion se siguen emitiendo e-CF y se remiten en 72 horas; sin
 * sistema se vuelve al papel de la serie B por 15 dias como maximo, y
 * hay que avisarle a la DGII por la Oficina Virtual -eso lo hace una
 * persona, el sistema no puede hacerlo por ella-.
 */
async function cambiarContingencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'e-invoice', 'e-invoice.manage')
  if (!permiso.ok) return permiso

  const modo = String(fd.get('contingencia') ?? '')
  const apagar = modo === ''
  if (!apagar && !CONTINGENCIAS.includes(modo)) {
    return { ok: false, error: 'Esa contingencia no existe.' }
  }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    update public.ecf_config
    set contingencia = ${apagar ? null : modo},
        contingencia_desde = ${apagar ? null : new Date().toISOString()},
        updated_at = now()
    where tenant_id = ${ctx.tenantId}`,
  )

  revalidatePath('/facturacion-electronica')
  return { ok: true }
}

/**
 * Rota el token de las URL publicas.
 *
 * Existe porque el token es una credencial y las credenciales se
 * cambian. El precio esta a la vista y la pantalla lo dice: despues de
 * rotar hay que volver a declarar las tres URL en la DGII, y hasta que
 * eso pase la DGII le pega a una ruta que ya no responde.
 */
async function rotarToken(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'e-invoice', 'e-invoice.manage')
  if (!permiso.ok) return permiso

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    update public.ecf_config
    set endpoint_token = replace(gen_random_uuid()::text, '-', ''), updated_at = now()
    where tenant_id = ${ctx.tenantId}`,
  )

  revalidatePath('/facturacion-electronica')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function asegurarConfigForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await asegurarConfig(fd),
    'asegurarConfig',
    'Listo, ya puedes declarar tus URL.',
  )
}
export async function cambiarAmbienteForm(fd: FormData): Promise<void> {
  await anotarAviso(await cambiarAmbiente(fd), 'cambiarAmbiente', 'Listo, cambiamos el ambiente.')
}
export async function cambiarContingenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await cambiarContingencia(fd),
    'cambiarContingencia',
    'Listo, actualizamos la contingencia.',
  )
}
export async function rotarTokenForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await rotarToken(fd),
    'rotarToken',
    'Listo, token nuevo. Acuerdate de volver a declarar las tres URL en la DGII.',
  )
}
