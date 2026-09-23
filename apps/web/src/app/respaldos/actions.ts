'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir } from '@/lib/module-page'
import { anotarAviso } from '@/lib/aviso'
import { alcanceDelRespaldo } from './alcance'

/**
 * Respaldos (S11): una copia COMPLETA de los datos del cliente, hecha bajo
 * su RLS -el respaldo no puede contener nada que el cliente no vea- y
 * acotada a los modulos que el rol ve completos (ver `alcance.ts`).
 *
 * Todo el trabajo lo hace `public.crear_respaldo()` (0122), en una sola
 * transaccion y sin pasar los datos por JavaScript:
 *
 *  - Deriva las tablas del catalogo -toda tabla de `public` con
 *    `tenant_id`-, asi que un modulo nuevo entra solo.
 *  - Las guarda por partes en `backup_parts` (un jsonb con el negocio
 *    entero de un cliente grande revienta el limite de jsonb).
 *  - Escribe el indice en `backups.payload`: que tablas trae y cuantas
 *    filas, que queda fuera y por que, que columnas no salen. Es la
 *    cabecera del JSON que se descarga.
 *  - Emite `backup.snapshot.created`.
 *
 * Antes de 0122 esta accion armaba seis tablas a mano -empresas,
 * sucursales, roles, equipo, productos, configuracion- y el aviso le
 * decia al cliente que ahi estaban sus ventas.
 */
export async function crearRespaldo(formData: FormData): Promise<void> {
  const ctx = await actionCtx({
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  })
  if (!ctx) {
    await anotarAviso({ ok: false, error: 'Sesion no valida.' }, 'crearRespaldo')
    return
  }
  const permiso = exigir(ctx, 'backup', 'backup.create')
  if (!permiso.ok) {
    await anotarAviso(permiso, 'crearRespaldo')
    return
  }

  const alcance = alcanceDelRespaldo(ctx)
  if (alcance.bloqueo) {
    await anotarAviso({ ok: false, error: alcance.bloqueo }, 'crearRespaldo')
    return
  }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`select public.crear_respaldo(${alcance.modulos}::text[], 'manual')`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error inesperado'
    await anotarAviso(
      { ok: false, error: `No pudimos crear el respaldo: ${msg.replace(/^.*ERROR:\s*/, '')}` },
      'crearRespaldo',
    )
    return
  }

  revalidatePath('/respaldos')
  // Lo que el rol deja fuera se dice YA, no solo en la pantalla: es justo
  // lo que alguien no espera que falte.
  const faltan = alcance.fuera.map((f) => f.nombre)
  await anotarAviso(
    { ok: true },
    'crearRespaldo',
    faltan.length === 0
      ? 'Listo, creamos el respaldo. Descargalo y guardalo fuera de aqui.'
      : `Listo, creamos el respaldo, pero NO trae ${faltan.join(', ')}: tu rol no lo ve completo.`,
  )
}
