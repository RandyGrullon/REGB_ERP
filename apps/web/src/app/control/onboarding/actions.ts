'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/provider-guard'
import { anotarAviso } from '@/lib/aviso'

const STAGES = ['sold', 'migration', 'config', 'training', 'live'] as const

export async function moverEtapa(formData: FormData): Promise<void> {
  await requireProvider()

  const tenantId = String(formData.get('tenantId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!tenantId || (direction !== 'next' && direction !== 'prev')) {
    await anotarAviso({ ok: false, error: 'Falta el cliente o la direccion.' }, 'moverEtapa')
    return
  }

  const sql = db()
  const [row] = await sql<{ stage: string }[]>`
    select stage from regb.onboarding where tenant_id = ${tenantId}`
  if (!row) {
    await anotarAviso({ ok: false, error: 'Ese cliente no tiene onboarding abierto.' }, 'moverEtapa')
    return
  }

  const idx = STAGES.indexOf(row.stage as (typeof STAGES)[number])
  const target = direction === 'next' ? STAGES[idx + 1] : STAGES[idx - 1]
  // Ya esta en el extremo: no es un fallo del sistema, pero el usuario
  // hizo clic y merece saber por que no se movio nada.
  if (!target) {
    await anotarAviso(
      { ok: false, error: direction === 'next' ? 'Ya esta en la ultima etapa.' : 'Ya esta en la primera etapa.' },
      'moverEtapa',
    )
    return
  }

  await sql`
    update regb.onboarding
    set stage = ${target}, updated_at = now()
    where tenant_id = ${tenantId}`

  // Llegar a 'live' marca el go-live real del cliente.
  if (target === 'live') {
    await sql`
      update regb.tenants set go_live_at = coalesce(go_live_at, now())
      where id = ${tenantId}`
  }

  revalidatePath('/control/onboarding')
  await anotarAviso({ ok: true }, 'moverEtapa', 'Listo, movimos la etapa.')
}
