-- ═══════════════════════════════════════════════════════════════════════
--  0079 — Oportunidades / Pipeline de ventas (modulo 30, F9/S55)
--
--  El forecast ponderado (forecastPonderado() en @regb/operations) es
--  la suma de cada monto por su propia probabilidad -nunca el monto
--  crudo-. La maquina de estados (transicionValidaEtapa()) avanza un
--  paso a la vez -no salta de "prospecting" a "negotiation"-, con
--  "lost" alcanzable desde cualquier etapa no terminal; "won"/"lost"
--  son terminales. diasEnEtapa() reutiliza diasEnPipeline() de
--  recruiting.ts tal cual.
--
--  REQUIERE crm (regb.module_catalog: requires '{crm}'): una
--  oportunidad puede nacer de un lead real -acoplamiento declarado y
--  legitimo-.
-- ═══════════════════════════════════════════════════════════════════════

create table public.opportunities (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references regb.tenants(id) on delete cascade,
  lead_id              uuid references public.leads(id),
  name                 text not null,
  amount               numeric(12,2) not null check (amount >= 0),
  stage                text not null default 'prospecting'
                         check (stage in ('prospecting', 'qualification', 'proposal', 'negotiation', 'won', 'lost')),
  probability          numeric(5,4) not null default 0.10 check (probability between 0 and 1),
  expected_close_date  date,
  lost_reason          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (stage != 'lost' or lost_reason is not null)
);

create index on public.opportunities (tenant_id, stage);
create index on public.opportunities (tenant_id, lead_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.opportunities enable row level security;
alter table public.opportunities force row level security;

create policy tenant_module on public.opportunities for all
  using (tenant_id = rls.tenant_id() and rls.module_active('pipeline'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('pipeline'));
create policy provider_impersonating on public.opportunities for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_lead_ajeno_oportunidad() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.lead_id is not null then
    select tenant_id into v_tenant from public.leads where id = new.lead_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Ese lead no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_lead_ajeno_oportunidad
  before insert or update on public.opportunities
  for each row execute function public.impedir_lead_ajeno_oportunidad();

-- ── Inmutabilidad: congelada solo en su estado terminal ────────────────
create function public.impedir_editar_oportunidad_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.stage in ('won', 'lost') then
    raise exception 'Esa oportunidad ya se resolvio y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_oportunidad_resuelta
  before update or delete on public.opportunities
  for each row execute function public.impedir_editar_oportunidad_resuelta();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.opportunities
  for each row execute function audit.record('pipeline');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Forecast ponderado de verdad -cada monto por su propia probabilidad, nunca el monto crudo-',
    problem      = 'Sin un pipeline formal, el forecast de ventas es una suma optimista de todo lo que esta "en conversacion", sin distinguir una oportunidad recien abierta de una a punto de firmarse.',
    features     = '[
      {"titulo":"Kanban de etapas real","detalle":"Cada oportunidad avanza un paso a la vez -prospeccion, calificacion, propuesta, negociacion, ganada-, sin saltos que inflen el pipeline."},
      {"titulo":"Forecast ponderado","detalle":"El pronostico suma cada monto multiplicado por SU probabilidad, no el monto crudo de todo lo abierto."},
      {"titulo":"Motivo de perdida obligatorio","detalle":"Una oportunidad no se puede marcar perdida sin explicar por que -ese dato es lo que mejora el proximo trimestre-."}
    ]'::jsonb,
    audience     = '{"Equipos de ventas que ya usan crm y quieren formalizar el pipeline con un forecast confiable"}',
    faq          = '[
      {"p":"¿Necesito CRM para usar pipeline?","r":"Si -una oportunidad puede nacer de un lead real, ese acoplamiento esta declarado-."},
      {"p":"¿Se puede marcar una oportunidad perdida sin decir por que?","r":"No -el motivo de perdida es obligatorio en cuanto la etapa pasa a perdida-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'pipeline';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'pipeline'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'pipeline no tiene precio en los 3 tiers';
  end if;
end $$;
