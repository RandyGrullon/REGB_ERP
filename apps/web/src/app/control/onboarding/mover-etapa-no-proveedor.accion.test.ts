import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'

/**
 * Con Supabase configurado, alguien que NO es del proveedor no puede mover
 * clientes en el tablero ni darlos de alta: requireProvider() responde
 * 404 (no 403, para no revelar que el panel existe) antes de tocar la base.
 *
 * Se simula la sesion: un usuario real de un cliente, sin is_provider.
 */
vi.mock('@/lib/supabase', () => ({
  authConfigured: true,
  currentSession: async () => ({
    userId: '00000000-0000-0000-0000-0000000000aa',
    tenantId: null,
    isProvider: false,
  }),
  supabaseServer: async () => {
    throw new Error('no se usa')
  },
}))

const { darDeAltaCliente, moverEtapa, moverEtapaTablero } = await import('./actions')

let c: ClientePrueba

async function etapa() {
  const [o] = await db()<{ stage: string }[]>`
    select stage from regb.onboarding where tenant_id = ${c.tenantId}`
  return o!.stage
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-onbx',
    modulos: ['products'],
    roles: { Owner: { '*': true } },
  })
})

afterAll(async () => {
  await c.limpiar()
  await cerrarBase()
})

describe('un no-proveedor', () => {
  it('no mueve arrastrando: 404 y la etapa sigue igual', async () => {
    const f = new FormData()
    f.set('tenantId', c.tenantId)
    f.set('stage', 'live')
    await expect(moverEtapaTablero(f)).rejects.toThrow('notFound()')
    expect(await etapa()).toBe('sold')
  })

  it('no mueve con las flechas', async () => {
    const f = new FormData()
    f.set('tenantId', c.tenantId)
    f.set('direction', 'next')
    await expect(moverEtapa(f)).rejects.toThrow('notFound()')
    expect(await etapa()).toBe('sold')
  })

  it('no da de alta clientes', async () => {
    await expect(darDeAltaCliente(null, new FormData())).rejects.toThrow('notFound()')
  })
})
