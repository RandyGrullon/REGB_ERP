'use server'

import { revalidatePath } from 'next/cache'
import { TOURS } from '@regb/core'
import { asUser } from '@/lib/db'
import { actionCtx, exigir } from '@/lib/module-page'

/** Progreso del tutorial (S13). Se puede completar, saltar y retomar. */

function demoDe(formData: FormData) {
  return {
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  }
}

async function guardar(
  formData: FormData,
  cambio: (actual: number, total: number) => { step: number; completed: boolean; skipped: boolean },
): Promise<void> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return
  if (!exigir(ctx, 'tour', 'tour.edit').ok) return

  const tourId = String(formData.get('tourId') ?? '')
  const tour = TOURS.find((t) => t.id === tourId)
  if (!tour) return

  const actual = Number(formData.get('step') ?? 0)
  const { step, completed, skipped } = cambio(actual, tour.steps.length)
  const xp = completed ? tour.xp : 0

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      insert into public.tour_progress
        (tenant_id, user_id, tour_id, step, completed, skipped, xp_awarded)
      values (${ctx.tenantId}, ${ctx.userId}, ${tourId}, ${step},
              ${completed}, ${skipped}, ${xp})
      on conflict (tenant_id, user_id, tour_id) do update
      set step = excluded.step,
          completed = excluded.completed,
          skipped = excluded.skipped,
          -- El XP se otorga una sola vez, por si retoma y vuelve a terminar.
          xp_awarded = greatest(public.tour_progress.xp_awarded, excluded.xp_awarded),
          updated_at = now()`
  })

  revalidatePath('/tutorial')
}

export async function avanzarPaso(formData: FormData): Promise<void> {
  await guardar(formData, (actual, total) => {
    const siguiente = actual + 1
    return { step: Math.min(siguiente, total), completed: siguiente >= total, skipped: false }
  })
}

export async function retrocederPaso(formData: FormData): Promise<void> {
  await guardar(formData, (actual) => ({
    step: Math.max(actual - 1, 0),
    completed: false,
    skipped: false,
  }))
}

export async function saltarTour(formData: FormData): Promise<void> {
  await guardar(formData, (actual) => ({ step: actual, completed: false, skipped: true }))
}

export async function retomarTour(formData: FormData): Promise<void> {
  await guardar(formData, (actual) => ({ step: actual, completed: false, skipped: false }))
}

export async function reiniciarTour(formData: FormData): Promise<void> {
  await guardar(formData, () => ({ step: 0, completed: false, skipped: false }))
}
