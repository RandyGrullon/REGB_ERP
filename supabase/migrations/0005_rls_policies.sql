-- ═══════════════════════════════════════════════════════════════════════
--  0005 — Row Level Security
--
--  La pieza mas importante del proyecto. Documento maestro §10.
--
--  `force row level security` ademas de `enable`: sin FORCE, el dueno de
--  la tabla ignora las politicas y los tests de aislamiento pasarian en
--  falso. Es el error clasico que deja un producto multi-tenant abierto.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  ESQUEMA regb — SOLO el proveedor. Ningun cliente, jamas.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'tenants','subscriptions','module_catalog','module_pricing',
    'tenant_modules','usage_meters','invoices','onboarding','impersonation_log'
  ] loop
    execute format('alter table regb.%I enable row level security', t);
    execute format('alter table regb.%I force row level security', t);
    execute format(
      'create policy provider_only on regb.%I for all
         using (auth.is_provider()) with check (auth.is_provider())', t);
  end loop;
end $$;

-- Excepcion controlada: el cliente necesita ver SU catalogo y SUS modulos
-- para que el marketplace y el registry funcionen. Solo lectura, solo lo suyo.
create policy tenant_reads_own_modules on regb.tenant_modules
  for select
  using (tenant_id = auth.tenant_id());

create policy anyone_reads_published_catalog on regb.module_catalog
  for select
  using (is_published);

create policy anyone_reads_pricing on regb.module_pricing
  for select
  using (exists (
    select 1 from regb.module_catalog mc
    where mc.id = module_pricing.module_id and mc.is_published
  ));

-- El cliente ve sus propias facturas (portal de suscripcion). Nada mas.
create policy tenant_reads_own_invoices on regb.invoices
  for select
  using (tenant_id = auth.tenant_id());

-- ═══════════════════════════════════════════════════════════════════════
--  ESQUEMA public — aislamiento por tenant
--
--  PATRON CANONICO para tablas del CORE (siempre licenciadas):
--     using (tenant_id = auth.tenant_id())
--
--  PATRON CANONICO para tablas de un MODULO de negocio:
--     using (tenant_id = auth.tenant_id() and auth.module_active('<id>'))
--
--  El segundo es el que hace que un modulo apagado devuelva 403 y no datos,
--  aunque el usuario adivine la URL. Ver §8.3.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'companies','branches','roles','memberships','tour_progress','event_outbox'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on public.%I for all
         using (tenant_id = auth.tenant_id())
         with check (tenant_id = auth.tenant_id())', t);
  end loop;
end $$;

-- ── Impersonacion del proveedor ────────────────────────────────────────
--  Solo LECTURA, solo con sesion abierta, solo dentro de 60 minutos.
--  Documento maestro §7.4.
create or replace function auth.impersonating(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.is_provider() and exists (
    select 1
    from regb.impersonation_log il
    where il.tenant_id = p_tenant
      and il.provider_user = auth.regb_uid()
      and il.ended_at is null
      and il.started_at > now() - interval '60 minutes'
  )
$$;

comment on function auth.impersonating(uuid) is
  'Sesion de impersonacion abierta y vigente. Expira sola a los 60 minutos.';

do $$
declare t text;
begin
  foreach t in array array['companies','branches','roles','memberships','tour_progress'] loop
    execute format(
      'create policy provider_impersonation_read on public.%I for select
         using (auth.impersonating(tenant_id))', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  AUDITORIA — el tenant lee lo suyo; nadie modifica nada.
-- ═══════════════════════════════════════════════════════════════════════
alter table audit.log enable row level security;
alter table audit.log force row level security;

create policy tenant_reads_own_audit on audit.log
  for select
  using (tenant_id = auth.tenant_id() or auth.is_provider());

-- Sin politica de insert/update/delete: solo el trigger (security definer)
-- puede escribir. La bitacora es inmutable por diseno.

-- ═══════════════════════════════════════════════════════════════════════
--  GRANTS
--
--  `authenticated` NO es dueno de las tablas, asi que RLS le aplica.
--  Nunca otorgamos nada a `anon` sobre datos de negocio.
-- ═══════════════════════════════════════════════════════════════════════
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant select on regb.tenant_modules, regb.module_catalog,
                regb.module_pricing, regb.invoices to authenticated;
grant select, insert, update, delete on all tables in schema regb to authenticated;

grant select on audit.log to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  RED DE SEGURIDAD
--
--  Detecta tablas de negocio sin RLS. La usa /rls-audit (Fase 1 de la
--  skill) y el job de CI. Si devuelve una sola fila, la puerta no pasa.
-- ═══════════════════════════════════════════════════════════════════════
create or replace view regb.rls_coverage as
select
  n.nspname                                as schema_name,
  c.relname                                as table_name,
  c.relrowsecurity                         as rls_enabled,
  c.relforcerowsecurity                    as rls_forced,
  count(p.polname)                         as policy_count,
  bool_or(pg_get_expr(p.polqual, p.polrelid) like '%tenant_id%')   as has_tenant_check,
  bool_or(pg_get_expr(p.polqual, p.polrelid) like '%module_active%') as has_module_check
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where c.relkind = 'r'
  and n.nspname in ('public', 'regb', 'audit')
group by 1, 2, 3, 4;

comment on view regb.rls_coverage is
  'Cobertura de RLS por tabla. Toda fila con rls_enabled=false o policy_count=0 es un hallazgo CRITICO.';
