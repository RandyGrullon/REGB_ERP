/**
 * Tests de la lectura de sesion.
 *
 * El hook de la base pone los claims; esto los interpreta. Entre los dos
 * deciden si una persona ve datos o no ve nada. Los dos tienen que fallar
 * cerrado ante cualquier duda.
 */
import { describe, expect, it } from 'vitest'
import { checkAccess, isPastDue, readSession, type RegbSession } from './session'

const USER = '11111111-1111-1111-1111-111111111111'
const TENANT = '22222222-2222-2222-2222-222222222222'
const ROLE = '33333333-3333-3333-3333-333333333333'
const SUCURSAL = '44444444-4444-4444-4444-444444444444'

const usuario = (app_metadata: unknown) => ({ id: USER, email: 'maria@caribe.do', app_metadata })

describe('Lectura de claims', () => {
  it('lee una sesion completa de un usuario de cliente', () => {
    const s = readSession(
      usuario({
        tenant_id: TENANT,
        role_id: ROLE,
        is_provider: false,
        tenant_status: 'active',
        branches: [SUCURSAL],
        companies: [],
      }),
    )
    expect(s.tenantId).toBe(TENANT)
    expect(s.roleId).toBe(ROLE)
    expect(s.isProvider).toBe(false)
    expect(s.branchIds).toEqual([SUCURSAL])
  })

  it('lee una sesion de REGB Control', () => {
    const s = readSession(usuario({ tenant_id: null, is_provider: true, provider_role: 'owner' }))
    expect(s.isProvider).toBe(true)
    expect(s.providerRole).toBe('owner')
    expect(s.tenantId).toBeNull()
  })
})

describe('Fallar cerrado', () => {
  it('sin app_metadata no hay tenant', () => {
    expect(readSession(usuario(undefined)).tenantId).toBeNull()
    expect(readSession(usuario({})).tenantId).toBeNull()
  })

  it('unos claims corruptos no se convierten en acceso', () => {
    // Si el hook fallo o el token es viejo, RLS no devuelve nada.
    const s = readSession(usuario({ tenant_id: 'no-soy-un-uuid', is_provider: 'si' }))
    expect(s.tenantId).toBeNull()
    expect(s.isProvider).toBe(false)
  })

  it('un is_provider falsificado como texto no cuela', () => {
    expect(readSession(usuario({ is_provider: 'true' })).isProvider).toBe(false)
    expect(readSession(usuario({ is_provider: 1 })).isProvider).toBe(false)
  })
})

describe('Control de acceso', () => {
  const base: RegbSession = {
    userId: USER,
    email: 'maria@caribe.do',
    tenantId: TENANT,
    roleId: ROLE,
    isProvider: false,
    providerRole: null,
    tenantStatus: 'active',
    branchIds: [],
    companyIds: [],
  }

  it('un usuario con tenant activo entra', () => {
    expect(checkAccess(base).blocked).toBe(false)
  })

  it('sin membresia se explica que falta, no se devuelve un 403 mudo', () => {
    const r = checkAccess({ ...base, tenantId: null, tenantStatus: null })
    expect(r.blocked).toBe(true)
    expect(r.blocked && r.reason).toBe('no-membership')
    expect(r.blocked && r.message).toMatch(/administrador que te invite/)
  })

  it('un cliente suspendido recibe un mensaje que dice que nada se borro', () => {
    const r = checkAccess({ ...base, tenantId: null, tenantStatus: 'suspended' })
    expect(r.blocked && r.reason).toBe('tenant-suspended')
    expect(r.blocked && r.message).toMatch(/Nada se ha borrado/)
  })

  it('un cliente archivado tambien, y apunta a soporte', () => {
    const r = checkAccess({ ...base, tenantId: null, tenantStatus: 'archived' })
    expect(r.blocked && r.reason).toBe('tenant-archived')
    expect(r.blocked && r.message).toMatch(/datos siguen intactos/)
  })

  it('en mora SI se entra: la escalera avisa antes de bloquear', () => {
    const enMora = { ...base, tenantStatus: 'past_due' }
    expect(checkAccess(enMora).blocked).toBe(false)
    expect(isPastDue(enMora)).toBe(true)
    expect(isPastDue(base)).toBe(false)
  })

  it('un usuario del proveedor entra sin pertenecer a ningun tenant', () => {
    const proveedor = { ...base, tenantId: null, tenantStatus: null, isProvider: true }
    expect(checkAccess(proveedor).blocked).toBe(false)
  })
})
