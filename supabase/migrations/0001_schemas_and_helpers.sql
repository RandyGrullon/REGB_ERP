-- ═══════════════════════════════════════════════════════════════════════
--  0001 — Esquemas, roles y funciones helper de aislamiento
--
--  Todo el aislamiento multi-tenant de REGB descansa en las tres
--  funciones de este archivo. Si una de ellas es incorrecta, TODOS los
--  tenants quedan expuestos. Ver documento maestro §10.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Esquemas ───────────────────────────────────────────────────────────
create schema if not exists regb;   -- proveedor: tenants, precios, facturas
create schema if not exists audit;   -- log particionado por mes

comment on schema regb is
  'Datos del proveedor (Randy). Invisible para los clientes: toda tabla exige rls.is_provider().';
comment on schema audit is
  'Bitacora de auditoria particionada por mes. Escritura solo por trigger.';

-- ── Roles de Supabase (idempotente para CI con Postgres limpio) ────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- El esquema auth existe en Supabase; en CI lo creamos vacio.
create schema if not exists auth;

-- Esquema propio para las funciones de aislamiento (tenant_id, is_provider,
-- module_active, impersonating, custom_access_token_hook). NO viven en
-- `auth`: en un proyecto real de Supabase ese esquema es de
-- `supabase_admin` y `postgres` solo tiene USAGE, no CREATE -- crear algo
-- ahi falla con "permission denied for schema auth", descubierto al
-- desplegar contra un proyecto real por primera vez.
create schema if not exists rls;
comment on schema rls is
  'Funciones de aislamiento multi-tenant (tenant_id, module_active, etc). Vive aparte de auth porque ese esquema es de Supabase, no nuestro.';

grant usage on schema public to anon, authenticated;
grant usage on schema regb to authenticated;
grant usage on schema audit to authenticated;
grant usage on schema rls to anon, authenticated;
-- Sin esto, las politicas RLS no pueden invocar rls.tenant_id() ni
-- rls.module_active() y toda consulta muere con "permission denied for
-- schema auth". Supabase lo trae de fabrica; un Postgres limpio (CI) no.
--
-- En un proyecto real de Supabase, el rol `postgres` no es dueno del
-- esquema `auth` (lo es `supabase_auth_admin`) y no puede otorgar sobre
-- el: falla con "permission denied for schema auth" aunque el permiso ya
-- exista de fabrica. Se ignora ese error especifico -insufficient_privilege-
-- en vez de dejar que tumbe toda la migracion; en CI con Postgres limpio,
-- donde `postgres` SI es dueno, el grant se aplica normal.
do $$
begin
  execute 'grant usage on schema auth to anon, authenticated';
exception when insufficient_privilege then
  raise notice 'Sin permiso para otorgar sobre auth: se asume que Supabase ya lo dio de fabrica.';
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Helpers de aislamiento
--
--  `stable` (no `volatile`) para que el planner los evalue una sola vez
--  por query — critico para el rendimiento con RLS en tablas grandes.
--  `search_path = ''` evita escalada por manipulacion de search_path.
-- ═══════════════════════════════════════════════════════════════════════

-- El tenant SIEMPRE sale del JWT. Nunca del body, params ni searchParams.
create or replace function rls.tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'tenant_id',
    ''
  )::uuid
$$;

comment on function rls.tenant_id() is
  'Tenant del usuario actual, leido del JWT. Unica fuente valida de tenant_id.';

-- ¿Es un usuario del proveedor (REGB Control)?
create or replace function rls.is_provider()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'is_provider')::boolean,
    false
  )
$$;

comment on function rls.is_provider() is
  'True solo para usuarios de REGB Control. Puerta de entrada al esquema regb.';

-- Id del usuario actual (en CI, donde no existe el auth.uid() de Supabase).
create or replace function rls.regb_uid()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

-- ¿El modulo esta licenciado Y encendido para este tenant?
--
-- Esta es la diferencia entre "ocultar un boton" y seguridad real:
-- si el cliente no paga el modulo, la fila no existe para el, aunque
-- adivine la URL o llame al API directamente.
--
-- Referencia regb.tenant_modules, que se crea en 0002. Postgres valida el
-- cuerpo de las funciones SQL al crearlas, asi que diferimos la comprobacion
-- (mismo idioma que usa pg_dump para restaurar en orden arbitrario).
set local check_function_bodies = off;

create or replace function rls.module_active(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from regb.tenant_modules tm
    where tm.tenant_id = rls.tenant_id()
      and tm.module_id = p_module
      and tm.status in ('trial', 'active')
      and tm.enabled
  )
$$;

comment on function rls.module_active(text) is
  'True si el tenant tiene el modulo licenciado y encendido. Toda politica RLS de negocio debe invocarla.';

set local check_function_bodies = on;

-- Las funciones helper las invoca cada politica RLS, en cada query.
grant execute on function rls.tenant_id()          to anon, authenticated;
grant execute on function rls.is_provider()        to anon, authenticated;
grant execute on function rls.regb_uid()          to anon, authenticated;
grant execute on function rls.module_active(text)  to anon, authenticated;

-- ── Utilidad: updated_at automatico ────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
