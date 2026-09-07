-- ═══════════════════════════════════════════════════════════════════════
--  0058 — Reclutamiento / ATS (modulo 65, F7/S41)
--
--  El "portal de empleo" publico del catalogo (§5.6) NO se construye
--  aqui. Este esquema NUNCA otorga acceso al rol `anon` sobre datos de
--  negocio -regla ya establecida desde 0005_rls_policies.sql-, y una
--  pagina de vacantes visible sin iniciar sesion romperia esa regla. Los
--  candidatos se registran manualmente por quien recluta -sin foto de
--  curriculum procesada automaticamente, mismo criterio que el recibo
--  sin OCR de expenses-.
--
--  Las transiciones de etapa del pipeline se validan en TypeScript
--  (transicionValida() en @regb/operations), no en SQL -mismo principio
--  que within_geofence en attendance o business_days en time-off-. La
--  base solo impide editar una aplicacion ya resuelta (hired/rejected).
-- ═══════════════════════════════════════════════════════════════════════

create table public.recruiting_positions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  title        text not null,
  department   text,
  description  text,
  status       text not null default 'open' check (status in ('open', 'closed', 'on_hold')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on public.recruiting_positions (tenant_id, status);

create table public.recruiting_candidates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  first_name  text not null,
  last_name   text not null,
  email       text,
  phone       text,
  source      text not null default 'other' check (source in ('referral', 'website', 'other')),
  notes       text,
  created_at  timestamptz not null default now()
);

create table public.recruiting_applications (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  position_id  uuid not null references public.recruiting_positions(id),
  candidate_id uuid not null references public.recruiting_candidates(id),
  stage        text not null default 'applied'
                 check (stage in ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected')),
  applied_at   timestamptz not null default now(),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, position_id, candidate_id)
);

create index on public.recruiting_applications (tenant_id, position_id);
create index on public.recruiting_applications (tenant_id, stage);

create table public.recruiting_interviews (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references regb.tenants(id) on delete cascade,
  application_id   uuid not null references public.recruiting_applications(id) on delete cascade,
  scheduled_at     timestamptz not null,
  interviewer_name text,
  notes            text,
  outcome          text not null default 'pending' check (outcome in ('pending', 'passed', 'failed')),
  created_at       timestamptz not null default now()
);

create index on public.recruiting_interviews (tenant_id, application_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('recruiting_positions',    'recruiting'),
      ('recruiting_candidates',   'recruiting'),
      ('recruiting_applications', 'recruiting'),
      ('recruiting_interviews',   'recruiting')
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
-- nueva, no a quien pertenecen position_id ni candidate_id.
create function public.impedir_aplicacion_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_posicion  uuid;
  v_tenant_candidato uuid;
begin
  select tenant_id into v_tenant_posicion from public.recruiting_positions where id = new.position_id;
  if v_tenant_posicion is distinct from new.tenant_id then
    raise exception 'Esa vacante no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_candidato from public.recruiting_candidates where id = new.candidate_id;
  if v_tenant_candidato is distinct from new.tenant_id then
    raise exception 'Ese candidato no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_aplicacion_ajena before insert on public.recruiting_applications
  for each row execute function public.impedir_aplicacion_ajena();

create function public.impedir_entrevista_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.recruiting_applications where id = new.application_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa aplicacion no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_entrevista_ajena before insert on public.recruiting_interviews
  for each row execute function public.impedir_entrevista_ajena();

-- ── Una aplicacion resuelta (hired/rejected) es inmutable ────────────────
create function public.impedir_editar_aplicacion_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.stage in ('hired', 'rejected') then
    raise exception 'Esa aplicacion ya quedo resuelta y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_aplicacion_resuelta
  before update or delete on public.recruiting_applications
  for each row execute function public.impedir_editar_aplicacion_resuelta();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.recruiting_positions
  for each row execute function audit.record('recruiting');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Vacantes, candidatos y entrevistas en un solo pipeline, sin una hoja de calculo aparte',
    problem      = 'Sin un pipeline real, el reclutamiento vive en un WhatsApp y una hoja de calculo -nadie sabe en que etapa esta cada candidato ni cuanto ha tardado-.',
    features     = '[
      {"titulo":"Pipeline con reglas reales","detalle":"Aplicado, en filtro, entrevista, oferta, contratado o rechazado -no se puede saltar etapas ni reabrir una aplicacion ya resuelta-."},
      {"titulo":"Entrevistas con seguimiento","detalle":"Quien entrevisto, cuando y con que resultado, ligado siempre a la aplicacion correcta."},
      {"titulo":"Honesto sobre el portal publico","detalle":"No publica las vacantes en una pagina publica -este sistema nunca expone datos de negocio sin iniciar sesion-. El pipeline es para uso interno de quien recluta."}
    ]'::jsonb,
    audience     = '{"Negocios que contratan seguido y ya no quieren llevarlo por WhatsApp","Cualquiera que quiera un historial real de candidatos"}',
    faq          = '[
      {"p":"¿Los candidatos pueden aplicar desde una pagina publica?","r":"No en esta version -este sistema nunca expone datos de negocio a quien no ha iniciado sesion-. Los candidatos se registran manualmente por quien recluta."},
      {"p":"¿Se puede saltar de aplicado directo a oferta?","r":"No: el pipeline solo avanza un paso a la vez, aunque se puede rechazar a un candidato desde cualquier etapa no terminal."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'recruiting';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'recruiting'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'recruiting no tiene precio en los 3 tiers';
  end if;
end $$;
