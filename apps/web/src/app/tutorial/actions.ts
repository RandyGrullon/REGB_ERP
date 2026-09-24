'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { TOURS } from '@regb/core'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult } from '@/lib/module-page'
import { anotarAviso } from '@/lib/aviso'

/**
 * Progreso del tutorial (S13). Se puede completar, saltar y retomar.
 *
 * Avanzar y retroceder NO avisan cuando salen bien: el tour se mueve a
 * la vista y un "guardamos tu cambio" por cada paso es ruido. Saltar y
 * reiniciar SI avisan, porque descartan progreso y eso conviene
 * confirmarlo. Los errores se dicen siempre -sin eso, un permiso
 * denegado se ve como un boton muerto-.
 */

function demoDe(formData: FormData) {
  return {
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  }
}

async function guardar(
  formData: FormData,
  cambio: (actual: number, total: number) => { step: number; completed: boolean; skipped: boolean },
): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'tour', 'tour.edit')
  if (!permiso.ok) return permiso

  const tourId = String(formData.get('tourId') ?? '')
  const tour = TOURS.find((t) => t.id === tourId)
  if (!tour) return { ok: false, error: 'Ese tutorial no existe.' }

  const actual = Number(formData.get('step') ?? 0)
  const { step, completed, skipped } = cambio(actual, tour.steps.length)
  const xp = completed ? tour.xp : 0

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      // Como estaba antes, bloqueado hasta el commit: el evento sale solo
      // en la TRANSICION a terminado. Un "Siguiente" repetido sobre una
      // guia ya terminada no la termina otra vez.
      const [antes] = await tx<{ completed: boolean }[]>`
        select completed from public.tour_progress
        where tenant_id = ${ctx.tenantId} and user_id = ${ctx.userId} and tour_id = ${tourId}
        for update`

      await tx`
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

      // Solo al terminar la guia. Por paso no se emite nada: "Siguiente"
      // no comprueba que el paso se hizo (ver tour.md).
      if (completed && !antes?.completed) {
        await tx`
          select public.emit_event('tour.tour.completed',
            ${JSON.stringify({ tourId, userId: ctx.userId })}::text::jsonb, 'tour')`
      }
    })
  } catch (e) {
    return {
      ok: false,
      error: (e instanceof Error ? e.message : 'Error inesperado').replace(/^.*ERROR:\s*/, ''),
    }
  }

  revalidatePath('/tutorial')
  return { ok: true }
}

/** Solo habla si algo fallo: el tour ya se mueve a la vista. */
async function calladoSalvoError(r: ActionResult, accion: string): Promise<void> {
  if (!r.ok) await anotarAviso(r, accion)
}

export async function avanzarPaso(formData: FormData): Promise<void> {
  const r = await guardar(formData, (actual, total) => {
    const siguiente = actual + 1
    return { step: Math.min(siguiente, total), completed: siguiente >= total, skipped: false }
  })
  await calladoSalvoError(r, 'avanzarPaso')
}

export async function retrocederPaso(formData: FormData): Promise<void> {
  const r = await guardar(formData, (actual) => ({
    step: Math.max(actual - 1, 0),
    completed: false,
    skipped: false,
  }))
  await calladoSalvoError(r, 'retrocederPaso')
}

export async function saltarTour(formData: FormData): Promise<void> {
  const r = await guardar(formData, (actual) => ({ step: actual, completed: false, skipped: true }))
  await anotarAviso(
    r,
    'saltarTour',
    'Listo, saltamos el tutorial. Puedes retomarlo cuando quieras.',
  )
}

export async function retomarTour(formData: FormData): Promise<void> {
  const r = await guardar(formData, (actual) => ({
    step: actual,
    completed: false,
    skipped: false,
  }))
  await calladoSalvoError(r, 'retomarTour')
}

export async function reiniciarTour(formData: FormData): Promise<void> {
  const r = await guardar(formData, () => ({ step: 0, completed: false, skipped: false }))
  await anotarAviso(r, 'reiniciarTour', 'Listo, el tutorial empieza de nuevo.')
}

/**
 * "Siguiente paso" y "Terminar" de la guia flotante, la que acompaña al
 * usuario por las pantallas. Antes eran enlaces y no guardaban nada: quien
 * recorria las cinco pantallas y pulsaba "Terminar el tour" volvia al
 * tutorial en "Paso 1 de 5", 0 completadas, y el paso "Haz el recorrido"
 * del inicio no se marcaba nunca. Ahora guarda y despues navega.
 */
export async function pasoDesdeGuia(formData: FormData): Promise<void> {
  const tour = TOURS.find((t) => t.id === String(formData.get('tourId') ?? ''))
  const termina = tour !== undefined && Number(formData.get('step') ?? 0) + 1 >= tour.steps.length
  const r = await guardar(formData, (actual, total) => {
    const siguiente = actual + 1
    return { step: Math.min(siguiente, total), completed: siguiente >= total, skipped: false }
  })
  if (!r.ok || !termina) await calladoSalvoError(r, 'pasoDesdeGuia')
  else await anotarAviso(r, 'pasoDesdeGuia', `Terminaste "${tour.title}". +${tour.xp} puntos.`)

  // Solo rutas de la propia app: el destino viene del formulario.
  const destino = String(formData.get('destino') ?? '')
  redirect(destino.startsWith('/') && !destino.startsWith('//') ? destino : '/tutorial')
}
