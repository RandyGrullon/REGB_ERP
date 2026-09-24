'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { despachar } from '@/lib/despachador'
import { authConfigured, currentSession } from '@/lib/supabase'
import { requireProvider } from '@/lib/provider-guard'
import { anotarAviso } from '@/lib/aviso'

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
  await anotarAviso(
    { ok: true },
    'marcarContactada',
    'Listo, la marcamos como llamada. No se activó nada.',
  )
}

/**
 * Activa de verdad los modulos pedidos.
 *
 * Dos maneras, y las elige quien atiende despues de la llamada:
 *
 *  - `modo=prueba` (la de siempre): entran como `trial` con 14 dias. El
 *    cliente pidio probar, y cobrarle desde el minuto uno de una llamada
 *    comercial es como se pierde la confianza que costo conseguir.
 *  - `modo=pago`: el cliente ya dijo que si. Entran `active` y la
 *    instalacion queda pendiente para la proxima factura (0128). Antes no
 *    existia: una venta cerrada solo podia encenderse en prueba, y al
 *    vencer los 14 dias el modulo se apagaba sin que nadie pudiera
 *    cobrarlo sin tocar SQL.
 *
 * Idempotente: si un modulo ya estaba activo no se toca, y volver a pulsar
 * no lo reinicia.
 */
export async function activarSolicitud(fd: FormData): Promise<void> {
  await requireProvider()
  const id = String(fd.get('id') ?? '')
  const modo = String(fd.get('modo') ?? 'prueba') === 'pago' ? 'pago' : 'prueba'
  if (!id) return

  const sql = db()
  const [sol] = await sql<{ tenant_id: string; slug: string; modules: string[] }[]>`
    select r.tenant_id, t.slug, r.modules
    from regb.activation_requests r
    join regb.tenants t on t.id = r.tenant_id
    where r.id = ${id} and r.status = 'pending'`
  if (!sol) {
    await anotarAviso(
      { ok: false, error: 'Esa solicitud ya estaba atendida. Recarga la pantalla.' },
      'activarSolicitud',
    )
    return
  }

  for (const moduleId of sol.modules) {
    if (modo === 'pago') {
      // `active` dispara el cargo de instalacion pendiente (0128): la
      // proxima factura lo cobra una sola vez.
      await sql`
        insert into regb.tenant_modules
          (tenant_id, module_id, status, enabled, trial_ends_at, activated_at)
        values (${sol.tenant_id}, ${moduleId}, 'active', true, null, now())
        on conflict (tenant_id, module_id) do update
          set enabled = true, status = 'active', trial_ends_at = null`
    } else {
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
  }

  await sql`
    update regb.activation_requests
    set status = 'activated', resolved_at = now(), resolved_by = ${await quienAtiende()}
    where id = ${id}`

  // El cliente lee NOMBRES, no identificadores internos ("ar, sales-orders").
  const nombres = await nombresDeModulos(sol.modules)
  const n = sol.modules.length
  const lista = nombres.join(', ')
  await sql`
    insert into public.notifications (tenant_id, module_id, title, body, link)
    values (${sol.tenant_id}, 'marketplace',
            'Ya tienes lo que pediste',
            ${
              modo === 'pago'
                ? `Activamos ${n === 1 ? 'el módulo' : `${n} módulos`}: ${lista}. Ya lo puedes usar; la instalación y la mensualidad entran en tu próxima factura.`
                : `Activamos ${n === 1 ? '1 módulo' : `${n} módulos`} en prueba por 14 días: ${lista}. La prueba no se cobra. Al terminar deja de verse, pero tus datos se quedan.`
            },
            '/marketplace')`

  revalidatePath('/control')
  revalidatePath(`/control/${sol.slug}`)
  await anotarAviso(
    { ok: true },
    'activarSolicitud',
    modo === 'pago'
      ? `Listo: ${lista} quedó de pago. La instalación entra en la próxima factura.`
      : `Listo: ${lista} quedó en prueba 14 días. Le avisamos al cliente.`,
  )
}

/** Nombres del catalogo en el mismo orden; el id solo si no esta en el catalogo. */
async function nombresDeModulos(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const filas = await db()<{ id: string; name: string }[]>`
    select id, name from regb.module_catalog where id = any(${ids})`
  const porId = new Map(filas.map((f) => [f.id, f.name]))
  return ids.map((id) => porId.get(id) ?? id)
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
  await anotarAviso({ ok: true }, 'descartarSolicitud', 'Listo, descartamos la solicitud.')
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

/**
 * Cierra la sesion de impersonacion del proveedor que opera.
 *
 * El enlace "Terminar" del banner solo llevaba de vuelta a /control: la
 * fila de `regb.impersonation_log` seguia abierta y Salud la listaba como
 * "alguien operando dentro de un cliente" para siempre. `end_impersonation`
 * cierra todas las del usuario (solo puede haber una, 0015).
 */
export async function terminarImpersonacion(): Promise<void> {
  await requireProvider()
  await db()`select regb.end_impersonation(${await quienAtiende()})`
  revalidatePath('/control', 'layout')
  await anotarAviso(
    { ok: true },
    'terminarImpersonacion',
    'Listo, cerramos la sesión dentro del cliente.',
  )
}
