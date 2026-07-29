/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Escritura de roles bajo RLS
 *
 *  Las server actions comprueban el permiso en el servidor, pero eso vive
 *  en Next y no se puede probar aqui. Lo que SI se prueba aqui es la
 *  segunda barrera: aunque el permiso pasara, RLS impide escribir en los
 *  roles de otro cliente.
 *
 *  Defensa en profundidad: si un dia alguien olvida la comprobacion de
 *  permiso en una accion nueva, esto sigue cubriendo.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)

let tenantA: string
let tenantB: string
let rolA: string
let rolB: string
const userA = crypto.randomUUID()

const claims = (userId: string, tenantId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { tenant_id: tenantId, is_provider: false } })

async function as<T>(jwt: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${jwt}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`rbac-a-${RUN}`}, 'Cliente A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`rbac-b-${RUN}`}, 'Cliente B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  const [ra] = await sql`
    select id from public.roles where tenant_id = ${tenantA} and name = 'Cajero'`
  const [rb] = await sql`
    select id from public.roles where tenant_id = ${tenantB} and name = 'Cajero'`
  rolA = ra!.id
  rolB = rb!.id
})

afterAll(async () => {
  await sql`delete from public.roles where tenant_id in (${tenantA}, ${tenantB})`
  await sql`delete from regb.tenant_modules where tenant_id in (${tenantA}, ${tenantB})`
  await sql`delete from regb.onboarding where tenant_id in (${tenantA}, ${tenantB})`
  await sql`delete from regb.tenants where id in (${tenantA}, ${tenantB})`
  await sql.end()
})

describe('Aislamiento al escribir roles', () => {
  it('un admin edita los permisos de SU cliente', async () => {
    const filas = await as(
      claims(userA, tenantA),
      (tx) =>
        tx<{ id: string }[]>`
        update public.roles
        set permissions = permissions || jsonb_build_object('pos.void'::text, true::boolean)
        where id = ${rolA} and tenant_id = ${tenantA}
        returning id`,
    )
    expect(filas).toHaveLength(1)

    const [r] = await sql`select permissions->>'pos.void' as v from public.roles where id = ${rolA}`
    expect(r!.v).toBe('true')
  })

  it('NO puede editar los roles de otro cliente, ni nombrandolo explicitamente', async () => {
    // El Cajero de fabrica ya trae `pos.void: false` (§8.2), asi que la
    // clave existe. Lo que se comprueba es que el VALOR no cambio.
    const [antes] =
      await sql`select permissions->>'pos.void' as v from public.roles where id = ${rolB}`
    expect(antes!.v).toBe('false')

    const filas = await as(
      claims(userA, tenantA),
      (tx) =>
        tx<{ id: string }[]>`
        update public.roles
        set permissions = permissions || jsonb_build_object('pos.void'::text, true::boolean)
        where id = ${rolB}
        returning id`,
    )
    expect(filas).toHaveLength(0)

    const [despues] =
      await sql`select permissions->>'pos.void' as v from public.roles where id = ${rolB}`
    expect(despues!.v).toBe('false')
  })

  it('NO puede crear un rol a nombre de otro cliente', async () => {
    await expect(
      as(
        claims(userA, tenantA),
        (tx) =>
          tx`insert into public.roles (tenant_id, name, permissions)
           values (${tenantB}, 'Rol infiltrado', '{}'::jsonb)`,
      ),
    ).rejects.toThrow()
  })

  it('NO puede borrar los roles de otro cliente', async () => {
    const filas = await as(
      claims(userA, tenantA),
      (tx) => tx<{ id: string }[]>`delete from public.roles where id = ${rolB} returning id`,
    )
    expect(filas).toHaveLength(0)

    const [r] = await sql`select id from public.roles where id = ${rolB}`
    expect(r).toBeDefined()
  })

  it('no ve siquiera cuantos roles tiene el otro cliente', async () => {
    const filas = await as(
      claims(userA, tenantA),
      (tx) => tx`select id from public.roles where tenant_id = ${tenantB}`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Forma de los datos', () => {
  it('permissions y scope se guardan como OBJETO, nunca como array', async () => {
    // Un `||` con un jsonb mal construido concatena en vez de fusionar y
    // convierte el objeto en array. El sintoma aparece mucho despues,
    // cuando el evaluador de permisos deja de encontrar nada.
    const filas = await sql<{ tp: string; ts: string }[]>`
      select jsonb_typeof(permissions) as tp, jsonb_typeof(scope) as ts
      from public.roles`
    expect(filas.every((r) => r.tp === 'object')).toBe(true)
    expect(filas.every((r) => r.ts === 'object')).toBe(true)
  })

  it('fusionar un permiso conserva los que ya estaban', async () => {
    await sql`update public.roles
              set permissions = '{"a": true, "b": false}'::jsonb where id = ${rolA}`

    await as(
      claims(userA, tenantA),
      (tx) =>
        tx`update public.roles
         set permissions = permissions || jsonb_build_object('c'::text, true::boolean)
         where id = ${rolA} and tenant_id = ${tenantA}`,
    )

    const [r] = await sql<{ permissions: Record<string, boolean> }[]>`
      select permissions from public.roles where id = ${rolA}`
    expect(r!.permissions).toEqual({ a: true, b: false, c: true })
  })

  it('quitar un permiso solo quita ese', async () => {
    await as(
      claims(userA, tenantA),
      (tx) =>
        tx`update public.roles set permissions = permissions - 'b'
         where id = ${rolA} and tenant_id = ${tenantA}`,
    )

    const [r] = await sql<{ permissions: Record<string, boolean> }[]>`
      select permissions from public.roles where id = ${rolA}`
    expect(r!.permissions).toEqual({ a: true, c: true })
  })
})

describe('Provisionamiento de un cliente nuevo', () => {
  it('nace con los 14 roles predefinidos', async () => {
    const [r] = await sql<{ n: string }[]>`
      select count(*) as n from public.roles where tenant_id = ${tenantA} and is_system`
    expect(Number(r!.n)).toBe(14)
  })

  it('nace con los modulos core ya activos', async () => {
    // §6.1: los core vienen con el plan. Sin esto, `auth.module_active`
    // era false para todos y nadie podia ni editar sus propios roles.
    const [r] = await sql<{ n: string }[]>`
      select count(*) as n
      from regb.tenant_modules tm
      join regb.module_catalog mc on mc.id = tm.module_id
      where tm.tenant_id = ${tenantA} and mc.category = 'core'
        and tm.status = 'active' and tm.enabled`
    expect(Number(r!.n)).toBeGreaterThanOrEqual(15)
  })

  it('NO nace con modulos de pago', async () => {
    const [r] = await sql<{ n: string }[]>`
      select count(*) as n
      from regb.tenant_modules tm
      join regb.module_catalog mc on mc.id = tm.module_id
      where tm.tenant_id = ${tenantA} and mc.category <> 'core'`
    expect(Number(r!.n)).toBe(0)
  })
})
