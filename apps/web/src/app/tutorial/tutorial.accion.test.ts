import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TOURS } from '@regb/core'
import { db } from '@/lib/db'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { avanzarPaso, reiniciarTour } from './actions'

/**
 * El tutorial emite `tour.tour.completed` al TERMINAR una guia, y nada
 * por cada paso.
 *
 * - `tour.finished` estaba declarado con dos segmentos. emit_event()
 *   lo habria rechazado y, con el, el guardado del progreso: terminar un
 *   tutorial habria dejado de funcionar el dia que alguien lo emitiera.
 * - `tour.step.completed` se quito del manifiesto: "Siguiente" no
 *   comprueba que el paso se hizo, asi que el evento afirmaria algo que
 *   el sistema no sabe, y sumaria una fila al outbox por cada clic.
 */

const TOUR = TOURS.find((t) => t.id === 'core.bienvenida')!
let c: ClientePrueba

async function eventos(tipo: string) {
  return db()<{ payload: Record<string, unknown>; emitted_by: string }[]>`
    select payload, emitted_by from public.event_outbox
    where tenant_id = ${c.tenantId} and type = ${tipo}
    order by id`
}

function sinError(): void {
  const g = tarro.get(COOKIE_AVISO)
  const a = g ? (JSON.parse(g.value) as { tipo: string; texto: string }) : null
  expect(a?.tipo === 'error' ? a.texto : null).toBeNull()
}

/** Recorre la guia desde el paso 0 hasta el final, como lo haria el boton. */
async function recorrer(): Promise<void> {
  for (let paso = 0; paso < TOUR.steps.length; paso++) {
    await avanzarPaso(c.fd({ tourId: TOUR.id, step: String(paso) }))
    sinError()
  }
}

beforeAll(async () => {
  expect(TOUR).toBeDefined()
  c = await sembrarCliente({
    prefijo: 'accion-tour',
    nombre: 'Eventos Tutorial SRL',
    modulos: ['tour'],
    roles: { Aprendiz: { 'tour.view': true, 'tour.edit': true } },
  })
})

afterAll(async () => {
  await c.limpiar(['public.tour_progress'])
  await cerrarBase()
})

describe('el tutorial emite tour.tour.completed', () => {
  it('avanzar pasos no emite nada hasta terminar, y terminar emite una vez', async () => {
    for (let paso = 0; paso < TOUR.steps.length - 1; paso++) {
      await avanzarPaso(c.fd({ tourId: TOUR.id, step: String(paso) }))
      sinError()
    }
    const [n] = await db()<{ c: string }[]>`
      select count(*)::text as c from public.event_outbox where tenant_id = ${c.tenantId}`
    expect(n!.c).toBe('0')

    await avanzarPaso(c.fd({ tourId: TOUR.id, step: String(TOUR.steps.length - 1) }))
    sinError()

    const [prog] = await db()<{ user_id: string; completed: boolean }[]>`
      select user_id, completed from public.tour_progress
      where tenant_id = ${c.tenantId} and tour_id = ${TOUR.id}`
    expect(prog!.completed).toBe(true)

    const ev = await eventos('tour.tour.completed')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.emitted_by).toBe('tour')
    expect(ev[0]!.payload).toEqual({ tourId: TOUR.id, userId: prog!.user_id })
  })

  it('pulsar "Siguiente" otra vez sobre una guia terminada no la termina dos veces', async () => {
    await avanzarPaso(c.fd({ tourId: TOUR.id, step: String(TOUR.steps.length) }))
    sinError()
    expect(await eventos('tour.tour.completed')).toHaveLength(1)
  })

  it('repasarla y terminarla de nuevo SI es otra vez terminada', async () => {
    await reiniciarTour(c.fd({ tourId: TOUR.id, step: String(TOUR.steps.length) }))
    sinError()
    await recorrer()
    expect(await eventos('tour.tour.completed')).toHaveLength(2)
  })

  it('ningun paso emite tour.step.completed', async () => {
    expect(await eventos('tour.step.completed')).toHaveLength(0)
  })
})
