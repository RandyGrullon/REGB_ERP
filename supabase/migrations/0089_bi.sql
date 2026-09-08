-- ═══════════════════════════════════════════════════════════════════════
--  0089 — BI & Reportes (modulo 87, F9/S61-62)
--
--  Deliberadamente NO acepta SQL libre de un tenant: eso seria una
--  puerta abierta a inyeccion y a fugas entre tenants. El "constructor
--  visual" en realidad elige entre un CATALOGO FIJO de fuentes ya
--  vetadas (`source_key` con `check` explicito) -cada una es una
--  consulta parametrizada ya escrita en la capa de aplicacion, no una
--  cadena de texto que el tenant pueda cambiar-. Igual que cualquier
--  otra tabla, cada fuente ya respeta RLS y `module_active()` de las
--  tablas que consulta por debajo -si `crm` no esta activo,
--  `leads_by_status` simplemente no devuelve filas, el mismo criterio
--  que ya usan los widgets del dashboard-.
--
--  Deliberadamente SIN requires (regb.module_catalog: requires '{}',
--  recommends '{}'): reportar sobre lo que YA existe no depende de
--  ningun modulo en particular.
-- ═══════════════════════════════════════════════════════════════════════

create table public.report_definitions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  name        text not null,
  source_key  text not null check (source_key in ('sales_by_day', 'top_products', 'overdue_invoices', 'leads_by_status', 'tickets_by_priority')),
  params      jsonb not null default '{}'::jsonb,
  chart_type  text not null default 'table' check (chart_type in ('table', 'bar', 'line')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on public.report_definitions (tenant_id, source_key);

create table public.dashboards (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  name        text not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.dashboard_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  dashboard_id  uuid not null references public.dashboards(id) on delete cascade,
  report_id     uuid not null references public.report_definitions(id) on delete cascade,
  position      integer not null check (position >= 0),
  unique (dashboard_id, position)
);

create index on public.dashboard_items (tenant_id, dashboard_id);

create table public.scheduled_exports (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  report_id    uuid not null references public.report_definitions(id) on delete cascade,
  frequency    text not null check (frequency in ('daily', 'weekly', 'monthly')),
  recipients   text not null,
  status       text not null default 'active' check (status in ('active', 'paused')),
  next_run_at  timestamptz not null,
  last_run_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index on public.scheduled_exports (tenant_id, status, next_run_at);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.report_definitions enable row level security;
alter table public.report_definitions force row level security;
alter table public.dashboards enable row level security;
alter table public.dashboards force row level security;
alter table public.dashboard_items enable row level security;
alter table public.dashboard_items force row level security;
alter table public.scheduled_exports enable row level security;
alter table public.scheduled_exports force row level security;

create policy tenant_module on public.report_definitions for all
  using (tenant_id = rls.tenant_id() and rls.module_active('bi'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('bi'));
create policy provider_impersonating on public.report_definitions for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.dashboards for all
  using (tenant_id = rls.tenant_id() and rls.module_active('bi'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('bi'));
create policy provider_impersonating on public.dashboards for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.dashboard_items for all
  using (tenant_id = rls.tenant_id() and rls.module_active('bi'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('bi'));
create policy provider_impersonating on public.dashboard_items for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.scheduled_exports for all
  using (tenant_id = rls.tenant_id() and rls.module_active('bi'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('bi'));
create policy provider_impersonating on public.scheduled_exports for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_reporte_ajeno_item() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_dashboard uuid;
  v_tenant_reporte uuid;
begin
  select tenant_id into v_tenant_dashboard from public.dashboards where id = new.dashboard_id;
  select tenant_id into v_tenant_reporte from public.report_definitions where id = new.report_id;
  if v_tenant_dashboard is distinct from new.tenant_id or v_tenant_reporte is distinct from new.tenant_id then
    raise exception 'Ese reporte o ese dashboard no pertenecen a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_reporte_ajeno_item
  before insert on public.dashboard_items
  for each row execute function public.impedir_reporte_ajeno_item();

create function public.impedir_reporte_ajeno_export() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.report_definitions where id = new.report_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese reporte no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_reporte_ajeno_export
  before insert on public.scheduled_exports
  for each row execute function public.impedir_reporte_ajeno_export();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.report_definitions
  for each row execute function audit.record('bi');
create trigger audit_me after insert or update on public.dashboards
  for each row execute function audit.record('bi');
create trigger audit_me after insert on public.dashboard_items
  for each row execute function audit.record('bi');
create trigger audit_me after insert or update on public.scheduled_exports
  for each row execute function audit.record('bi');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Un catalogo fijo de reportes ya vetados, no una consola SQL abierta',
    problem      = 'Sin un lugar central para ver los numeros del negocio, cada gerente arma su propio reporte en una hoja de calculo aparte, y nadie mas confia en esos numeros.',
    features     = '[
      {"titulo":"Elegir, no escribir SQL","detalle":"El constructor visual elige entre un catalogo fijo de reportes ya vetados -nunca acepta una consulta libre que pudiera filtrar datos de otro cliente-."},
      {"titulo":"Dashboards armados con lo que ya existe","detalle":"Un dashboard agrupa reportes guardados en una sola pantalla, sin duplicar ninguna logica de consulta."},
      {"titulo":"Export programado, honesto sobre el envio","detalle":"Un export se puede programar por frecuencia -diaria, semanal, mensual-, aunque el envio real por correo todavia no esta conectado."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio donde los reportes hoy viven en hojas de calculo sueltas que nadie mas puede verificar"}',
    faq          = '[
      {"p":"¿Puedo escribir mi propia consulta SQL?","r":"No -el constructor elige entre un catalogo fijo de reportes ya vetados, para nunca arriesgar una fuga de datos entre clientes-."},
      {"p":"¿El export programado me manda el correo de verdad?","r":"Todavia no -registra el calendario y la ultima ejecucion, pero el envio real por correo no esta conectado-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'bi';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'bi'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'bi no tiene precio en los 3 tiers';
  end if;
end $$;
