'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult } from '@/lib/module-page'

/** Accion del modulo `settings` (S9): lo que el cliente decide solo. */

const TIMEZONES = new Set([
  'America/Santo_Domingo',
  'America/New_York',
  'America/Mexico_City',
  'America/Bogota',
  'Europe/Madrid',
])
const CURRENCIES = new Set(['DOP', 'USD', 'EUR'])
const DATE_FORMATS = new Set(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'])

interface Prefs {
  tradeName: string | null
  timezone: string
  currency: string
  dateFormat: string
}
/** En el orden en que salen en `changed` del evento. */
const CAMPOS = ['tradeName', 'timezone', 'currency', 'dateFormat'] as const
/** Los defaults de `tenant_settings` (0016), los mismos que ensena la pantalla sin fila. */
const POR_DEFECTO: Prefs = {
  tradeName: null,
  timezone: 'America/Santo_Domingo',
  currency: 'DOP',
  dateFormat: 'DD/MM/YYYY',
}

export async function guardarConfiguracion(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx({
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  })
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'settings', 'settings.edit')
  if (!permiso.ok) return permiso

  const tradeName = String(formData.get('tradeName') ?? '').trim() || null
  const timezone = String(formData.get('timezone') ?? 'America/Santo_Domingo')
  const currency = String(formData.get('currency') ?? 'DOP')
  const dateFormat = String(formData.get('dateFormat') ?? 'DD/MM/YYYY')

  if (!TIMEZONES.has(timezone)) return { ok: false, error: 'Zona horaria no soportada.' }
  if (!CURRENCIES.has(currency)) return { ok: false, error: 'Moneda no soportada.' }
  if (!DATE_FORMATS.has(dateFormat)) return { ok: false, error: 'Formato de fecha no valido.' }

  const nuevo: Prefs = { tradeName, timezone, currency, dateFormat }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      // Lo que habia, bloqueado hasta el commit: sin esto, dos guardados a
      // la vez calcularian "que cambio" contra la misma foto vieja.
      const [fila] = await tx<
        { trade_name: string | null; timezone: string; currency: string; date_format: string }[]
      >`
        select trade_name, timezone, currency, date_format
        from public.tenant_settings where tenant_id = ${ctx.tenantId}
        for update`

      await tx`
        insert into public.tenant_settings (tenant_id, trade_name, timezone, currency, date_format)
        values (${ctx.tenantId}, ${tradeName}, ${timezone}, ${currency}, ${dateFormat})
        on conflict (tenant_id) do update
        set trade_name = excluded.trade_name,
            timezone = excluded.timezone,
            currency = excluded.currency,
            date_format = excluded.date_format,
            updated_at = now()`

      // Sin fila todavia, la pantalla ensenaba los valores por defecto:
      // guardarlos tal cual no es un cambio.
      const antes: Prefs = fila
        ? {
            tradeName: fila.trade_name,
            timezone: fila.timezone,
            currency: fila.currency,
            dateFormat: fila.date_format,
          }
        : POR_DEFECTO
      const cambios = CAMPOS.filter((k) => antes[k] !== nuevo[k])
      if (cambios.length === 0) return

      // Que cambio y a que valor. Guardar sin tocar nada no emite: un
      // webhook que sincroniza la moneda no debe recibir avisos falsos.
      const payload: Record<string, unknown> = { changed: cambios }
      for (const k of cambios) payload[k] = nuevo[k]
      await tx`
        select public.emit_event('settings.prefs.changed',
          ${JSON.stringify(payload)}::text::jsonb, 'settings')`
    })
  } catch (e) {
    return {
      ok: false,
      error: (e instanceof Error ? e.message : 'Error inesperado').replace(/^.*ERROR:\s*/, ''),
    }
  }

  revalidatePath('/configuracion')
  return { ok: true }
}

// ── Version para <form action> ──────────────────────────────────────────
export async function guardarConfiguracionForm(fd: FormData): Promise<void> {
  await anotarAviso(await guardarConfiguracion(fd), 'guardarConfiguracion')
}
