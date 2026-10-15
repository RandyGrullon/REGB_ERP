import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { bootstrap } from './bootstrap'

/**
 * El nombre de la barra de arriba (grabación de la demo, 15 oct 2026).
 *
 * Salía del correo -`maria.rosario@demo.do` -> "Maria Rosario"- mientras
 * las tablas leen `user_profiles.display_name`, "María Rosario". Ahora
 * manda el perfil; el correo queda para quien todavía no tiene uno.
 */

/** El usuario del modo demostración (bootstrap.ts). */
const YO = '00000000-0000-0000-0000-000000000001'

let c: ClientePrueba

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-bootstrap',
    modulos: ['users'],
    roles: { Dueno: { '*': true } },
  })
})

afterAll(async () => {
  await c.limpiar(['public.user_profiles'])
  await cerrarBase()
})

describe('Nombre de quien entra', () => {
  it('sin perfil, sale del correo', async () => {
    const r = await bootstrap({ demo: { tenantSlug: c.slug, roleName: 'Dueno' } })
    expect(r?.user).toMatchObject({ name: 'Maria Rosario', initials: 'MR' })
  })

  it('con perfil, manda el perfil con sus tildes', async () => {
    await db()`
      insert into public.user_profiles (tenant_id, user_id, display_name, email)
      values (${c.tenantId}, ${YO}, 'María Rosario', 'maria.rosario@demo.do')`
    const r = await bootstrap({ demo: { tenantSlug: c.slug, roleName: 'Dueno' } })
    expect(r?.user).toMatchObject({ name: 'María Rosario', initials: 'MR' })
  })
})
