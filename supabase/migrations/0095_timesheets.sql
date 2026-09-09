-- ═══════════════════════════════════════════════════════════════════════
--  0095 — Hojas de tiempo (modulo 72, F10/S67)
--
--  Requiere `projects` de verdad (regb.module_catalog: requires
--  '{projects}'): cada registro de tiempo es sobre una tarea real,
--  con una FK autentica, no un texto libre sin respaldo.
-- ═══════════════════════════════════════════════════════════════════════

create table public.time_entries (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  task_id       uuid not null references public.project_tasks(id),
  user_id       uuid not null,
  entry_date    date not null,
  hours         numeric(6,2) not null check (hours > 0 and hours <= 24),
  billable      boolean not null default true,
  hourly_rate   numeric(10,2) not null default 0 check (hourly_rate >= 0),
  status        text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  notes         text,
  approved_by   uuid,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.time_entries (tenant_id, task_id);
create index on public.time_entries (tenant_id, user_id, entry_date);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.time_entries enable row level security;
alter table public.time_entries force row level security;

create policy tenant_module on public.time_entries for all
  using (tenant_id = rls.tenant_id() and rls.module_active('timesheets'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('timesheets'));
create policy provider_impersonating on public.time_entries for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_tarea_ajena_registro() returns trigger
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

create trigger no_tarea_ajena_registro
  before insert on public.time_entries
  for each row execute function public.impedir_tarea_ajena_registro();

-- ── Inmutabilidad: aprobado es terminal -rechazado se corrige y reenvia-
create function public.impedir_editar_registro_aprobado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'approved' then
    raise exception 'Ese registro ya se aprobo y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_registro_aprobado
  before update or delete on public.time_entries
  for each row execute function public.impedir_editar_registro_aprobado();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.time_entries
  for each row execute function audit.record('timesheets');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Un registro rechazado se corrige y se reenvia; uno aprobado es terminal de verdad',
    problem      = 'Sin un registro formal por tarea, nadie puede saber cuantas horas reales tomo un proyecto ni facturarlas con confianza al cliente.',
    features     = '[
      {"titulo":"Por tarea real, no una lista suelta","detalle":"Cada registro de tiempo apunta a una tarea real del modulo de proyectos -una FK autentica, no un texto libre-."},
      {"titulo":"Rechazado no es el final","detalle":"Un registro rechazado se puede corregir y reenviar -solo aprobado es terminal de verdad-."},
      {"titulo":"Facturable o no, por registro","detalle":"Cada registro decide si cuenta para facturar al cliente, con su propia tarifa por hora."}
    ]'::jsonb,
    audience     = '{"Cualquier equipo que factura por horas y hoy no tiene un registro formal por tarea"}',
    faq          = '[
      {"p":"¿Necesito cuentas por cobrar para usar hojas de tiempo?","r":"No -se recomienda ar para facturar las horas aprobadas, pero el registro y la aprobacion funcionan sin ese modulo-."},
      {"p":"¿Se puede editar un registro ya aprobado?","r":"No -aprobado es terminal de verdad; uno rechazado si se puede corregir y reenviar-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'timesheets';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'timesheets'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'timesheets no tiene precio en los 3 tiers';
  end if;
end $$;
