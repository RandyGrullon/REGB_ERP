-- ═══════════════════════════════════════════════════════════════════════
--  0096 — Costeo de proyectos (modulo 73, F10/S68)
--
--  Requiere `projects` de verdad (regb.module_catalog: requires
--  '{projects}'): un presupuesto es de un proyecto real, con FK
--  autentica.
--
--  El margen, la desviacion y el WIP NO se guardan: se derivan de las
--  lineas de presupuesto y de los costos reales -mismo criterio que
--  `loyalty_balance()` con los puntos y `bank_account_balance()` con
--  el saldo-. Un numero guardado se desincroniza; uno derivado no
--  puede.
-- ═══════════════════════════════════════════════════════════════════════

create table public.project_budgets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  concept      text not null,
  category     text not null default 'general'
                 check (category in ('general', 'labor', 'materials', 'equipment', 'subcontract')),
  amount       numeric(14,2) not null check (amount >= 0),
  created_by   uuid,
  created_at   timestamptz not null default now()
);

create index on public.project_budgets (tenant_id, project_id);

-- Un costo real es un hecho historico: inmutable desde el insert, igual
-- que un movimiento de inventario o una transaccion de puntos.
create table public.project_costs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  budget_id     uuid references public.project_budgets(id),
  concept       text not null,
  amount        numeric(14,2) not null check (amount > 0),
  incurred_on   date not null default current_date,
  billed        boolean not null default false,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create index on public.project_costs (tenant_id, project_id, incurred_on desc);

-- ── El presupuesto y lo gastado se DERIVAN, nunca se guardan ────────────
create function public.project_budget_total(p_project uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.project_budgets where project_id = p_project;
$$;

create function public.project_cost_total(p_project uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.project_costs where project_id = p_project;
$$;

/* Lo gastado que todavia no se ha facturado: el WIP del proyecto. */
create function public.project_wip(p_project uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount) filter (where not billed), 0) from public.project_costs where project_id = p_project;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.project_budgets enable row level security;
alter table public.project_budgets force row level security;
alter table public.project_costs enable row level security;
alter table public.project_costs force row level security;

create policy tenant_module on public.project_budgets for all
  using (tenant_id = rls.tenant_id() and rls.module_active('project-costing'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('project-costing'));
create policy provider_impersonating on public.project_budgets for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.project_costs for all
  using (tenant_id = rls.tenant_id() and rls.module_active('project-costing'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('project-costing'));
create policy provider_impersonating on public.project_costs for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_proyecto_ajeno_presupuesto() returns trigger
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

create trigger no_proyecto_ajeno_presupuesto
  before insert on public.project_budgets
  for each row execute function public.impedir_proyecto_ajeno_presupuesto();

create function public.impedir_referencia_ajena_costo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_proyecto uuid;
  v_tenant_partida uuid;
begin
  select tenant_id into v_tenant_proyecto from public.projects where id = new.project_id;
  if v_tenant_proyecto is distinct from new.tenant_id then
    raise exception 'Ese proyecto no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  if new.budget_id is not null then
    select tenant_id into v_tenant_partida from public.project_budgets where id = new.budget_id;
    if v_tenant_partida is distinct from new.tenant_id then
      raise exception 'Esa partida no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_referencia_ajena_costo
  before insert on public.project_costs
  for each row execute function public.impedir_referencia_ajena_costo();

-- ── Inmutabilidad: un costo incurrido es un hecho historico ─────────────
create function public.impedir_editar_costo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Marcar como facturado SI se permite: es informacion nueva sobre el
  -- mismo hecho, no una correccion del monto ni de la fecha.
  if tg_op = 'DELETE' then
    raise exception 'Un costo ya registrado no se borra.' using errcode = '55000';
  end if;
  if new.amount is distinct from old.amount
     or new.incurred_on is distinct from old.incurred_on
     or new.project_id is distinct from old.project_id then
    raise exception 'Un costo ya registrado no cambia de monto, fecha ni proyecto.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger no_editar_costo
  before update or delete on public.project_costs
  for each row execute function public.impedir_editar_costo();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.project_budgets
  for each row execute function audit.record('project-costing');
create trigger audit_me after insert or update on public.project_costs
  for each row execute function audit.record('project-costing');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'El margen y el WIP se derivan del historial, nunca se guardan como un numero que se desincroniza',
    problem      = 'Sin costeo por proyecto, el margen real solo se sabe al final -cuando ya no se puede hacer nada- y el trabajo hecho sin facturar es invisible.',
    features     = '[
      {"titulo":"Presupuesto contra real, sin numeros guardados","detalle":"El total presupuestado, lo gastado y el WIP se suman del historial cada vez -el mismo criterio que el saldo de una cuenta bancaria-."},
      {"titulo":"Un costo incurrido no se reescribe","detalle":"Se puede marcar como facturado -eso es informacion nueva-, pero el monto, la fecha y el proyecto quedan fijos."},
      {"titulo":"Margen honesto cuando no hay presupuesto","detalle":"Sin presupuesto contra que comparar el margen es null, no cero: es -todavia no hay dato-, no -no hay margen-."}
    ]'::jsonb,
    audience     = '{"Constructoras, talleres y agencias que cobran por proyecto y hoy solo saben el margen al final"}',
    faq          = '[
      {"p":"¿Necesito contabilidad para usar costeo de proyectos?","r":"No -se recomienda accounting para cruzarlo con los asientos, pero el presupuesto contra real funciona sin ese modulo-."},
      {"p":"¿Puedo corregir un costo mal digitado?","r":"No se edita el monto ni la fecha -es un hecho historico-; se registra el ajuste como un costo nuevo, igual que en inventario."}
    ]'::jsonb,
    setup_minutes = 20
where id = 'project-costing';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'project-costing'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'project-costing no tiene precio en los 3 tiers';
  end if;
end $$;
