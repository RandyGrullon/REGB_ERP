import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { moverEtapa, moverEtapaTablero } from './actions'

/**
 * Mover un cliente de etapa en el tablero de onboarding, DE VERDAD.
 *
 * El tablero arrastra tarjetas a cualquier columna (moverEtapaTablero, que
 * devuelve el resultado para revertir el movimiento optimista) y conserva
 * las flechas de antes (moverEtapa, con el aviso por cookie). Las dos van
 * por la misma puerta: como proveedor, bajo la RLS `provider_only` de
 * regb.onboarding.
 */

let c: ClientePrueba

async function etapa() {
  const [o] = await db()<{ stage: string; go_live_at: string | null }[]>`
    select o.stage, t.go_live_at::text
    from regb.onboarding o join regb.tenants t on t.id = o.tenant_id
    where o.tenant_id = ${c.tenantId}`
  return o!
}

function fd(campos: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return f
}

beforeAll(async () => {
  // Crear el tenant ya abre su fila de onboarding en 'sold' (trigger de 0011).
  c = await sembrarCliente({
    prefijo: 'accion-onb',
    nombre: 'Tablero Onboarding SRL',
    modulos: ['products'],
    roles: { Owner: { '*': true } },
  })
})

afterAll(async () => {
  await c.limpiar()
  await cerrarBase()
})

describe('arrastrar una tarjeta a cualquier columna', () => {
  it('salta de Vendido a Configuracion de una vez', async () => {
    expect((await etapa()).stage).toBe('sold')
    expect(await moverEtapaTablero(fd({ tenantId: c.tenantId, stage: 'config' }))).toEqual({
      ok: true,
      stage: 'config',
    })
    expect((await etapa()).stage).toBe('config')
  })

  it('llegar a En vivo fija el go-live; volver atras no lo borra', async () => {
    await moverEtapaTablero(fd({ tenantId: c.tenantId, stage: 'live' }))
    const vivo = await etapa()
    expect(vivo.stage).toBe('live')
    expect(vivo.go_live_at).not.toBeNull()

    await moverEtapaTablero(fd({ tenantId: c.tenantId, stage: 'training' }))
    const atras = await etapa()
    expect(atras.stage).toBe('training')
    expect(atras.go_live_at).toBe(vivo.go_live_at)
  })

  it('una etapa que no existe se niega y no toca nada', async () => {
    expect(await moverEtapaTablero(fd({ tenantId: c.tenantId, stage: 'teletransporte' }))).toEqual({
      ok: false,
      error: 'Esa etapa no existe.',
    })
    expect((await etapa()).stage).toBe('training')
  })

  it('un cliente que no existe se niega sin error de servidor', async () => {
    expect(
      await moverEtapaTablero(
        fd({ tenantId: '00000000-0000-0000-0000-000000000000', stage: 'config' }),
      ),
    ).toEqual({ ok: false, error: 'Ese cliente no tiene onboarding abierto.' })
    expect(await moverEtapaTablero(fd({ tenantId: 'no-es-uuid', stage: 'config' }))).toEqual({
      ok: false,
      error: 'Falta el cliente o la etapa.',
    })
  })
})

describe('las flechas de siempre', () => {
  it('siguiente y anterior siguen moviendo de a una, con su aviso', async () => {
    await moverEtapa(fd({ tenantId: c.tenantId, direction: 'next' }))
    expect((await etapa()).stage).toBe('live')
    const g = tarro.get(COOKIE_AVISO)
    tarro.delete(COOKIE_AVISO)
    expect(JSON.parse(g!.value)).toEqual({ tipo: 'ok', texto: 'Listo, movimos la etapa.' })

    await moverEtapa(fd({ tenantId: c.tenantId, direction: 'next' }))
    const g2 = tarro.get(COOKIE_AVISO)
    tarro.delete(COOKIE_AVISO)
    expect(JSON.parse(g2!.value)).toEqual({ tipo: 'error', texto: 'Ya esta en la ultima etapa.' })
  })
})

describe('solo el proveedor mueve', () => {
  it('en la base, un token sin is_provider no mueve nada (RLS provider_only)', async () => {
    const claims = JSON.stringify({
      sub: crypto.randomUUID(),
      app_metadata: { tenant_id: c.tenantId },
    })
    const filas = await db().begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`
      await tx.unsafe('set local role authenticated')
      return tx`update regb.onboarding set stage = 'sold' where tenant_id = ${c.tenantId} returning 1`
    })
    expect(filas).toHaveLength(0)
    expect((await etapa()).stage).toBe('live')
  })
})
