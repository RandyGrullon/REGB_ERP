/**
 * ═══════════════════════════════════════════════════════════════════════
 *  El hook que emite los claims del JWT
 *
 *  Todo el aislamiento de REGB depende de que `tenant_id` en el token sea
 *  correcto. Este hook es quien lo pone. Si se equivoca, RLS obedece con
 *  disciplina a un dato equivocado.
 *
 *  La regla que se verifica en casi todos los casos: FALLAR CERRADO. Ante
 *  cualquier duda, el token sale sin tenant_id y el usuario no ve nada.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

/** Slugs unicos: el test no depende del estado previo de la base. */
const RUN = crypto.randomUUID().slice(0, 8)

let tenantActivo: string
let tenantSuspendido: string
let rolOwner: string
let rolCajero: string
let sucursal: string

const userAceptado = crypto.randomUUID()
const userPendiente = crypto.randomUUID()
const userInactivo = crypto.randomUUID()
const userSuspendido = crypto.randomUUID()
const userSinNada = crypto.randomUUID()
const userProveedor = crypto.randomUUID()

interface Claims {
  app_metadata: {
    tenant_id: string | null
    role_id?: string
    is_provider: boolean
    provider_role?: string
    tenant_status?: string
    branches?: string[]
    companies?: string[]
  }
}

/** Invoca el hook igual que lo haria Supabase al emitir un token. */
async function emitir(userId: string): Promise<Claims['app_metadata']> {
  const [row] = await sql<{ result: { claims: Claims } }[]>`
    select rls.custom_access_token_hook(
      jsonb_build_object(
        'user_id', ${userId}::uuid,
        'claims', jsonb_build_object('app_metadata', '{}'::jsonb)
      )
    ) as result`
  return row!.result.claims.app_metadata
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`hook-ok-${RUN}`}, 'Ferreteria Bonao SRL', 'pyme', 'active') returning id`
  const [s] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`hook-sus-${RUN}`}, 'Moroso SRL', 'pyme', 'suspended') returning id`
  tenantActivo = a!.id
  tenantSuspendido = s!.id

  const [ro] = await sql`
    select id from public.roles where tenant_id = ${tenantActivo} and name = 'Owner'`
  const [rc] = await sql`
    select id from public.roles where tenant_id = ${tenantActivo} and name = 'Cajero'`
  rolOwner = ro!.id
  rolCajero = rc!.id

  const [comp] = await sql`
    insert into public.companies (tenant_id, legal_name, is_default)
    values (${tenantActivo}, 'Ferreteria Bonao SRL', true) returning id`
  const [suc] = await sql`
    insert into public.branches (tenant_id, company_id, name, code)
    values (${tenantActivo}, ${comp!.id}, 'Bonao Centro', 'BC') returning id`
  sucursal = suc!.id

  // Aceptado y activo — el caso feliz.
  await sql`
    insert into public.memberships
      (tenant_id, user_id, role_id, branch_ids, is_active, invited_at, accepted_at)
    values (${tenantActivo}, ${userAceptado}, ${rolCajero},
            ${sql.array([sucursal])}::uuid[], true, now(), now())`

  // Invitado pero nunca acepto.
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id, is_active, invited_at)
    values (${tenantActivo}, ${userPendiente}, ${rolOwner}, true, now())`

  // Acepto, pero le dieron de baja.
  await sql`
    insert into public.memberships
      (tenant_id, user_id, role_id, is_active, invited_at, accepted_at)
    values (${tenantActivo}, ${userInactivo}, ${rolOwner}, false, now(), now())`

  // Todo en regla, pero su empresa esta suspendida por mora.
  const [ros] = await sql`
    select id from public.roles where tenant_id = ${tenantSuspendido} and name = 'Owner'`
  await sql`
    insert into public.memberships
      (tenant_id, user_id, role_id, is_active, invited_at, accepted_at)
    values (${tenantSuspendido}, ${userSuspendido}, ${ros!.id}, true, now(), now())`

  await sql`
    insert into regb.provider_users (user_id, full_name, role)
    values (${userProveedor}, 'Randy Grullon', 'owner')`
})

afterAll(async () => {
  await sql`delete from regb.provider_users where user_id = ${userProveedor}`
  await sql`delete from public.memberships where tenant_id in (${tenantActivo}, ${tenantSuspendido})`
  await sql`delete from public.branches  where tenant_id = ${tenantActivo}`
  await sql`delete from public.companies where tenant_id = ${tenantActivo}`
  await sql`delete from regb.tenants where id in (${tenantActivo}, ${tenantSuspendido})`
  await sql.end()
})

// ═══════════════════════════════════════════════════════════════════════
describe('Usuario de un cliente', () => {
  it('recibe su tenant, su rol y su alcance', async () => {
    const m = await emitir(userAceptado)
    expect(m.tenant_id).toBe(tenantActivo)
    expect(m.role_id).toBe(rolCajero)
    expect(m.is_provider).toBe(false)
    expect(m.tenant_status).toBe('active')
    expect(m.branches).toEqual([sucursal])
  })

  it('el tenant_id sale de la base, no de nada que el usuario controle', async () => {
    // Cambiar la fila cambia el token. Es la unica via.
    await sql`update public.memberships set role_id = ${rolOwner}
              where user_id = ${userAceptado}`
    expect((await emitir(userAceptado)).role_id).toBe(rolOwner)

    await sql`update public.memberships set role_id = ${rolCajero}
              where user_id = ${userAceptado}`
    expect((await emitir(userAceptado)).role_id).toBe(rolCajero)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Fallar cerrado', () => {
  it('un usuario sin ninguna membresia no recibe tenant', async () => {
    const m = await emitir(userSinNada)
    expect(m.tenant_id).toBeNull()
    expect(m.is_provider).toBe(false)
  })

  it('una invitacion sin aceptar todavia no da acceso', async () => {
    const m = await emitir(userPendiente)
    expect(m.tenant_id).toBeNull()
  })

  it('dar de baja a un empleado le corta el acceso en el siguiente token', async () => {
    const m = await emitir(userInactivo)
    expect(m.tenant_id).toBeNull()
  })

  it('un cliente suspendido por mora deja de emitir tenant', async () => {
    // Dia 30 de la escalera de mora (§6.6): login bloqueado, datos intactos.
    const m = await emitir(userSuspendido)
    expect(m.tenant_id).toBeNull()
    expect(m.tenant_status).toBe('suspended')
  })

  it('reactivar al cliente devuelve el acceso, sin tocar sus datos', async () => {
    await sql`update regb.tenants set status = 'active' where id = ${tenantSuspendido}`
    expect((await emitir(userSuspendido)).tenant_id).toBe(tenantSuspendido)

    await sql`update regb.tenants set status = 'suspended' where id = ${tenantSuspendido}`
    expect((await emitir(userSuspendido)).tenant_id).toBeNull()
  })

  it('un cliente en mora (past_due) TODAVIA entra: la mora avisa antes de bloquear', async () => {
    await sql`update regb.tenants set status = 'past_due' where id = ${tenantSuspendido}`
    const m = await emitir(userSuspendido)
    expect(m.tenant_id).toBe(tenantSuspendido)
    expect(m.tenant_status).toBe('past_due')

    await sql`update regb.tenants set status = 'suspended' where id = ${tenantSuspendido}`
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Usuario de REGB Control', () => {
  it('recibe is_provider y NINGUN tenant', async () => {
    const m = await emitir(userProveedor)
    expect(m.is_provider).toBe(true)
    expect(m.provider_role).toBe('owner')
    expect(m.tenant_id).toBeNull()
  })

  it('desactivarlo lo devuelve a usuario comun sin acceso', async () => {
    await sql`update regb.provider_users set is_active = false where user_id = ${userProveedor}`
    const m = await emitir(userProveedor)
    expect(m.is_provider).toBe(false)
    expect(m.tenant_id).toBeNull()

    await sql`update regb.provider_users set is_active = true where user_id = ${userProveedor}`
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Superficie de ataque del hook', () => {
  it('un cliente NO puede invocar el hook', async () => {
    // Si pudiera, se fabricaria los claims que quisiera.
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe('set local role authenticated')
        return tx`select rls.custom_access_token_hook('{}'::jsonb)`
      }),
    ).rejects.toThrow(/permission denied/i)
  })

  it('un cliente ni siquiera puede consultar regb.provider_users', async () => {
    // Doble barrera: sin grant, la consulta muere antes de evaluar la RLS.
    // Un cliente no recibe una lista vacia, recibe "permission denied".
    const claims = JSON.stringify({
      sub: userAceptado,
      app_metadata: { tenant_id: tenantActivo, is_provider: false },
    })
    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`
        await tx.unsafe('set local role authenticated')
        return tx`select user_id from regb.provider_users`
      }),
    ).rejects.toThrow(/permission denied/i)
  })

  it('nadie puede auto-nombrarse proveedor', async () => {
    const claims = JSON.stringify({
      sub: userAceptado,
      app_metadata: { tenant_id: tenantActivo, is_provider: false },
    })
    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`
        await tx.unsafe('set local role authenticated')
        return tx`insert into regb.provider_users (user_id, full_name)
                  values (${userAceptado}, 'Intruso')`
      }),
    ).rejects.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Invitaciones', () => {
  // Desde 0123 se invita con `crear_invitacion()` y NO nace membresia hasta
  // que la persona acepta con su cuenta real. `invite_member()` (0008)
  // inventaba un user_id y se elimino. El ciclo completo -hash, vencimiento,
  // aceptar, aislamiento- esta en invitaciones.test.ts.
  const invitar = (claims: string, email: string, roleId: string) =>
    sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`
      await tx.unsafe('set local role authenticated')
      return tx`select invitacion from public.crear_invitacion(${email}, 'Persona Invitada', ${roleId}::uuid)`
    })

  const claimsDe = (tenant: string) =>
    JSON.stringify({ sub: userAceptado, app_metadata: { tenant_id: tenant, is_provider: false } })

  it('un admin invita a alguien de su tenant', async () => {
    const antes = await sql`
      select count(*)::int as n from public.memberships where tenant_id = ${tenantActivo}`
    const rows = await invitar(claimsDe(tenantActivo), 'nuevo@ferreteria.do', rolCajero)
    expect(rows[0]!.invitacion).toBeTruthy()

    // Queda pendiente: invitar no es dar acceso, y no se inventa una membresia.
    const [i] = await sql`
      select status from public.user_invitations where id = ${rows[0]!.invitacion}`
    expect(i!.status).toBe('pending')
    const despues = await sql`
      select count(*)::int as n from public.memberships where tenant_id = ${tenantActivo}`
    expect(despues[0]!.n).toBe(antes[0]!.n)
  })

  it('NO puede asignar un rol de otro cliente', async () => {
    const [rolAjeno] = await sql`
      select id from public.roles where tenant_id = ${tenantSuspendido} and name = 'Owner'`
    await expect(invitar(claimsDe(tenantActivo), 'colado@otro.do', rolAjeno!.id)).rejects.toThrow(
      /no pertenece a este cliente/,
    )
  })

  it('sin tenant en el JWT no se puede invitar a nadie', async () => {
    const sinTenant = JSON.stringify({ sub: userSinNada, app_metadata: { is_provider: false } })
    await expect(invitar(sinTenant, 'x@y.do', rolCajero)).rejects.toThrow(/Sesion sin cliente/)
  })
})
