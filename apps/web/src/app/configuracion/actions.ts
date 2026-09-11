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

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      insert into public.tenant_settings (tenant_id, trade_name, timezone, currency, date_format)
      values (${ctx.tenantId}, ${tradeName}, ${timezone}, ${currency}, ${dateFormat})
      on conflict (tenant_id) do update
      set trade_name = excluded.trade_name,
          timezone = excluded.timezone,
          currency = excluded.currency,
          date_format = excluded.date_format,
          updated_at = now()`
  })

  revalidatePath('/configuracion')
  return { ok: true }
}

// ── Version para <form action> ──────────────────────────────────────────
export async function guardarConfiguracionForm(fd: FormData): Promise<void> {
  await anotarAviso(await guardarConfiguracion(fd), 'guardarConfiguracion')
}
