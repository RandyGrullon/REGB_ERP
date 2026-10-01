-- ═══════════════════════════════════════════════════════════════════════
--  0144 — Lo que Supabase da de fabrica y el Postgres de pruebas no
--
--  Encontrado aplicando las 142 migraciones a un Supabase real (el stack
--  local de la CLI 2.109, Postgres 17) y comparando privilegio por
--  privilegio con `regb_test`. Los SELECT/INSERT/UPDATE/DELETE de `anon` y
--  `authenticated` quedaron IDENTICOS en las dos bases; lo que no:
--
--  1. TRUNCATE, REFERENCES, TRIGGER (y MAINTAIN en 17) para `anon` y
--     `authenticated` en las 203 tablas de `public`. Salen de los
--     privilegios por defecto que Supabase deja al rol `postgres` en
--     `public` (`Dxtm`). En `regb_test` no existen.
--
--     TRUNCATE no pasa por la RLS: vacia la tabla de TODOS los clientes.
--     Hoy nadie puede escribir ese SQL -PostgREST no tiene TRUNCATE y la
--     web solo corre SQL propio dentro de `asUser()`-, pero es exactamente
--     el tipo de puerta que convierte un error menor (una inyeccion en una
--     sola consulta) en perder los datos de 500 clientes. MAINTAIN deja
--     hacer LOCK TABLE: una persona bloquea la tabla de ventas de todos.
--     Nada de la app los usa (grep: ni TRUNCATE, ni LOCK, ni vistas
--     materializadas), asi que se quitan.
--
--  2. El libro de migraciones (`regb.migraciones_aplicadas`) nace sin RLS
--     -lo crea `scripts/aplicar-migraciones.mjs` antes de la 0001- y el
--     `grant ... on all tables in schema regb to authenticated` de 0005 le
--     dio lectura y escritura a cualquier usuario de un cliente. Hallazgo
--     que docs/defi-v1.md §4.4 dejo "a verificar": verificado, pasaba.
--     Borrar una fila de ahi hace que la siguiente corrida REPITA esa
--     migracion.
--
--  Nada de esto cambia lo que ve o hace un usuario: solo quita lo que
--  sobraba. En `regb_test` es casi todo un no-op.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Privilegios que no usa nadie ─────────────────────────────────────
do $$
declare
  v_extra text := 'truncate, references, trigger'
    || case when current_setting('server_version_num')::int >= 170000 then ', maintain' else '' end;
  v_esquema text;
begin
  foreach v_esquema in array array['public', 'regb', 'audit'] loop
    execute format('revoke %s on all tables in schema %I from anon, authenticated', v_extra, v_esquema);
  end loop;

  -- Las tablas que se creen despues: Supabase se los vuelve a dar a cada
  -- tabla nueva de `public` si no se quitan tambien del "por defecto".
  execute format(
    'alter default privileges for role postgres in schema public revoke %s on tables from anon, authenticated',
    v_extra);
exception when insufficient_privilege then
  raise notice 'Sin permiso para quitar privilegios por defecto: revisa \ddp en el SQL Editor.';
end $$;

-- ── 2. El libro de migraciones, solo para el proveedor ─────────────────
do $$
begin
  if to_regclass('regb.migraciones_aplicadas') is not null then
    alter table regb.migraciones_aplicadas enable row level security;
    alter table regb.migraciones_aplicadas force row level security;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'regb' and tablename = 'migraciones_aplicadas' and policyname = 'provider_only'
    ) then
      create policy provider_only on regb.migraciones_aplicadas
        for select using (rls.is_provider());
    end if;
    -- Ni los usuarios de un cliente ni el proveedor desde la app lo
    -- escriben: solo el script, que conecta como dueño.
    revoke all on regb.migraciones_aplicadas from anon, authenticated;
    grant select on regb.migraciones_aplicadas to authenticated;
    comment on table regb.migraciones_aplicadas is
      'Libro de scripts/aplicar-migraciones.mjs (nombre + sha256 del archivo). Solo lo escribe el script como dueño; lectura solo proveedor (0144).';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Vuelta atras (down): no hay nada que devolver en la practica. Si hiciera
--  falta: `grant truncate, references, trigger[, maintain] on all tables in
--  schema public to anon, authenticated`, lo mismo en el "por defecto", y
--  `alter table regb.migraciones_aplicadas disable row level security`.
-- ═══════════════════════════════════════════════════════════════════════
