#!/usr/bin/env node
/**
 * ¿Quedo bien la base del proyecto de Supabase? Solo LEE; no cambia nada.
 *
 *   pnpm db:verificar-supabase
 *
 * Es la lista de "como saber que quedo bien" de docs/SUPABASE.md en la
 * parte que se puede comprobar desde la base. Lo que vive en el panel de
 * Supabase (el hook encendido, el SMTP, las URL) no se ve desde aqui: para
 * eso esta /perfil y la invitacion de prueba de la guia.
 *
 * Sale con codigo 1 si algo falla, para poder ponerlo en un runbook.
 * Lee la conexion de `.env.local` de la raiz (scripts/entorno.mjs).
 */
import postgres from 'postgres'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)))

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (o DATABASE_URL_MIGRACIONES) en .env.local de la raiz.')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'prefer',
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
})

const resultados = []
async function revisar(nombre, fn) {
  try {
    const r = await fn()
    resultados.push({ nombre, ok: r.ok, detalle: r.detalle })
  } catch (e) {
    resultados.push({ nombre, ok: false, detalle: e.message })
  }
}

const archivos = readdirSync(join(RAIZ, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql'))

try {
  await revisar('Migraciones al dia', async () => {
    const existe = await sql`select to_regclass('regb.migraciones_aplicadas') is not null as ok`
    if (!existe[0].ok) return { ok: false, detalle: 'no hay libro: corre `pnpm db:migrar`' }
    const [{ n }] = await sql`select count(*)::int as n from regb.migraciones_aplicadas`
    return {
      ok: n >= archivos.length,
      detalle: `${n} aplicadas de ${archivos.length} en el repo${n < archivos.length ? ' — corre `pnpm db:migrar`' : ''}`,
    }
  })

  await revisar('El hook de token existe y Supabase Auth puede llamarlo', async () => {
    const [r] = await sql`
      select to_regprocedure('rls.custom_access_token_hook(jsonb)') is not null as existe,
             case when to_regprocedure('rls.custom_access_token_hook(jsonb)') is null then false
                  else has_function_privilege('supabase_auth_admin', 'rls.custom_access_token_hook(jsonb)', 'execute') end as auth,
             case when to_regprocedure('rls.custom_access_token_hook(jsonb)') is null then true
                  else has_function_privilege('authenticated', 'rls.custom_access_token_hook(jsonb)', 'execute') end as cliente`
    return {
      ok: r.existe && r.auth && !r.cliente,
      detalle: !r.existe
        ? 'falta rls.custom_access_token_hook: corre `pnpm db:migrar`'
        : !r.auth
          ? 'supabase_auth_admin no puede ejecutarlo (¿es un Supabase?)'
          : r.cliente
            ? 'PELIGRO: authenticated puede ejecutarlo y fabricarse claims'
            : 'rls.custom_access_token_hook — enciendelo en Authentication → Hooks',
    }
  })

  await revisar('El hook pone el cliente en el token', async () => {
    const [m] = await sql`
      select user_id from public.memberships where is_active and accepted_at is not null limit 1`
    if (!m)
      return {
        ok: true,
        detalle: 'todavia no hay membresias que probar (normal antes del primer alta)',
      }
    const [r] = await sql`
      select rls.custom_access_token_hook(
        jsonb_build_object('user_id', ${m.user_id}::text, 'claims', '{}'::jsonb)
      ) -> 'claims' -> 'app_metadata' as meta`
    const meta = r.meta ?? {}
    return {
      ok: Boolean(meta.tenant_id && meta.role_id),
      detalle: meta.tenant_id
        ? 'trae tenant_id y role_id'
        : `sin tenant_id: ${JSON.stringify(meta)}`,
    }
  })

  await revisar('El rol postgres puede actuar como usuario y como dueño', async () => {
    const [r] = await sql`
      select rolbypassrls as bypass, pg_has_role('postgres', 'authenticated', 'member') as miembro
      from pg_roles where rolname = 'postgres'`
    return {
      ok: r.bypass && r.miembro,
      detalle: `BYPASSRLS=${r.bypass}, miembro de authenticated=${r.miembro}`,
    }
  })

  await revisar('Toda tabla con RLS forzada y politica', async () => {
    const malas = await sql`
      select schema_name || '.' || table_name as t from regb.rls_coverage
      where not rls_enabled or not rls_forced or policy_count = 0`
    return {
      ok: malas.length === 0,
      detalle: malas.length ? malas.map((m) => m.t).join(', ') : 'regb.rls_coverage limpia',
    }
  })

  await revisar('Los REVOKE que sostienen la seguridad', async () => {
    const [r] = await sql`
      select has_column_privilege('authenticated', 'public.stock_levels', 'avg_cost', 'select') as costo,
             has_table_privilege('authenticated', 'regb.provider_users', 'select') as proveedores,
             has_table_privilege('anon', 'regb.provider_users', 'select') as proveedores_anon`
    const ok = !r.costo && !r.proveedores && !r.proveedores_anon
    return { ok, detalle: ok ? 'costo promedio y provider_users cerrados' : JSON.stringify(r) }
  })

  await revisar('Sin TRUNCATE para anon ni authenticated', async () => {
    const [{ n }] = await sql`
      select count(*)::int as n from pg_tables
      where schemaname in ('public', 'regb', 'audit')
        and (has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'truncate')
          or has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'truncate'))`
    return { ok: n === 0, detalle: n ? `${n} tabla(s) — falta la 0144` : 'ninguna' }
  })

  await revisar('Sin funciones de saldo abiertas sin sesion', async () => {
    const abiertas = await sql`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
        and p.proname not in ('invitacion_por_enlace', 'invitacion_enviada_por_enlace')
        and p.prorettype <> 'trigger'::regtype`
    return {
      ok: abiertas.length === 0,
      detalle: abiertas.length
        ? abiertas.map((a) => a.proname).join(', ')
        : 'solo las de la invitacion por enlace',
    }
  })

  await revisar('PostgREST respeta la suspension del cliente', async () => {
    const [r] =
      await sql`select rolconfig::text as cfg from pg_roles where rolname = 'authenticator'`
    const ok = /pgrst\.db_pre_request=rls\.aplicar_estado_de_cuenta/.test(r?.cfg ?? '')
    return {
      ok,
      detalle: ok
        ? 'pgrst.db_pre_request = rls.aplicar_estado_de_cuenta'
        : "falta: alter role authenticator set pgrst.db_pre_request = 'rls.aplicar_estado_de_cuenta'; notify pgrst, 'reload config';",
    }
  })

  await revisar('Hay al menos un usuario del proveedor', async () => {
    const [{ n }] = await sql`select count(*)::int as n from regb.provider_users where is_active`
    return {
      ok: n > 0,
      detalle: n ? `${n} activo(s)` : 'nadie entra a /control: `pnpm db:alta-proveedor`',
    }
  })

  await revisar('Particiones de la bitacora por delante', async () => {
    const [r] = await sql`
      select max(c.relname) as ultima from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'audit' and c.relname ~ '^log_[0-9]{4}_[0-9]{2}$'`
    const [a, m] = (r.ultima ?? 'log_0000_00').slice(4).split('_').map(Number)
    const hoy = new Date()
    const meses = (a - hoy.getUTCFullYear()) * 12 + (m - (hoy.getUTCMonth() + 1))
    return { ok: meses >= 12, detalle: `hasta ${r.ultima} (${meses} meses)` }
  })

  await revisar('Realtime sin tablas publicadas', async () => {
    const [{ n }] = await sql`
      select count(*)::int as n from pg_publication_tables where pubname = 'supabase_realtime'`
    return { ok: n === 0, detalle: n ? `${n} tabla(s) publicada(s)` : 'ninguna' }
  })

  await revisar('La base en UTC', async () => {
    const [{ timezone }] = await sql`select current_setting('timezone') as timezone`
    return { ok: /^(UTC|Etc\/UTC)$/.test(timezone), detalle: timezone }
  })
} finally {
  await sql.end()
}

let fallas = 0
for (const r of resultados) {
  if (!r.ok) fallas++
  console.log(`${r.ok ? '[ok]' : '[!!]'} ${r.nombre}${r.detalle ? ` — ${r.detalle}` : ''}`)
}
console.log(fallas ? `\n${fallas} cosa(s) por arreglar.` : '\nTodo en orden desde la base.')
process.exitCode = fallas ? 1 : 0
