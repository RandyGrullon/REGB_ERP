/**
 * ═══════════════════════════════════════════════════════════════════════
 *  backup — el respaldo del cliente (0122)
 *
 *  Dos cosas distintas se prueban aqui:
 *
 *  1. Que la lista de tablas se DERIVA sola y no se queda atras. El
 *     respaldo viejo tenia seis tablas escritas a mano y nadie noto que
 *     faltaban las ventas. Ahora entra toda tabla de `public` con
 *     `tenant_id`; estas pruebas son la red para lo que la derivacion no
 *     sabe leer: una politica con una forma nueva, una tabla sin modulo,
 *     una columna que huele a credencial.
 *
 *  2. Aislamiento de `backup_parts` (regla del DBA: dos tenants, select,
 *     update y delete del ajeno en cero, y modulo apagado = ni lo propio).
 * ═══════════════════════════════════════════════════════════════════════
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
let tenantA: string
let tenantB: string
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let respaldoA: string

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
  const [a] = await sql<{ id: string }[]>`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`resp-a-${RUN}`}, 'Ferreteria El Martillo SRL', 'pyme', 'active') returning id`
  const [b] = await sql<{ id: string }[]>`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`resp-b-${RUN}`}, 'Farmacia Los Alcarrizos SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id
  // `products` y `backup` vienen de fabrica con cada cliente (modulos core).
  for (let i = 1; i <= 5; i++) {
    await sql`insert into public.products (tenant_id, sku, name)
              values (${tenantA}, ${`CLAVO-${i}-${RUN}`}, ${`Clavo de 2 pulgadas ${i} MARCA-A-${RUN}`})`
  }
  await sql`insert into public.products (tenant_id, sku, name)
            values (${tenantB}, ${`ACETA-${RUN}`}, ${`Acetaminofen 500 mg MARCA-B-${RUN}`})`

  const [r] = await as(claims(userA, tenantA), (tx) =>
    tx<{ id: string }[]>`select public.crear_respaldo(array['products'], 'manual', 2) as id`,
  )
  respaldoA = r!.id
})

afterAll(async () => {
  for (const t of [tenantA, tenantB]) {
    await sql`delete from public.event_outbox where tenant_id = ${t}`
    await sql`delete from audit.log where tenant_id = ${t}`
    await sql`delete from regb.tenants where id = ${t}`
  }
  await sql.end()
})

// ═══════════════════════════════════════════════════════════════════════
describe('la lista de tablas se deriva sola', () => {
  it('toda tabla de public con tenant_id esta en la lista, entre o no', async () => {
    const [conTenant] = await sql<{ n: number }[]>`
      select count(*)::int as n
      from information_schema.columns
      where table_schema = 'public' and column_name = 'tenant_id'
        and table_name in (select tablename from pg_tables where schemaname = 'public')`
    const [enLista] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.respaldo_tablas()`
    expect(enLista!.n).toBe(conTenant!.n)
  })

  it('las ventas, facturas, inventario y asientos entran por su modulo', async () => {
    const filas = await sql<{ tabla: string; modulos: string[]; motivo_fuera: string | null }[]>`
      select tabla, modulos, motivo_fuera from public.respaldo_tablas()
      where tabla in ('pos_sales','customer_invoices','inventory_movements',
                      'journal_entries','customers','suppliers','companies')
      order by tabla`
    const por = Object.fromEntries(filas.map((f) => [f.tabla, f]))
    expect(por.pos_sales!.modulos).toEqual(['pos'])
    expect(por.customer_invoices!.modulos).toEqual(['ar'])
    expect(por.inventory_movements!.modulos).toEqual(['inventory'])
    expect(por.journal_entries!.modulos).toEqual(['accounting'])
    // Tres politicas permisivas: basta cualquiera, igual que en la RLS.
    expect(por.customers!.modulos).toEqual(['ar', 'pos', 'sales-orders'])
    expect(por.suppliers!.modulos).toEqual(['ap', 'purchase-orders', 'suppliers'])
    expect(por.companies!.modulos).toEqual(['orgs'])
    for (const f of filas) expect(f.motivo_fuera).toBeNull()
  })

  it('NINGUNA tabla se queda sin modulo: si no se sabe de quien es, no se sabe quien la puede ver', async () => {
    const huerfanas = await sql<{ tabla: string }[]>`
      select tabla from public.respaldo_tablas()
      where motivo_fuera is null and cardinality(modulos) = 0`
    expect(
      huerfanas.map((h) => h.tabla),
      'Tablas sin modulo: dale una politica tenant_module o agregala al mapa sin_modulo de respaldo_tablas()',
    ).toEqual([])
  })

  it('toda politica de una tabla respaldada tiene una forma que el respaldo sabe leer', async () => {
    // El respaldo decide que tablas entran leyendo module_active() y
    // has_perm() de las politicas. Una condicion nueva que la derivacion
    // no conoce, la RLS la aplicaria en silencio y el archivo diria "0
    // filas" de una tabla que si tiene. Esta prueba la hace ruidosa.
    //
    // La unica condicion extra que se conoce es la PERSONAL (0125:
    // notifications): `user_id = rls.regb_uid()`. Se acepta solo si
    // respaldo_tablas() marca la tabla como `personal`, que es lo que hace
    // que el archivo lo diga.
    const pols = await sql<
      { tabla: string; politica: string; permisiva: boolean; personal: boolean; q: string }[]
    >`
      select c.relname::text as tabla, p.polname::text as politica,
             p.polpermissive as permisiva, r.personal,
             coalesce(pg_get_expr(p.polqual, p.polrelid), '') as q
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join public.respaldo_tablas() r on r.tabla = c.relname
      where r.motivo_fuera is null
        and p.polcmd in ('*', 'r')
        and p.polname !~ '^provider_'`
    expect(pols.length).toBeGreaterThan(100)

    const raras: string[] = []
    for (const p of pols) {
      const personal = p.q.includes('rls.regb_uid()')
      const resto = p.q
        .replace(/\(tenant_id = rls\.tenant_id\(\)\)/g, '')
        .replace(/rls\.module_active\('[a-z0-9-]+'::text\)/g, '')
        .replace(/rls\.has_perm\('[a-z0-9.*-]+'::text\)/g, '')
        .replace(/\(user_id = rls\.regb_uid\(\)\)/g, '')
        .replace(/\(user_id IS NULL\)/g, '')
        .replace(/\bAND\b|\bOR\b|[()\s]/g, '')
      if (
        !p.permisiva ||
        resto !== '' ||
        !p.q.includes('tenant_id = rls.tenant_id()') ||
        (personal && !p.personal)
      ) {
        raras.push(`${p.tabla}.${p.politica}: ${p.q}`)
      }
    }
    expect(raras).toEqual([])
  })

  it('una tabla personal entra marcada: el indice dice que solo trae las de quien lo pidio', async () => {
    const personales = await sql<{ tabla: string }[]>`
      select tabla from public.respaldo_tablas() where personal and motivo_fuera is null`
    for (const { tabla } of personales) {
      const [p] = await sql<{ q: string }[]>`
        select string_agg(pg_get_expr(p.polqual, p.polrelid), ' | ') as q
        from pg_policy p where p.polrelid = ${`public.${tabla}`}::regclass
          and p.polcmd in ('*', 'r') and p.polname !~ '^provider_'`
      expect(p!.q, tabla).toContain('rls.regb_uid()')
    }
    const [m] = await sql<{ personales: string[] }[]>`
      select payload -> 'personales' as personales from public.backups where id = ${respaldoA}`
    expect(Array.isArray(m!.personales)).toBe(true)
  })

  it('has_perm en una politica solo pide el .view de su propio modulo (el mismo que exige la accion)', async () => {
    const pols = await sql<{ tabla: string; q: string }[]>`
      select c.relname::text as tabla, pg_get_expr(p.polqual, p.polrelid) as q
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where pg_get_expr(p.polqual, p.polrelid) like '%has_perm%'`
    expect(pols.length).toBeGreaterThan(0)
    for (const p of pols) {
      const modulos = [...p.q.matchAll(/module_active\('([^']+)'/g)].map((m) => m[1])
      const perms = [...p.q.matchAll(/has_perm\('([^']+)'/g)].map((m) => m[1])
      for (const perm of perms) {
        expect(modulos.map((m) => `${m}.view`), `${p.tabla}: ${perm}`).toContain(perm)
      }
    }
  })

  it('ninguna columna con cara de credencial sale en claro sin decidirlo', async () => {
    // No son credenciales: el hash del documento firmado es la PRUEBA de
    // que se firmo -sin el, el respaldo no puede demostrar que se firmo-.
    const noSonCredencial = new Set(['signature_requests.signed_hash'])
    const cols = await sql<{ c: string }[]>`
      select table_name || '.' || column_name as c
      from information_schema.columns
      where table_schema = 'public'
        and column_name ~* '(secret|password|passwd|token|hash|private|api_?key)'
        and table_name in (select tabla from public.respaldo_tablas() where motivo_fuera is null)`
    const omitidas = new Set(
      (
        await sql<{ c: string }[]>`
          select tabla || '.' || columna as c from public.respaldo_columnas_omitidas()`
      ).map((r) => r.c),
    )
    const sueltas = cols.map((r) => r.c).filter((c) => !omitidas.has(c) && !noSonCredencial.has(c))
    expect(sueltas, 'Agregala a respaldo_columnas_omitidas() o justificala aqui').toEqual([])
    // Y las cuatro conocidas, por nombre.
    for (const c of [
      'webhook_endpoints.secret',
      'api_keys.key_hash',
      'portal_invites.token',
      'ecf_config.endpoint_token',
    ]) {
      expect(omitidas.has(c), c).toBe(true)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('crear_respaldo', () => {
  it('parte una tabla grande en trozos y no pierde filas', async () => {
    const partes = await sql<{ parte: number; filas: number }[]>`
      select parte, filas from public.backup_parts
      where backup_id = ${respaldoA} and tabla = 'products' order by parte`
    expect(partes).toEqual([
      { parte: 0, filas: 2 },
      { parte: 1, filas: 2 },
      { parte: 2, filas: 1 },
    ])
    const [m] = await sql<{ filas: number; productos: number }[]>`
      select (payload ->> 'filas')::int as filas,
             (payload -> 'tablas' ->> 'products')::int as productos
      from public.backups where id = ${respaldoA}`
    expect(m!.productos).toBe(5)
  })

  it('las partes son SOLO del cliente que lo pidio', async () => {
    const tenants = await sql<{ tenant_id: string }[]>`
      select distinct tenant_id from public.backup_parts where backup_id = ${respaldoA}`
    expect(tenants.map((t) => t.tenant_id)).toEqual([tenantA])

    const [t] = await sql<{ texto: string }[]>`
      select string_agg(datos::text, '') as texto from public.backup_parts
      where backup_id = ${respaldoA}`
    expect(t!.texto).toContain(`MARCA-A-${RUN}`)
    expect(t!.texto).not.toContain(`MARCA-B-${RUN}`)
    expect(t!.texto).not.toContain(tenantB)
  })

  it('sin tenant en la sesion no arma nada', async () => {
    await expect(
      as(JSON.stringify({ sub: userA, app_metadata: {} }), (tx) =>
        tx`select public.crear_respaldo(array['products'])`,
      ),
    ).rejects.toThrow(/tenant/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('aislamiento de backup_parts', () => {
  it('B no ve, no cambia y no borra las partes de A', async () => {
    const [vistas, cambiadas, borradas, cabecera] = await as(claims(userB, tenantB), async (tx) => [
      await tx`select 1 from public.backup_parts where backup_id = ${respaldoA}`,
      await tx`update public.backup_parts set datos = '[]'::jsonb
               where backup_id = ${respaldoA} returning 1`,
      await tx`delete from public.backup_parts where backup_id = ${respaldoA} returning 1`,
      await tx`select 1 from public.backups where id = ${respaldoA}`,
    ])
    expect(vistas).toHaveLength(0)
    expect(cambiadas).toHaveLength(0)
    expect(borradas).toHaveLength(0)
    expect(cabecera).toHaveLength(0)

    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.backup_parts where backup_id = ${respaldoA}`
    expect(n!.n).toBeGreaterThan(0)
  })

  it('B no puede colgar una parte suya del respaldo de A (llave compuesta con tenant)', async () => {
    await expect(
      as(claims(userB, tenantB), (tx) =>
        tx`insert into public.backup_parts (tenant_id, backup_id, tabla, parte, filas, datos, size_bytes)
           values (${tenantB}, ${respaldoA}, 'products', 99, 1, '[{"sku":"falso"}]'::jsonb, 17)`,
      ),
    ).rejects.toThrow()
  })

  it('con el modulo backup apagado, A tampoco ve sus propias partes', async () => {
    await sql`update regb.tenant_modules set enabled = false
              where tenant_id = ${tenantA} and module_id = 'backup'`
    try {
      const vistas = await as(claims(userA, tenantA), (tx) =>
        tx`select 1 from public.backup_parts where backup_id = ${respaldoA}`,
      )
      expect(vistas).toHaveLength(0)
      await expect(
        as(claims(userA, tenantA), (tx) => tx`select public.crear_respaldo(array['products'])`),
      ).rejects.toThrow()
    } finally {
      await sql`update regb.tenant_modules set enabled = true
                where tenant_id = ${tenantA} and module_id = 'backup'`
    }
  })
})
