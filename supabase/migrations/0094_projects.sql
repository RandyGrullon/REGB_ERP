-- ═══════════════════════════════════════════════════════════════════════
--  0094 — Proyectos & Tareas (modulo 71, F10/S67)
--
--  Primer modulo de F10: abrir nichos nuevos sin construir un
--  producto nuevo. `projects` es generico -no un vertical-, por eso
--  no le aplica la "regla de oro" de §12.1 (que exige un cliente
--  pagando antes de publicar un vertical como restaurant/clinic/etc).
--
--  Una tarea no puede avanzar a "en curso" o "hecha" si alguna de sus
--  dependencias todavia no esta hecha -puedeAvanzarPorDependencias()
--  en @regb/operations, verificado aqui con un trigger real, no solo
--  en la UI-.
--
--  Deliberadamente SIN requires (recomienda `timesheets`): un tablero
--  de tareas es util sin registrar horas.
-- ═══════════════════════════════════════════════════════════════════════

create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  name         text not null,
  description  text,
  status       text not null default 'planning'
                 check (status in ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  start_date   date,
  end_date     date,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index on public.projects (tenant_id, status);

create table public.project_tasks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null,
  description  text,
  status       text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'blocked')),
  assigned_to  uuid,
  due_date     date,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on public.project_tasks (tenant_id, project_id, status, position);

create table public.task_dependencies (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references regb.tenants(id) on delete cascade,
  task_id               uuid not null references public.project_tasks(id) on delete cascade,
  depends_on_task_id    uuid not null references public.project_tasks(id) on delete cascade,
  created_at            timestamptz not null default now(),
  unique (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create index on public.task_dependencies (tenant_id, task_id);

-- Un hito (milestone) es una fecha del proyecto que se marca cumplida
-- o no -hitoVigente() reutiliza certificadoVigente() de training.ts,
-- novena vez que esa funcion se reusa en el proyecto-.
create table public.project_milestones (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text not null,
  due_date      date not null,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index on public.project_milestones (tenant_id, project_id, due_date);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.projects enable row level security;
alter table public.projects force row level security;
alter table public.project_tasks enable row level security;
alter table public.project_tasks force row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_dependencies force row level security;
alter table public.project_milestones enable row level security;
alter table public.project_milestones force row level security;

create policy tenant_module on public.projects for all
  using (tenant_id = rls.tenant_id() and rls.module_active('projects'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('projects'));
create policy provider_impersonating on public.projects for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.project_tasks for all
  using (tenant_id = rls.tenant_id() and rls.module_active('projects'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('projects'));
create policy provider_impersonating on public.project_tasks for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.task_dependencies for all
  using (tenant_id = rls.tenant_id() and rls.module_active('projects'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('projects'));
create policy provider_impersonating on public.task_dependencies for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.project_milestones for all
  using (tenant_id = rls.tenant_id() and rls.module_active('projects'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('projects'));
create policy provider_impersonating on public.project_milestones for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_proyecto_ajeno_tarea() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.projects where id = new.project_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese proyecto no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_proyecto_ajeno_tarea
  before insert on public.project_tasks
  for each row execute function public.impedir_proyecto_ajeno_tarea();

create trigger no_proyecto_ajeno_hito
  before insert on public.project_milestones
  for each row execute function public.impedir_proyecto_ajeno_tarea();

create function public.impedir_tarea_ajena_dependencia() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_tarea uuid;
  v_tenant_dependencia uuid;
begin
  select tenant_id into v_tenant_tarea from public.project_tasks where id = new.task_id;
  select tenant_id into v_tenant_dependencia from public.project_tasks where id = new.depends_on_task_id;
  if v_tenant_tarea is distinct from new.tenant_id or v_tenant_dependencia is distinct from new.tenant_id then
    raise exception 'Esa tarea no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_tarea_ajena_dependencia
  before insert on public.task_dependencies
  for each row execute function public.impedir_tarea_ajena_dependencia();

-- ── Una tarea no avanza a en curso/hecha con dependencias sin cerrar ────
create function public.impedir_avance_con_dependencias_abiertas() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pendientes integer;
begin
  if new.status in ('in_progress', 'done') and new.status is distinct from old.status then
    select count(*) into v_pendientes
    from public.task_dependencies td
    join public.project_tasks pt on pt.id = td.depends_on_task_id
    where td.task_id = new.id and pt.status <> 'done';
    if v_pendientes > 0 then
      raise exception 'Esa tarea tiene % dependencia(s) sin terminar.', v_pendientes using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_avance_con_dependencias_abiertas
  before update on public.project_tasks
  for each row execute function public.impedir_avance_con_dependencias_abiertas();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.projects
  for each row execute function audit.record('projects');
create trigger audit_me after insert or update on public.project_tasks
  for each row execute function audit.record('projects');
create trigger audit_me after insert on public.task_dependencies
  for each row execute function audit.record('projects');
create trigger audit_me after insert or update on public.project_milestones
  for each row execute function audit.record('projects');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Una dependencia sin terminar bloquea el avance de verdad, no solo en la pantalla',
    problem      = 'Sin un tablero real, las tareas de un proyecto se coordinan por memoria o por una hoja de calculo que nadie actualiza, y las dependencias entre tareas se rompen sin que nadie se de cuenta.',
    features     = '[
      {"titulo":"Dependencias que de verdad bloquean","detalle":"Una tarea no puede marcarse en curso o hecha si alguna de sus dependencias sigue abierta -lo exige un trigger de base de datos, no solo la pantalla-."},
      {"titulo":"Hitos con la misma vigencia que un certificado","detalle":"Un hito vencido se calcula con la misma logica que ya usan un certificado de capacitacion o una licencia de flota."},
      {"titulo":"Un tablero por proyecto, no una hoja de calculo suelta","detalle":"Cada tarea vive en el proyecto correcto -nunca se puede colar en un proyecto ajeno-."}
    ]'::jsonb,
    audience     = '{"Cualquier equipo que hoy coordina tareas con dependencias por una hoja de calculo o por memoria"}',
    faq          = '[
      {"p":"¿Necesito el modulo de hojas de tiempo para usar proyectos?","r":"No -un tablero de tareas es util por su cuenta, aunque se complementa con timesheets si necesitas registrar horas-."},
      {"p":"¿Puedo marcar una tarea como hecha si su dependencia no lo esta?","r":"No -un trigger de base de datos lo impide, no solo un aviso en la pantalla-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'projects';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'projects'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'projects no tiene precio en los 3 tiers';
  end if;
end $$;
