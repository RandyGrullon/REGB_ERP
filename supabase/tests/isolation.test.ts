/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PUERTA F0 — Aislamiento entre tenants
 *
 *  El test mas importante de REGB ERP. Si uno solo de estos casos falla,
 *  un cliente puede ver los datos de otro y el producto esta muerto.
 *
 *  Documento maestro §10. Corre en CI en cada push.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'

const sql = postgres(URL, { max: 4, onnotice: () => {} })

let tenantA: string
let tenantB: string
let userA: string
let userB: string
let providerUser: string
let companyB: string

/** JWT de un usuario normal de un tenant. */
const claims = (userId: string, tenantId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { tenant_id: tenantId, is_provider: false } })

/** JWT de un usuario de REGB Control. */
const providerClaims = (userId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { is_provider: true } })

/**
 * Ejecuta una consulta haciendose pasar por un usuario concreto.
 *
 * `set local role authenticated` es imprescindible: como `postgres` es dueno
 * de las tablas, sin cambiar de rol las politicas no se evaluarian y el test
 * pasaria en falso. Las migraciones ademas usan FORCE ROW LEVEL SECURITY.
 */
async function as<T>(jwt: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${jwt}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

/**
 * Slugs unicos por corrida.
 *
 * El test crea sus propios clientes y no puede chocar con el seed de
 * demostracion ni con otra corrida en paralelo: un test que depende del
 * estado previo de la base deja de ser una prueba y pasa a ser una loteria.
 */
const RUN = crypto.randomUUID().slice(0, 8)

beforeAll(async () => {
  // Dos clientes reales y distintos.
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status, tax_id)
    values (${`iso-a-${RUN}`}, 'Colmado La Esperanza SRL', 'pyme', 'active', '130-11111-1')
    returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status, tax_id)
    values (${`iso-b-${RUN}`}, 'Distribuidora Caribe SRL', 'mediano', 'active', '131-45678-9')
    returning id`

  tenantA = a!.id
  tenantB = b!.id
  userA = crypto.randomUUID()
  userB = crypto.randomUUID()
  providerUser = crypto.randomUUID()

  // Una empresa por cliente.
  await sql`
    insert into public.companies (tenant_id, legal_name, is_default)
    values (${tenantA}, 'Colmado La Esperanza SRL', true)`
  const [cb] = await sql`
    insert into public.companies (tenant_id, legal_name, is_default)
    values (${tenantB}, 'Distribuidora Caribe SRL', true)
    returning id`
  companyB = cb!.id

  // Un modulo de catalogo, activo solo para B.
  await sql`
    insert into regb.module_catalog (id, name, category, is_published)
    values ('inventory', 'Inventario', 'standard', true)
    on conflict (id) do nothing`
  await sql`
    insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
    values (${tenantB}, 'inventory', 'active', true)
    on conflict do nothing`

  // Membresias: cada usuario en su tenant.
  const [rolA] = await sql`
    select id from public.roles where tenant_id = ${tenantA} and name = 'Owner'`
  const [rolB] = await sql`
    select id from public.roles where tenant_id = ${tenantB} and name = 'Owner'`
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id)
    values (${tenantA}, ${userA}, ${rolA!.id})`
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id)
    values (${tenantB}, ${userB}, ${rolB!.id})`
})

afterAll(async () => {
  // Facturas y log de impersonacion son `on delete restrict` a proposito:
  // un registro fiscal y una evidencia de auditoria no desaparecen con el
  // cliente. En el test los retiramos explicitamente.
  await sql`delete from regb.invoices          where tenant_id in (${tenantA}, ${tenantB})`
  await sql`delete from regb.impersonation_log where tenant_id in (${tenantA}, ${tenantB})`
  await sql`delete from regb.tenants           where id        in (${tenantA}, ${tenantB})`
  await sql.end()
})

// ═══════════════════════════════════════════════════════════════════════
describe('Aislamiento de lectura', () => {
  it('el tenant A no ve NINGUNA empresa del tenant B', async () => {
    const rows = await as(
      claims(userA, tenantA),
      (tx) => tx`select id from public.companies where tenant_id = ${tenantB}`,
    )
    expect(rows).toHaveLength(0)
  })

  it('el tenant A solo se ve a si mismo al listar sin filtro', async () => {
    const rows = await as(
      claims(userA, tenantA),
      (tx) => tx<{ tenant_id: string }[]>`select tenant_id from public.companies`,
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.tenant_id === tenantA)).toBe(true)
  })

  it('el tenant A no ve las sucursales, roles ni membresias de B', async () => {
    const [branches, roles, members] = await as(claims(userA, tenantA), async (tx) => [
      await tx`select id from public.branches   where tenant_id = ${tenantB}`,
      await tx`select id from public.roles       where tenant_id = ${tenantB}`,
      await tx`select id from public.memberships where tenant_id = ${tenantB}`,
    ])
    expect(branches).toHaveLength(0)
    expect(roles).toHaveLength(0)
    expect(members).toHaveLength(0)
  })

  it('un JWT sin tenant_id no ve absolutamente nada', async () => {
    const rows = await as(
      JSON.stringify({ sub: userA, app_metadata: {} }),
      (tx) => tx`select id from public.companies`,
    )
    expect(rows).toHaveLength(0)
  })

  it('un tenant_id falsificado en el JWT solo alcanza a ese tenant, no a otros', async () => {
    // Aunque alguien forje el claim, sigue viendo un solo tenant — nunca dos.
    const rows = await as(
      claims(userA, tenantB),
      (tx) => tx<{ tenant_id: string }[]>`select tenant_id from public.companies`,
    )
    expect(rows.every((r) => r.tenant_id === tenantB)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Aislamiento de escritura', () => {
  it('el tenant A no puede MODIFICAR datos de B', async () => {
    const rows = await as(
      claims(userA, tenantA),
      (tx) =>
        tx`update public.companies set legal_name = 'HACKEADO'
         where id = ${companyB} returning id`,
    )
    expect(rows).toHaveLength(0)

    const [check] = await sql`select legal_name from public.companies where id = ${companyB}`
    expect(check!.legal_name).toBe('Distribuidora Caribe SRL')
  })

  it('el tenant A no puede BORRAR datos de B', async () => {
    const rows = await as(
      claims(userA, tenantA),
      (tx) => tx`delete from public.companies where id = ${companyB} returning id`,
    )
    expect(rows).toHaveLength(0)

    const [check] = await sql`select id from public.companies where id = ${companyB}`
    expect(check).toBeDefined()
  })

  it('el tenant A no puede INSERTAR filas a nombre de B', async () => {
    await expect(
      as(
        claims(userA, tenantA),
        (tx) =>
          tx`insert into public.companies (tenant_id, legal_name)
           values (${tenantB}, 'Empresa infiltrada')`,
      ),
    ).rejects.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Licencia de modulos', () => {
  it('rls.module_active es true para quien lo tiene licenciado', async () => {
    const [r] = await as(
      claims(userB, tenantB),
      (tx) => tx<{ active: boolean }[]>`select rls.module_active('inventory') as active`,
    )
    expect(r!.active).toBe(true)
  })

  it('rls.module_active es false para quien NO lo compro', async () => {
    const [r] = await as(
      claims(userA, tenantA),
      (tx) => tx<{ active: boolean }[]>`select rls.module_active('inventory') as active`,
    )
    expect(r!.active).toBe(false)
  })

  it('apagar el modulo lo desactiva sin borrar la licencia', async () => {
    await sql`update regb.tenant_modules set enabled = false
              where tenant_id = ${tenantB} and module_id = 'inventory'`

    const [r] = await as(
      claims(userB, tenantB),
      (tx) => tx<{ active: boolean }[]>`select rls.module_active('inventory') as active`,
    )
    expect(r!.active).toBe(false)

    // La fila sigue ahi: desinstalar es archivar, nunca borrar (§4.3).
    const [row] = await sql`select status from regb.tenant_modules
                            where tenant_id = ${tenantB} and module_id = 'inventory'`
    expect(row!.status).toBe('active')

    await sql`update regb.tenant_modules set enabled = true
              where tenant_id = ${tenantB} and module_id = 'inventory'`
  })

  it('el tenant solo ve SUS modulos activos, no los de otros', async () => {
    const rows = await as(
      claims(userA, tenantA),
      (tx) => tx`select module_id from regb.tenant_modules where tenant_id = ${tenantB}`,
    )
    expect(rows).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Esquema regb — solo el proveedor', () => {
  it('un cliente no puede listar los tenants del proveedor', async () => {
    const rows = await as(claims(userA, tenantA), (tx) => tx`select id from regb.tenants`)
    expect(rows).toHaveLength(0)
  })

  it('un cliente no ve las suscripciones de nadie, ni la suya', async () => {
    const rows = await as(claims(userA, tenantA), (tx) => tx`select id from regb.subscriptions`)
    expect(rows).toHaveLength(0)
  })

  it('un cliente ve SUS facturas pero no las de otro', async () => {
    await sql`
      insert into regb.invoices (tenant_id, number, period_start, period_end,
                                  subtotal, total, due_at, lines)
      values (${tenantB}, ${`NX-${RUN}`}, '2026-07-01', '2026-07-31',
              906.00, 906.00, '2026-08-12', '[]'::jsonb)`

    const ajenas = await as(
      claims(userA, tenantA),
      (tx) => tx`select id from regb.invoices where tenant_id = ${tenantB}`,
    )
    expect(ajenas).toHaveLength(0)

    const propias = await as(claims(userB, tenantB), (tx) => tx`select number from regb.invoices`)
    expect(propias).toHaveLength(1)
  })

  it('el proveedor SI ve todos los tenants', async () => {
    const rows = await as(providerClaims(providerUser), (tx) => tx`select id from regb.tenants`)
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Impersonacion del proveedor', () => {
  it('sin sesion abierta, el proveedor NO ve datos de negocio del cliente', async () => {
    const rows = await as(
      providerClaims(providerUser),
      (tx) => tx`select id from public.companies where tenant_id = ${tenantB}`,
    )
    expect(rows).toHaveLength(0)
  })

  it('con sesion abierta y vigente, si los ve', async () => {
    await sql`
      insert into regb.impersonation_log (provider_user, tenant_id, reason, ticket_ref)
      values (${providerUser}, ${tenantB}, 'Soporte: la factura 284 no imprime', 'TCK-1042')`

    const rows = await as(
      providerClaims(providerUser),
      (tx) => tx`select id from public.companies where tenant_id = ${tenantB}`,
    )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('la impersonacion expira sola a los 60 minutos', async () => {
    await sql`update regb.impersonation_log
              set started_at = now() - interval '61 minutes'
              where provider_user = ${providerUser} and ended_at is null`

    const rows = await as(
      providerClaims(providerUser),
      (tx) => tx`select id from public.companies where tenant_id = ${tenantB}`,
    )
    expect(rows).toHaveLength(0)
  })

  it('exige una razon escrita de al menos 10 caracteres', async () => {
    await expect(
      sql`insert into regb.impersonation_log (provider_user, tenant_id, reason)
          values (${crypto.randomUUID()}, ${tenantA}, 'ver')`,
    ).rejects.toThrow()
  })

  it('impersonar es SOLO LECTURA: no puede escribir en el cliente', async () => {
    const other = crypto.randomUUID()
    await sql`
      insert into regb.impersonation_log (provider_user, tenant_id, reason)
      values (${other}, ${tenantB}, 'Revision de datos con consentimiento')`

    const rows = await as(
      providerClaims(other),
      (tx) =>
        tx`update public.companies set legal_name = 'CAMBIADO POR PROVEEDOR'
         where tenant_id = ${tenantB} returning id`,
    )
    expect(rows).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Cobertura de RLS — red de seguridad', () => {
  it('NINGUNA tabla de negocio esta sin RLS', async () => {
    const rows = await sql<{ schema_name: string; table_name: string }[]>`
      select schema_name, table_name
      from regb.rls_coverage
      where not rls_enabled
        and table_name <> 'schema_migrations'`
    expect(
      rows,
      `Tablas sin RLS: ${rows.map((r) => `${r.schema_name}.${r.table_name}`).join(', ')}`,
    ).toHaveLength(0)
  })

  it('NINGUNA tabla con RLS se quedo sin politica', async () => {
    const rows = await sql<{ schema_name: string; table_name: string }[]>`
      select schema_name, table_name
      from regb.rls_coverage
      where rls_enabled and policy_count = 0`
    expect(
      rows,
      `Tablas sin politica: ${rows.map((r) => `${r.schema_name}.${r.table_name}`).join(', ')}`,
    ).toHaveLength(0)
  })

  it('toda tabla de public tiene FORCE ROW LEVEL SECURITY', async () => {
    // Sin FORCE, el dueno de la tabla ignora las politicas y este test
    // completo pasaria en falso.
    const rows = await sql<{ table_name: string }[]>`
      select table_name from regb.rls_coverage
      where schema_name = 'public'
        and rls_enabled
        and not rls_forced`
    expect(rows, `Sin FORCE: ${rows.map((r) => r.table_name).join(', ')}`).toHaveLength(0)
  })
})
