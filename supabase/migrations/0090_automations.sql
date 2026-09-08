-- ═══════════════════════════════════════════════════════════════════════
--  0090 — Automatizaciones (modulo 88, F9/S63)
--
--  Consume el mismo outbox de eventos (`public.event_outbox`) que YA
--  usan mas de veinte modulos de este proyecto via `emit_event()` -no
--  un mecanismo nuevo-. `claim_events()`/`settle_event()` estan
--  revocados de `authenticated` a proposito (son del despachador
--  global de fondo, sin filtro de tenant): automatizaciones NUNCA los
--  llama. En cambio solo LEE `event_outbox` -RLS ya lo filtra por
--  tenant- y lleva su PROPIA bitacora en `automation_runs`, sin tocar
--  `processed_at` ni interferir con el despachador real.
--
--  La accion tambien es un catalogo FIJO -hoy solo
--  `create_notification`, escribe en `public.notifications`, una
--  tabla del core-: nunca ejecuta codigo arbitrario, mismo criterio
--  que `bi` con sus fuentes de reporte.
--
--  Deliberadamente SIN requires: una regla puede escuchar cualquier
--  tipo de evento ya emitido por cualquier modulo activo.
-- ═══════════════════════════════════════════════════════════════════════

create table public.automation_rules (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references regb.tenants(id) on delete cascade,
  name                text not null,
  trigger_event_type  text not null check (trigger_event_type ~ '^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$'),
  condition_field     text,
  condition_operator  text check (condition_operator in ('eq', 'neq', 'gt', 'lt')),
  condition_value     text,
  action_type         text not null check (action_type in ('create_notification')),
  action_params       jsonb not null default '{}'::jsonb,
  status              text not null default 'active' check (status in ('active', 'paused')),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, name),
  check ((condition_field is null) = (condition_operator is null))
);

create index on public.automation_rules (tenant_id, trigger_event_type) where status = 'active';

-- Cada corrida es un hecho historico: inmutable desde el insert, y su
-- unicidad (regla, evento) evita procesar el mismo evento dos veces
-- con la misma regla.
create table public.automation_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  rule_id        uuid not null references public.automation_rules(id) on delete cascade,
  event_id       bigint not null references public.event_outbox(id),
  matched        boolean not null,
  action_result  jsonb,
  executed_at    timestamptz not null default now(),
  unique (rule_id, event_id)
);

create index on public.automation_runs (tenant_id, rule_id, executed_at desc);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.automation_rules enable row level security;
alter table public.automation_rules force row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_runs force row level security;

create policy tenant_module on public.automation_rules for all
  using (tenant_id = rls.tenant_id() and rls.module_active('automations'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('automations'));
create policy provider_impersonating on public.automation_rules for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.automation_runs for all
  using (tenant_id = rls.tenant_id() and rls.module_active('automations'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('automations'));
create policy provider_impersonating on public.automation_runs for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
--  El evento tambien tiene que ser del mismo tenant -event_outbox ya
--  lo filtra por su propia RLS al leerlo, pero la regla podria
--  apuntar a un id de otro tenant si alguien lo adivina-.
create function public.impedir_regla_ajena_ejecucion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_regla uuid;
  v_tenant_evento uuid;
begin
  select tenant_id into v_tenant_regla from public.automation_rules where id = new.rule_id;
  select tenant_id into v_tenant_evento from public.event_outbox where id = new.event_id;
  if v_tenant_regla is distinct from new.tenant_id or v_tenant_evento is distinct from new.tenant_id then
    raise exception 'Esa regla o ese evento no pertenecen a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_regla_ajena_ejecucion
  before insert on public.automation_runs
  for each row execute function public.impedir_regla_ajena_ejecucion();

create function public.impedir_editar_ejecucion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una ejecucion de automatizacion ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_ejecucion
  before update or delete on public.automation_runs
  for each row execute function public.impedir_editar_ejecucion();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.automation_rules
  for each row execute function audit.record('automations');
create trigger audit_me after insert on public.automation_runs
  for each row execute function audit.record('automations');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Escucha el mismo rastro de eventos que ya usan mas de veinte modulos, sin tocar el despachador real',
    problem      = 'Sin reglas automaticas, alguien tiene que acordarse de revisar manualmente cuando pasa algo -un ticket urgente, un lead calificado- para avisarle a quien corresponde.',
    features     = '[
      {"titulo":"Si esto, entonces aquello, sin codigo","detalle":"Una regla escucha un tipo de evento exacto -el mismo formato modulo.entidad.accion que ya usa todo el proyecto- y una condicion simple sobre su contenido."},
      {"titulo":"Una accion vetada, no codigo arbitrario","detalle":"Hoy la unica accion es crear una notificacion real -nunca ejecuta una funcion libre que un tenant pudiera manipular-."},
      {"titulo":"Nunca interfiere con el despachador real","detalle":"Solo LEE el rastro de eventos y lleva su propia bitacora -nunca marca un evento como procesado, esa es tarea del despachador de fondo-."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio que hoy depende de que alguien revise manualmente cuando pasa algo importante"}',
    faq          = '[
      {"p":"¿Corre en segundo plano automaticamente?","r":"No todavia -hay que pedirle que procese los eventos pendientes desde la pantalla, no hay un despachador automatico conectado-."},
      {"p":"¿Puedo ejecutar cualquier accion, como un webhook?","r":"No -el catalogo de acciones es fijo y vetado, hoy solo crear una notificacion real-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'automations';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'automations'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'automations no tiene precio en los 3 tiers';
  end if;
end $$;
