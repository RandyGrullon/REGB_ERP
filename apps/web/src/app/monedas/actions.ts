'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/** Acciones de multimoneda (modulo 26, F6/S31). */

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

/** Captura la tasa de una moneda para una fecha. */
export async function ponerTasa(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'multicurrency', 'multicurrency.rate.set')
  if (!permiso.ok) return permiso

  const currencyCode = String(fd.get('currencyCode') ?? '')
    .trim()
    .toUpperCase()
  const rateDate = String(fd.get('rateDate') ?? '').trim() || new Date().toISOString().slice(0, 10)
  const rate = num(String(fd.get('rate') ?? ''))

  if (!currencyCode) return { ok: false, error: 'Elige la moneda.' }
  if (rate === null || rate <= 0) return { ok: false, error: 'La tasa debe ser mayor que cero.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.exchange_rates (tenant_id, currency_code, rate_date, rate, created_by)
        values (${ctx.tenantId}, ${currencyCode}, ${rateDate}, ${rate}, ${ctx.userId})
        on conflict (tenant_id, currency_code, rate_date)
        do update set rate = excluded.rate`

      await tx`
        select public.emit_event('multicurrency.rate.set',
          ${JSON.stringify({ currencyCode, rateDate, rate })}::text::jsonb, 'multicurrency')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/monedas')
  revalidatePath(`/monedas/${currencyCode}`)
  return { ok: true }
}

// ── Version para <form action> ──────────────────────────────────────────
export async function ponerTasaForm(fd: FormData): Promise<void> {
  await anotarAviso(await ponerTasa(fd), 'ponerTasa')
}
