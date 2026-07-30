'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/provider-guard'

const STAGES = ['sold', 'migration', 'config', 'training', 'live'] as const

export async function moverEtapa(formData: FormData): Promise<void> {
  await requireProvider()

  const tenantId = String(formData.get('tenantId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!tenantId || (direction !== 'next' && direction !== 'prev')) return

  const sql = db()
  const [row] = await sql<{ stage: string }[]>`
    select stage from regb.onboarding where tenant_id = ${tenantId}`
  if (!row) return

  const idx = STAGES.indexOf(row.stage as (typeof STAGES)[number])
  const target = direction === 'next' ? STAGES[idx + 1] : STAGES[idx - 1]
  if (!target) return

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
}
