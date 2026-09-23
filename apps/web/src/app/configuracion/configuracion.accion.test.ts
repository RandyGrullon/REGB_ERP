import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { guardarConfiguracion } from './actions'

/**
 * guardarConfiguracion() llamada DE VERDAD: `settings.prefs.changed` sale
 * cuando algo CAMBIA, dice que cambio y a que valor.
 *
 * Guardar el formulario sin tocar nada no es un cambio: si emitiera, un
 * webhook que sincroniza la moneda recibiria un aviso falso cada vez que
 * alguien abre la pantalla y pulsa Guardar.
 */

let c: ClientePrueba

async function eventos() {
  return db()<{ payload: Record<string, unknown>; emitted_by: string }[]>`
    select payload, emitted_by from public.event_outbox
    where tenant_id = ${c.tenantId} and type = 'settings.prefs.changed'
    order by id`
}

const base = {
  tradeName: '',
  timezone: 'America/Santo_Domingo',
  currency: 'DOP',
  dateFormat: 'DD/MM/YYYY',
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-conf',
    nombre: 'Eventos Configuracion SRL',
    modulos: ['settings'],
    roles: { Administrador: { 'settings.view': true, 'settings.edit': true } },
  })
})

afterAll(async () => {
  await c.limpiar(['public.tenant_settings'])
  await cerrarBase()
})

describe('guardarConfiguracion emite settings.prefs.changed', () => {
  it('guardar los valores que ya se veian no es un cambio', async () => {
    // Sin fila todavia: la pantalla ensena los valores por defecto.
    expect(await guardarConfiguracion(c.fd(base))).toEqual({ ok: true })
    expect(await eventos()).toHaveLength(0)
  })

  it('cambiar la moneda emite un evento con lo que cambio y su nuevo valor', async () => {
    expect(await guardarConfiguracion(c.fd({ ...base, currency: 'USD' }))).toEqual({ ok: true })

    const ev = await eventos()
    expect(ev).toHaveLength(1)
    expect(ev[0]!.emitted_by).toBe('settings')
    expect(ev[0]!.payload).toEqual({ changed: ['currency'], currency: 'USD' })
  })

  it('volver a guardar lo mismo no emite otro', async () => {
    expect(await guardarConfiguracion(c.fd({ ...base, currency: 'USD' }))).toEqual({ ok: true })
    expect(await eventos()).toHaveLength(1)
  })

  it('dos cambios a la vez van en un solo evento', async () => {
    expect(
      await guardarConfiguracion(
        c.fd({ ...base, currency: 'USD', timezone: 'America/New_York', dateFormat: 'YYYY-MM-DD' }),
      ),
    ).toEqual({ ok: true })
    const ev = await eventos()
    expect(ev).toHaveLength(2)
    expect(ev[1]!.payload).toEqual({
      changed: ['timezone', 'dateFormat'],
      timezone: 'America/New_York',
      dateFormat: 'YYYY-MM-DD',
    })
  })

  it('un valor rechazado no guarda ni emite', async () => {
    const r = await guardarConfiguracion(c.fd({ ...base, currency: 'XXX' }))
    expect(r.ok).toBe(false)
    expect(await eventos()).toHaveLength(2)
  })
})
