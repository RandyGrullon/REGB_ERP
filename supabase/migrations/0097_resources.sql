-- ═══════════════════════════════════════════════════════════════════════
--  0097 — Planificacion de recursos (modulo 75, F10/S68)
--
--  Requiere `projects` de verdad: una asignacion es de una tarea real.
--
--  La sobrecarga NO se guarda como bandera: se deriva sumando las horas
--  asignadas de la semana contra la capacidad -mismo criterio que el
--  margen en `project-costing` o el saldo de puntos en `loyalty`-.
--  Asignar EXACTAMENTE la capacidad no es sobrecarga: es una semana
--  llena, que es distinto de una imposible (`estaSobrecargado()` usa
--  mayor estricto).
-- ═══════════════════════════════════════════════════════════════════════

create table public.resource_capacity (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  user_id        uuid not null,
  week_start     date not null,
  hours_capacity numeric(6,2) not null default 40 check (hours_capacity >= 0 and hours_capacity <= 168),
  created_at     timestamptz not null default now(),
  unique (tenant_id, user_id, week_start)
);

create index on public.resource_capacity (tenant_id, week_start);

create table public.resource_allocations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  task_id       uuid not null references public.project_tasks(id) on delete cascade,
  user_id       uuid not null,
  week_start    date not null,
  hours         numeric(6,2) not null check (hours > 0 and hours <= 168),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, task_id, user_id, week_start)
);

create index on public.resource_allocations (tenant_id, user_id, week_start);

-- ── Las horas asignadas se DERIVAN, nunca se guardan agregadas ──────────
create function public.resource_allocated_hours(p_tenant uuid, p_user uuid, p_week date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(hours), 0)
  from public.resource_allocations
  where tenant_id = p_tenant and user_id = p_user and week_start = p_week;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.resource_capacity enable row level security;
alter table public.resource_capacity force row level security;
alter table public.resource_allocations enable row level security;
alter table public.resource_allocations force row level security;

create policy tenant_module on public.resource_capacity for all
  using (tenant_id = rls.tenant_id() and rls.module_active('resources'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('resources'));
create policy provider_impersonating on public.resource_capacity for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.resource_allocations for all
  using (tenant_id = rls.tenant_id() and rls.module_active('resources'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('resources'));
create policy provider_impersonating on public.resource_allocations for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_tarea_ajena_asignacion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.project_tasks where id = new.task_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa tarea no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_tarea_ajena_asignacion
  before insert on public.resource_allocations
  for each row execute function public.impedir_tarea_ajena_asignacion();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.resource_capacity
  for each row execute function audit.record('resources');
create trigger audit_me after insert or update on public.resource_allocations
  for each row execute function audit.record('resources');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Llenar la capacidad exacta no es sobrecarga: una semana llena no es una imposible',
    problem      = 'Sin un calendario de capacidad, la misma persona termina comprometida en tres proyectos a la vez y nadie lo nota hasta que algo se cae.',
    features     = '[
      {"titulo":"La sobrecarga se calcula, no se marca a mano","detalle":"Se suman las horas asignadas de la semana contra la capacidad de esa persona -nadie tiene que acordarse de levantar una bandera-."},
      {"titulo":"Capacidad por semana y por persona","detalle":"Las semanas no son todas de 40 horas: vacaciones, medio tiempo y feriados se reflejan en la capacidad real de esa semana."},
      {"titulo":"Asignaciones sobre tareas reales","detalle":"Cada asignacion apunta a una tarea real del modulo de proyectos, con FK autentica."}
    ]'::jsonb,
    audience     = '{"Equipos de servicio o construccion que reparten a las mismas personas entre varios proyectos"}',
    faq          = '[
      {"p":"¿Asignar exactamente 40 horas cuenta como sobrecarga?","r":"No -eso es una semana llena; la sobrecarga empieza al pasarse, no al llenarse-."},
      {"p":"¿Necesito hojas de tiempo para planificar recursos?","r":"No -planificar es a futuro, registrar horas es a pasado; se complementan pero son independientes-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'resources';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'resources'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'resources no tiene precio en los 3 tiers';
  end if;
end $$;
