'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { despachar } from '@/lib/despachador'
import { authConfigured, currentSession } from '@/lib/supabase'
import { requireProvider } from '@/lib/provider-guard'

/**
 * Atender una solicitud de activacion (§12.3).
 *
 * Cierra el circuito que abrio el marketplace: el cliente pide, el dueno
 * lo ve, y aqui lo resuelve sin salir del panel ni tocar SQL a mano.
 *
 * Se consulta con `db()` —dueno de las tablas— porque es zona de
 * proveedor: la barrera es `requireProvider()`, no la RLS (§7).
 */

const DEMO_PROVIDER_USER = '00000000-0000-0000-0000-00000000f00d'

async function quienAtiende(): Promise<string> {
  if (!authConfigured) return DEMO_PROVIDER_USER
  const s = await currentSession()
  return s?.userId ?? DEMO_PROVIDER_USER
}

/** Ya se llamo al cliente. Deja de poder editarla y sale de la lista. */
export async function marcarContactada(fd: FormData): Promise<void> {
  await requireProvider()
  const id = String(fd.get('id') ?? '')
  if (!id) return

  await db()`
    update regb.activation_requests
    set status = 'contacted', resolved_at = now(), resolved_by = ${await quienAtiende()}
    where id = ${id} and status = 'pending'`

  revalidatePath('/control')
}

/**
 * Activa de verdad los modulos pedidos.
 *
 * Entran como `trial` con 14 dias, no como `active`: el cliente pidio
 * probar, y cobrarle la mensualidad desde el minuto uno de una llamada
 * comercial es como se pierde la confianza que costo conseguir. Si al
 * terminar la prueba lo quiere, se pasa a activo con su instalacion
 * cobrada.
 *
 * Idempotente: si un modulo ya estaba activo no se toca, y volver a pulsar
 * no lo reinicia.
 */
export async function activarSolicitud(fd: FormData): Promise<void> {
  await requireProvider()
  const id = String(fd.get('id') ?? '')
  if (!id) return

  const sql = db()
  const [sol] = await sql<{ tenant_id: string; modules: string[] }[]>`
    select tenant_id, modules from regb.activation_requests
    where id = ${id} and status = 'pending'`
  if (!sol) return

  for (const moduleId of sol.modules) {
    await sql`
      insert into regb.tenant_modules
        (tenant_id, module_id, status, enabled, trial_ends_at, activated_at)
      values (${sol.tenant_id}, ${moduleId}, 'trial', true, now() + interval '14 days', now())
      on conflict (tenant_id, module_id) do update
        set enabled = true,
            -- Un modulo que ya estaba activo no vuelve a prueba: seria
            -- degradarle el plan por atender su propia peticion.
            -- El cast es obligatorio: status es el enum
            -- regb.module_status y un case devuelve text.
            status = (case when regb.tenant_modules.status = 'active' then 'active' else 'trial' end)::regb.module_status,
            trial_ends_at = case
              when regb.tenant_modules.status = 'active' then regb.tenant_modules.trial_ends_at
              else now() + interval '14 days' end`
  }

  await sql`
    update regb.activation_requests
    set status = 'activated', resolved_at = now(), resolved_by = ${await quienAtiende()}
    where id = ${id}`

  // Que el cliente se entere sin que nadie tenga que escribirle.
  await sql`
    insert into public.notifications (tenant_id, module_id, title, body, link)
    values (${sol.tenant_id}, 'marketplace',
            'Ya tienes lo que pediste',
            ${`Activamos ${sol.modules.length} modulo${sol.modules.length === 1 ? '' : 's'} en prueba por 14 dias: ${sol.modules.join(', ')}. Al terminar dejan de verse, pero tus datos se quedan.`},
            '/marketplace')`

  revalidatePath('/control')
}

/** No procede. Se guarda con motivo: el historial comercial es el valor. */
export async function descartarSolicitud(fd: FormData): Promise<void> {
  await requireProvider()
  const id = String(fd.get('id') ?? '')
  const motivo = String(fd.get('motivo') ?? '').trim()
  if (!id) return

  await db()`
    update regb.activation_requests
    set status = 'declined', resolved_at = now(), resolved_by = ${await quienAtiende()},
        note = coalesce(note || ' · ', '') || ${motivo || 'Descartada sin motivo'}
    where id = ${id} and status = 'pending'`

  revalidatePath('/control')
}

/**
 * Dispara un lote del bus a mano.
 *
 * El cron lo hace solo cada pocos minutos, pero cuando algo se atasca
 * hace falta ver el efecto ahora y no dentro de cinco: si el error se
 * repite, sale en la lista de esta misma pantalla.
 */
export async function despacharAhora(): Promise<void> {
  await requireProvider()
  await despachar(200)
  revalidatePath('/control/salud')
}
