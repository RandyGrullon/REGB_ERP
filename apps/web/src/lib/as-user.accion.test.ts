import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'

/**
 * `asUser()` lleva el rol real de la persona (0127).
 *
 * Antes fijaba solo `sub` y `tenant_id`: sin `role_id` en los claims,
 * `rls.has_perm()` no decide y responde true, asi que ninguna politica que
 * mira el permiso aplicaba en la web. Ahora el rol sale de la membresia
 * activa de ESA persona en ESE cliente, igual que el token del hook.
 *
 * supabase/tests/escalada-rol.test.ts prueba las reglas de la base; esto
 * prueba que la web llega a ellas con el rol puesto.
 */

let c: ClientePrueba
let rolCaja: string
let rolOwner: string
const miembro = crypto.randomUUID()
const owner = crypto.randomUUID()
const forastero = crypto.randomUUID()

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-asuser',
    modulos: ['pos', 'employees'],
    roles: { Owner: { '*': true }, 'Solo Caja': { 'pos.sell': true } },
  })
  const sql = db()
  const roles = await sql<{ id: string; name: string }[]>`
    select id, name from public.roles where tenant_id = ${c.tenantId} and name in ('Owner', 'Solo Caja')`
  rolOwner = roles.find((r) => r.name === 'Owner')!.id
  rolCaja = roles.find((r) => r.name === 'Solo Caja')!.id
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id, is_active, invited_at, accepted_at)
    values (${c.tenantId}, ${owner}, ${rolOwner}, true, now(), now()),
           (${c.tenantId}, ${miembro}, ${rolCaja}, true, now(), now())`
})

afterAll(async () => {
  await c.limpiar(['public.memberships'])
  await cerrarBase()
})

describe('asUser pone el role_id de la membresia', () => {
  it('un miembro lleva SU rol en los claims', async () => {
    const claims = await asUser(miembro, c.tenantId, async (tx) => {
      const [r] = await tx<{ c: { sub: string; app_metadata: Record<string, unknown> } }[]>`
        select current_setting('request.jwt.claims')::jsonb as c`
      return r!.c
    })
    expect(claims.sub).toBe(miembro)
    expect(claims.app_metadata).toMatchObject({ tenant_id: c.tenantId, role_id: rolCaja })
  })

  it('con ese rol, has_perm decide en la web: caja si, expedientes no', async () => {
    const [r] = await asUser(miembro, c.tenantId, (tx) => tx<{ caja: boolean; rrhh: boolean }[]>`
      select rls.has_perm('pos.sell') as caja, rls.has_perm('employees.view') as rrhh`)
    expect(r).toEqual({ caja: true, rrhh: false })
  })

  it('y las politicas de escritura de 0127 aplican: no se sube a Owner desde la web', async () => {
    await expect(
      asUser(miembro, c.tenantId, (tx) => tx`
        update public.memberships set role_id = ${rolOwner}
        where tenant_id = ${c.tenantId} and user_id = ${miembro}`),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('el Owner, en cambio, administra: le cambia el rol a otro', async () => {
    const filas = await asUser(owner, c.tenantId, (tx) => tx`
      update public.memberships set role_id = ${rolCaja}, updated_at = now()
      where tenant_id = ${c.tenantId} and user_id = ${miembro} returning id`)
    expect(filas).toHaveLength(1)
  })

  it('sin membresia no hay rol que poner: los claims no inventan uno', async () => {
    const claims = await asUser(forastero, c.tenantId, async (tx) => {
      const [r] = await tx<{ c: { app_metadata: Record<string, unknown> } }[]>`
        select current_setting('request.jwt.claims')::jsonb as c`
      return r!.c
    })
    expect(claims.app_metadata).not.toHaveProperty('role_id')
  })
})
