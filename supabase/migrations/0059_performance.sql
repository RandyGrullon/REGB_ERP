-- ═══════════════════════════════════════════════════════════════════════
--  0059 — Desempeno (modulo 66, F7/S42)
--
--  El progreso de un resultado clave y de un objetivo NUNCA se guarda:
--  se deriva siempre del valor actual contra la meta
--  (progresoResultadoClave()/progresoObjetivo() en @regb/operations),
--  mismo principio que el saldo de vacaciones o el saldo de un prestamo.
--
--  Objetivos, resultados clave y 1:1 son registros vivos -no llevan
--  trigger de inmutabilidad, a proposito: un objetivo se actualiza
--  seguido, una nota de 1:1 se corrige despues, y forzarlos a ser
--  inmutables no refleja como se usan de verdad-. Una evaluacion 360 SI
--  es un hecho fijo una vez enviada -mismo criterio que un pago de
--  prestamo-, y un plan de mejora es inmutable una vez resuelto -mismo
--  criterio que un gasto o un prestamo-.
-- ═══════════════════════════════════════════════════════════════════════

create table public.performance_objectives (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  employee_id  uuid references public.employees(id),
  title        text not null,
  period       text not null,
  status       text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on public.performance_objectives (tenant_id, employee_id);
create index on public.performance_objectives (tenant_id, period);

create table public.performance_key_results (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  objective_id    uuid not null references public.performance_objectives(id) on delete cascade,
  description     text not null,
  target_value    numeric(14,2) not null,
  current_value   numeric(14,2) not null default 0,
  unit            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.performance_key_results (tenant_id, objective_id);

create table public.performance_one_on_ones (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  employee_id    uuid not null references public.employees(id),
  scheduled_at   timestamptz not null,
  notes          text,
  action_items   text,
  status         text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index on public.performance_one_on_ones (tenant_id, employee_id);

-- Una evaluacion es un hecho fijo una vez enviada -mismo criterio que un
-- pago de prestamo-: no hay estado de "borrador" aqui, se inserta ya
-- enviada.
create table public.performance_reviews (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  employee_id   uuid not null references public.employees(id),
  cycle         text not null,
  review_type   text not null check (review_type in ('self', 'manager', 'peer', 'direct_report')),
  reviewer_name text,
  rating        integer not null check (rating between 1 and 5),
  comments      text,
  submitted_at  timestamptz not null default now()
);

create index on public.performance_reviews (tenant_id, employee_id, cycle);

create table public.performance_improvement_plans (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  employee_id  uuid not null references public.employees(id),
  reason       text not null,
  goals        text,
  start_date   date not null,
  end_date     date not null,
  status       text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_date >= start_date)
);

create index on public.performance_improvement_plans (tenant_id, employee_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('performance_objectives',         'performance'),
      ('performance_key_results',        'performance'),
      ('performance_one_on_ones',        'performance'),
      ('performance_reviews',            'performance'),
      ('performance_improvement_plans',  'performance')
    ) as t(tabla, modulo)
  loop
    execute format('alter table public.%I enable row level security', r.tabla);
    execute format('alter table public.%I force row level security', r.tabla);
    execute format(
      'create policy tenant_module on public.%I for all
         using (tenant_id = rls.tenant_id() and rls.module_active(%L))
         with check (tenant_id = rls.tenant_id() and rls.module_active(%L))',
      r.tabla, r.modulo, r.modulo);
    execute format(
      'create policy provider_impersonating on public.%I for select
         using (rls.impersonating(tenant_id))', r.tabla);
  end loop;
end $$;

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenece la referencia.
create function public.impedir_objetivo_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.employee_id is not null then
    select tenant_id into v_tenant from public.employees where id = new.employee_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_objetivo_ajeno before insert on public.performance_objectives
  for each row execute function public.impedir_objetivo_ajeno();

create function public.impedir_resultado_clave_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.performance_objectives where id = new.objective_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese objetivo no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_resultado_clave_ajeno before insert on public.performance_key_results
  for each row execute function public.impedir_resultado_clave_ajeno();

create function public.impedir_referencia_ajena_empleado_desempeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.employees where id = new.employee_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_1on1_ajeno before insert on public.performance_one_on_ones
  for each row execute function public.impedir_referencia_ajena_empleado_desempeno();
create trigger no_evaluacion_ajena before insert on public.performance_reviews
  for each row execute function public.impedir_referencia_ajena_empleado_desempeno();
create trigger no_plan_mejora_ajeno before insert on public.performance_improvement_plans
  for each row execute function public.impedir_referencia_ajena_empleado_desempeno();

-- ── Una evaluacion enviada es inmutable -sin excepcion, como un pago- ────
create function public.impedir_editar_evaluacion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una evaluacion ya enviada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_evaluacion
  before update or delete on public.performance_reviews
  for each row execute function public.impedir_editar_evaluacion();

-- ── Un plan de mejora resuelto es inmutable ───────────────────────────
create function public.impedir_editar_plan_mejora_resuelto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('completed', 'cancelled') then
    raise exception 'Ese plan de mejora ya quedo resuelto y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_plan_mejora_resuelto
  before update or delete on public.performance_improvement_plans
  for each row execute function public.impedir_editar_plan_mejora_resuelto();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.performance_objectives
  for each row execute function audit.record('performance');
create trigger audit_me after insert or update or delete on public.performance_improvement_plans
  for each row execute function audit.record('performance');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'OKR con progreso calculado de verdad, evaluaciones 360 y 1:1 en un solo lugar',
    problem      = 'Sin un registro real, los objetivos del trimestre viven en una presentacion que nadie actualiza, y las evaluaciones se hacen de memoria una vez al año.',
    features     = '[
      {"titulo":"Progreso calculado, no reportado a mano","detalle":"El progreso de cada resultado clave -y el del objetivo completo- se deriva siempre del valor actual contra la meta, nunca un numero que alguien tiene que actualizar aparte."},
      {"titulo":"Evaluacion 360 real","detalle":"Auto-evaluacion, jefe, pares y reportes directos, cada uno con su calificacion -promediada automaticamente por ciclo-."},
      {"titulo":"1:1 con memoria","detalle":"Notas y compromisos de cada reunion, ligados siempre al empleado correcto."},
      {"titulo":"Planes de mejora con fecha de cierre","detalle":"Un plan de mejora resuelto -completado o cancelado- queda fijo, no se reescribe la historia despues."}
    ]'::jsonb,
    audience     = '{"Negocios que ya usan employees y quieren dejar el Excel de OKRs","Cualquiera con mas de un gerente que hace evaluaciones de desempeno"}',
    faq          = '[
      {"p":"¿Se puede editar una evaluacion despues de enviarla?","r":"No, igual que un pago de prestamo: una evaluacion enviada es un hecho fijo. Una correccion se hace con una evaluacion nueva."},
      {"p":"¿El progreso de un OKR se actualiza solo?","r":"Se deriva siempre del valor actual que se registra contra la meta -nunca hay un porcentaje guardado que se desincroniza-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'performance';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'performance'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'performance no tiene precio en los 3 tiers';
  end if;
end $$;
