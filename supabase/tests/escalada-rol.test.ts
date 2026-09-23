import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Nadie se sube el rol dentro de su propio cliente (0127).
 *
 * Lo encontro 0121 al cerrar las FK: la RLS de `memberships` y `roles` era
 * solo `tenant_id = rls.tenant_id()`. Por la pantalla no pasaba -las
 * acciones exigen el permiso en servidor-, pero por PostgREST, que es la
 * puerta del movil y de cualquier integracion, un Cajero con su JWT de
 * verdad podia darse `"*": true` en su propio rol o pasar su membresia al
 * rol Owner. Aqui se prueba, siempre como `authenticated` con los claims
 * que emite el hook (tenant_id + role_id):
 *
 *  1. Reproduccion: el Cajero intenta subirse a Owner, darse `*`, crear un
 *     rol con `*` y asignarselo, tocar a otros. Todo 42501 o 0 filas.
 *  2. Con permiso, pero no sobre si mismo: un Gerente de Sucursal (su rol
 *     trae `*.edit`/`*.create`) administra a otros, pero no se cambia el
 *     rol, no amplia el suyo y no toca al Owner.
 *  3. El Owner sigue administrando, y el cliente nunca se queda sin Owner.
 *  4. rls.has_perm() falla cerrado: un rol que no es del cliente no
 *     concede nada.
 *  5. Solo un Owner invita a alguien como Owner.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)

// Personas del cliente A, y un Owner en B.
const owner1 = crypto.randomUUID()
const cajero = crypto.randomUUID()
const gerente = crypto.randomUUID()
const admin = crypto.randomUUID()
const vendedor = crypto.randomUUID()
const ownerB = crypto.randomUUID()

let tenantA: string
let tenantB: string
const rolA: Record<string, string> = {}
let rolOwnerB: string
let rolTodopoderoso: string
let sucursalA: string

const claims = (userId: string, tenantId: string, roleId?: string) =>
  JSON.stringify({
    sub: userId,
    app_metadata: { tenant_id: tenantId, role_id: roleId, is_provider: false },
  })

/** Como `authenticated` con el JWT que emitiria el hook para esa persona. */
async function como<T>(
  userId: string,
  roleId: string | undefined,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
  tenantId = tenantA,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenantId, roleId)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

async function rolDe(userId: string) {
  const [m] = await sql<{ role_id: string; is_active: boolean }[]>`
    select role_id, is_active from public.memberships
    where tenant_id = ${tenantA} and user_id = ${userId}`
  return m!
}

async function permisosDe(roleId: string) {
  const [r] = await sql<{ permissions: Record<string, unknown> }[]>`
    select permissions from public.roles where id = ${roleId}`
  return r!.permissions
}

async function miembro(userId: string, rol: string, tenant = tenantA) {
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id, is_active, invited_at, accepted_at)
    values (${tenant}, ${userId}, ${rol}, true, now(), now())`
}

const NEGADO = { code: '42501' }

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`esc-a-${RUN}`}, 'Ferreteria Escalada A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`esc-b-${RUN}`}, 'Colmado Escalada B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const n of ['Owner', 'Admin', 'Cajero', 'Gerente de Sucursal', 'Vendedor', 'Almacenista']) {
    const [r] = await sql<{ id: string }[]>`
      select id from public.roles where tenant_id = ${tenantA} and name = ${n}`
    rolA[n] = r!.id
  }
  const [rb] = await sql<{ id: string }[]>`
    select id from public.roles where tenant_id = ${tenantB} and name = 'Owner'`
  rolOwnerB = rb!.id

  // Un rol propio con TODO, creado por quien si puede: el caso "ya existe
  // un rol poderoso, me lo asigno".
  const [t] = await sql<{ id: string }[]>`
    insert into public.roles (tenant_id, name, permissions, visible_modules)
    values (${tenantA}, 'Todopoderoso', '{"*": true}'::jsonb, array['*']) returning id`
  rolTodopoderoso = t!.id

  const [c] = await sql<{ id: string }[]>`
    insert into public.companies (tenant_id, legal_name, is_default)
    values (${tenantA}, 'Escalada A SRL', true) returning id`
  const [s] = await sql<{ id: string }[]>`
    insert into public.branches (tenant_id, company_id, name)
    values (${tenantA}, ${c!.id}, 'Sucursal Escalada') returning id`
  sucursalA = s!.id

  await miembro(owner1, rolA.Owner!)
  await miembro(cajero, rolA.Cajero!)
  await miembro(gerente, rolA['Gerente de Sucursal']!)
  await miembro(admin, rolA.Admin!)
  await miembro(vendedor, rolA.Vendedor!)
  await miembro(ownerB, rolOwnerB, tenantB)
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  // Como dueño y sin claims: la regla del ultimo Owner protege al cliente
  // de sus usuarios, no estorba la limpieza de una prueba.
  await sql`delete from public.user_invitations where tenant_id in ${sql(ts)}`.catch(() => {})
  await sql`delete from public.memberships where tenant_id in ${sql(ts)}`
  await sql`delete from public.roles where tenant_id in ${sql(ts)}`
  await sql`delete from public.branches where tenant_id in ${sql(ts)}`
  await sql`delete from public.companies where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

// ═══════════════════════════════════════════════════════════════════════
describe('Reproduccion: un Cajero con su JWT de verdad, por PostgREST', () => {
  it('no se pasa al rol Owner', async () => {
    await expect(
      como(cajero, rolA.Cajero, (tx) => tx`
        update public.memberships set role_id = ${rolA.Owner!}
        where tenant_id = ${tenantA} and user_id = ${cajero}`),
    ).rejects.toMatchObject(NEGADO)
    expect((await rolDe(cajero)).role_id).toBe(rolA.Cajero)
  })

  it('no se da "*" en su propio rol', async () => {
    await expect(
      como(cajero, rolA.Cajero, (tx) => tx`
        update public.roles set permissions = permissions || '{"*": true}'::jsonb
        where id = ${rolA.Cajero!}`),
    ).rejects.toMatchObject(NEGADO)
    expect(await permisosDe(rolA.Cajero!)).not.toHaveProperty('*')
  })

  it('no crea un rol con "*"', async () => {
    await expect(
      como(cajero, rolA.Cajero, (tx) => tx`
        insert into public.roles (tenant_id, name, permissions)
        values (${tenantA}, 'Cajero Plus', '{"*": true}'::jsonb)`),
    ).rejects.toMatchObject(NEGADO)
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.roles where tenant_id = ${tenantA} and name = 'Cajero Plus'`
    expect(n!.n).toBe(0)
  })

  it('ni se asigna un rol con "*" que ya existia', async () => {
    await expect(
      como(cajero, rolA.Cajero, (tx) => tx`
        update public.memberships set role_id = ${rolTodopoderoso}
        where tenant_id = ${tenantA} and user_id = ${cajero}`),
    ).rejects.toMatchObject(NEGADO)
    expect((await rolDe(cajero)).role_id).toBe(rolA.Cajero)
  })

  it('no toca la membresia de otro (desactivar al Owner) ni los permisos de otro rol', async () => {
    await expect(
      como(cajero, rolA.Cajero, (tx) => tx`
        update public.memberships set is_active = false
        where tenant_id = ${tenantA} and user_id = ${owner1}`),
    ).rejects.toMatchObject(NEGADO)
    await expect(
      como(cajero, rolA.Cajero, (tx) => tx`
        update public.roles set permissions = permissions || '{"pos.void": true}'::jsonb
        where id = ${rolA.Vendedor!}`),
    ).rejects.toMatchObject(NEGADO)
    expect((await rolDe(owner1)).is_active).toBe(true)
  })

  it('no borra roles ni membresias', async () => {
    await expect(
      como(cajero, rolA.Cajero, (tx) => tx`delete from public.roles where id = ${rolTodopoderoso}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/rbac\.role\.delete/) })
    await expect(
      como(cajero, rolA.Cajero, (tx) => tx`
        delete from public.memberships where tenant_id = ${tenantA} and user_id = ${vendedor}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/users\.delete/) })
    expect((await rolDe(vendedor)).role_id).toBe(rolA.Vendedor)
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.roles where id = ${rolTodopoderoso}`
    expect(r!.n).toBe(1)
  })

  it('no da de alta a nadie, y menos como Owner', async () => {
    await expect(
      como(cajero, rolA.Cajero, (tx) => tx`
        insert into public.memberships (tenant_id, user_id, role_id)
        values (${tenantA}, ${crypto.randomUUID()}, ${rolA.Owner!})`),
    ).rejects.toMatchObject(NEGADO)
    await expect(
      como(cajero, rolA.Cajero, (tx) => tx`
        insert into public.memberships (tenant_id, user_id, role_id)
        values (${tenantA}, ${crypto.randomUUID()}, ${rolA.Vendedor!})`),
    ).rejects.toMatchObject(NEGADO)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Con permiso de administrar, pero nunca sobre si mismo', () => {
  // El Gerente de Sucursal trae "*.edit" y "*.create" (0006): users.edit y
  // rbac.role.edit le salen por comodin. La politica lo deja pasar; lo que
  // lo frena es la regla sobre lo propio.
  it('el Gerente no se cambia su propio rol, ni a Admin', async () => {
    await expect(
      como(gerente, rolA['Gerente de Sucursal'], (tx) => tx`
        update public.memberships set role_id = ${rolA.Admin!}
        where tenant_id = ${tenantA} and user_id = ${gerente}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/propio acceso/) })
    expect((await rolDe(gerente)).role_id).toBe(rolA['Gerente de Sucursal'])
  })

  it('ni amplia el rol que tiene asignado', async () => {
    await expect(
      como(gerente, rolA['Gerente de Sucursal'], (tx) => tx`
        update public.roles set permissions = permissions || '{"*": true}'::jsonb
        where id = ${rolA['Gerente de Sucursal']!}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/rol que tienes asignado/) })
  })

  it('ni toca el alcance de su membresia (sucursales) ni se la pasa a otra cuenta', async () => {
    await expect(
      como(gerente, rolA['Gerente de Sucursal'], (tx) => tx`
        update public.memberships set branch_ids = array[${sucursalA}]::uuid[]
        where tenant_id = ${tenantA} and user_id = ${gerente}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/propio acceso/) })
    await expect(
      como(gerente, rolA['Gerente de Sucursal'], (tx) => tx`
        update public.memberships set user_id = ${crypto.randomUUID()}
        where tenant_id = ${tenantA} and user_id = ${gerente}`),
    ).rejects.toMatchObject(NEGADO)
    // Ni se queda con la membresia de otro cambiandole el dueño.
    await expect(
      como(gerente, rolA['Gerente de Sucursal'], (tx) => tx`
        update public.memberships set user_id = ${gerente}
        where tenant_id = ${tenantA} and user_id = ${admin}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/propio acceso/) })
  })

  it('reescribir su membresia con los MISMOS valores no es un cambio', async () => {
    const filas = await como(gerente, rolA['Gerente de Sucursal'], (tx) => tx`
      update public.memberships set role_id = role_id, branch_ids = branch_ids
      where tenant_id = ${tenantA} and user_id = ${gerente} returning id`)
    expect(filas).toHaveLength(1)
  })

  it('no le da el rol Owner a nadie, ni desactiva al Owner: eso solo lo hace un Owner', async () => {
    await expect(
      como(gerente, rolA['Gerente de Sucursal'], (tx) => tx`
        update public.memberships set role_id = ${rolA.Owner!}
        where tenant_id = ${tenantA} and user_id = ${vendedor}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/Solo un Owner/) })
    await expect(
      como(admin, rolA.Admin, (tx) => tx`
        update public.memberships set is_active = false
        where tenant_id = ${tenantA} and user_id = ${owner1}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/Solo un Owner/) })
    expect((await rolDe(vendedor)).role_id).toBe(rolA.Vendedor)
    expect((await rolDe(owner1)).is_active).toBe(true)
  })

  it('el rol Owner no se recorta ni se renombra, ni siquiera un Admin', async () => {
    await expect(
      como(admin, rolA.Admin, (tx) => tx`
        update public.roles set permissions = '{}'::jsonb where id = ${rolA.Owner!}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/llave maestra/) })
    await expect(
      como(admin, rolA.Admin, (tx) => tx`
        update public.roles set name = 'Dueno' where id = ${rolA.Owner!}`),
    ).rejects.toMatchObject(NEGADO)
    expect(await permisosDe(rolA.Owner!)).toEqual({ '*': true })
  })

  it('lo legitimo sigue: el Gerente cambia el rol de un Vendedor y ajusta el rol de Almacenista', async () => {
    const m = await como(gerente, rolA['Gerente de Sucursal'], (tx) => tx`
      update public.memberships set role_id = ${rolA.Almacenista!}
      where tenant_id = ${tenantA} and user_id = ${vendedor} returning id`)
    expect(m).toHaveLength(1)
    const r = await como(gerente, rolA['Gerente de Sucursal'], (tx) => tx`
      update public.roles set permissions = permissions || '{"inventory.count": true}'::jsonb
      where id = ${rolA.Almacenista!} returning id`)
    expect(r).toHaveLength(1)
    // Deja todo como estaba para los casos de abajo.
    await sql`update public.memberships set role_id = ${rolA.Vendedor!}
              where tenant_id = ${tenantA} and user_id = ${vendedor}`
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('El Owner sigue administrando, y el cliente nunca se queda sin Owner', () => {
  it('crea, ajusta y borra roles; cambia el rol de otros', async () => {
    const [nuevo] = await como(owner1, rolA.Owner, (tx) => tx<{ id: string }[]>`
      insert into public.roles (tenant_id, name, permissions)
      values (${tenantA}, 'Temporal Owner', '{"pos.sell": true}'::jsonb) returning id`)
    const ajustado = await como(owner1, rolA.Owner, (tx) => tx`
      update public.roles set permissions = permissions || '{"pos.void": true}'::jsonb
      where id = ${rolA.Cajero!} returning id`)
    expect(ajustado).toHaveLength(1)
    const cambiado = await como(owner1, rolA.Owner, (tx) => tx`
      update public.memberships set role_id = ${nuevo!.id}
      where tenant_id = ${tenantA} and user_id = ${vendedor} returning id`)
    expect(cambiado).toHaveLength(1)
    await como(owner1, rolA.Owner, (tx) => tx`
      update public.memberships set role_id = ${rolA.Vendedor!}
      where tenant_id = ${tenantA} and user_id = ${vendedor}`)
    const borrado = await como(owner1, rolA.Owner, (tx) => tx`
      delete from public.roles where id = ${nuevo!.id} returning id`)
    expect(borrado).toHaveLength(1)
    await sql`update public.roles set permissions = permissions - 'pos.void' || '{"pos.void": false}'::jsonb
              where id = ${rolA.Cajero!}`
  })

  it('el unico Owner no se desactiva ni se borra: el cliente se quedaria sin Owner', async () => {
    await expect(
      como(owner1, rolA.Owner, (tx) => tx`
        update public.memberships set is_active = false
        where tenant_id = ${tenantA} and user_id = ${owner1}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/sin ningun Owner/) })
    await expect(
      como(owner1, rolA.Owner, (tx) => tx`
        delete from public.memberships where tenant_id = ${tenantA} and user_id = ${owner1}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/sin ningun Owner/) })
    expect((await rolDe(owner1)).is_active).toBe(true)
  })

  it('un Owner tampoco se cambia su propio rol: se lo pide a otro Owner', async () => {
    await expect(
      como(owner1, rolA.Owner, (tx) => tx`
        update public.memberships set role_id = ${rolA.Admin!}
        where tenant_id = ${tenantA} and user_id = ${owner1}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/propio acceso/) })
  })

  it('con dos Owners, uno puede degradar al otro; el ultimo que queda, no', async () => {
    // owner1 hace Owner al Admin...
    await como(owner1, rolA.Owner, (tx) => tx`
      update public.memberships set role_id = ${rolA.Owner!}
      where tenant_id = ${tenantA} and user_id = ${admin}`)
    // ...y el nuevo Owner degrada a owner1: sigue habiendo uno.
    const r = await como(admin, rolA.Owner, (tx) => tx`
      update public.memberships set role_id = ${rolA.Admin!}
      where tenant_id = ${tenantA} and user_id = ${owner1} returning id`)
    expect(r).toHaveLength(1)
    // Ahora el Admin es el unico Owner: no se puede desactivar.
    await expect(
      como(admin, rolA.Owner, (tx) => tx`
        update public.memberships set is_active = false
        where tenant_id = ${tenantA} and user_id = ${admin}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/sin ningun Owner/) })
    // Y se devuelve todo a como estaba, por el camino legitimo.
    await como(admin, rolA.Owner, (tx) => tx`
      update public.memberships set role_id = ${rolA.Owner!}
      where tenant_id = ${tenantA} and user_id = ${owner1}`)
    await como(owner1, rolA.Owner, (tx) => tx`
      update public.memberships set role_id = ${rolA.Admin!}
      where tenant_id = ${tenantA} and user_id = ${admin}`)
    expect((await rolDe(owner1)).role_id).toBe(rolA.Owner)
    expect((await rolDe(admin)).role_id).toBe(rolA.Admin)
  })

  it('el Owner de B no toca nada de A', async () => {
    const filas = await como(
      ownerB,
      rolOwnerB,
      (tx) => tx`
        update public.memberships set role_id = ${rolA.Cajero!}
        where tenant_id = ${tenantA} and user_id = ${owner1} returning id`,
      tenantB,
    )
    expect(filas).toHaveLength(0)
    expect((await rolDe(owner1)).role_id).toBe(rolA.Owner)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('rls.has_perm() falla cerrado', () => {
  async function puede(roleId: string | undefined, accion: string, tenant = tenantA) {
    return como(
      cajero,
      roleId,
      async (tx) => {
        const [r] = await tx<{ ok: boolean }[]>`select rls.has_perm(${accion}) as ok`
        return r!.ok
      },
      tenant,
    )
  }

  it('un rol que no existe no concede nada (antes concedia TODO)', async () => {
    expect(await puede(crypto.randomUUID(), 'employees.view')).toBe(false)
  })

  it('el rol de OTRO cliente tampoco, aunque exista y sea Owner', async () => {
    expect(await puede(rolOwnerB, 'employees.view')).toBe(false)
  })

  it('el rol propio decide como siempre', async () => {
    expect(await puede(rolA.Cajero, 'pos.sell')).toBe(true)
    expect(await puede(rolA.Cajero, 'employees.view')).toBe(false)
    expect(await puede(rolA.Owner, 'employees.view')).toBe(true)
  })

  it('sin role_id en el token sigue sin decidir aqui (asUser de la web, ver 0109)', async () => {
    expect(await puede(undefined, 'employees.view')).toBe(true)
  })

  it('el hook sigue emitiendo el rol propio, y con ese token has_perm funciona', async () => {
    const [r] = await sql<{ c: { claims: { app_metadata: { tenant_id: string; role_id: string } } } }[]>`
      select rls.custom_access_token_hook(
        jsonb_build_object('user_id', ${cajero}::text, 'claims', jsonb_build_object('app_metadata', '{}'::jsonb))
      ) as c`
    expect(r!.c.claims.app_metadata).toMatchObject({ tenant_id: tenantA, role_id: rolA.Cajero })
    expect(await puede(r!.c.claims.app_metadata.role_id, 'pos.sell')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Invitar como Owner', () => {
  // Directo sobre la tabla, como dueño pero CON los claims del que invita:
  // se prueba la regla de la base, no la funcion de 0123 que la usa.
  async function invitarComo(userId: string, roleId: string, rolInvitado: string) {
    return sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims(userId, tenantA, roleId)}, true)`
      return tx`
        insert into public.user_invitations
          (tenant_id, email, display_name, role_id, token_hash, expires_at)
        values (${tenantA}, ${`x-${crypto.randomUUID().slice(0, 6)}@escalada.do`}, 'Invitado Escalada',
                ${rolInvitado}, encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
                now() + interval '7 days')
        returning id`
    })
  }

  it('un Admin no invita a nadie como Owner', async () => {
    await expect(invitarComo(admin, rolA.Admin!, rolA.Owner!)).rejects.toMatchObject({
      code: '42501',
      message: expect.stringMatching(/Solo un Owner/),
    })
  })

  it('un Owner si; y un Admin invita con cualquier otro rol', async () => {
    await expect(invitarComo(owner1, rolA.Owner!, rolA.Owner!)).resolves.toHaveLength(1)
    await expect(invitarComo(admin, rolA.Admin!, rolA.Vendedor!)).resolves.toHaveLength(1)
  })
})
