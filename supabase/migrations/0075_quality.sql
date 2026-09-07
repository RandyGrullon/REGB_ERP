-- ═══════════════════════════════════════════════════════════════════════
--  0075 — Control de calidad (modulo 58, F8.5/S53)
--
--  Planes de inspeccion (plantilla, editable) -> inspecciones reales
--  (hecho historico, inmutable desde el insert) -> no conformidades
--  (maquina de estados, congelada en terminal) -> CAPA (accion
--  correctiva/preventiva, tambien congelada en terminal). El resultado
--  de una inspeccion NO es binario: un criterio critico reprobado
--  reprueba la inspeccion entera; uno menor la deja "condicional"
--  -aprobada con salvedad, no reprobada de plano- (resultadoInspeccion()
--  en @regb/operations). Una no conformidad solo se cierra pasando por
--  un CAPA -no hay atajo de "investigando" a "cerrada"-, y un CAPA solo
--  se cierra despues de VERIFICAR que la accion funciono -no hay atajo
--  de "en progreso" a "cerrado"-. Ambas maquinas de estados se validan
--  en la capa de aplicacion (transicionValidaNoConformidad(),
--  transicionValidaCapa()); la base solo congela cada fila una vez
--  llega a un estado terminal, igual que `traffic_fines` de `fleet`.
--
--  Deliberadamente SIN requires: `quality` no exige `manufacturing`
--  -una inspeccion de recepcion es util para cualquier distribuidor,
--  fabrique o no- (regb.module_catalog: requires '{}', recommends
--  '{manufacturing}').
-- ═══════════════════════════════════════════════════════════════════════

-- Plantilla: que revisar y con que criterios. Vive y se edita mientras
-- este activa, como `vehicles`/`vehicle_documents` de fleet.
create table public.inspection_plans (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  name        text not null,
  scope       text not null check (scope in ('receiving', 'production', 'final', 'other')),
  product_id  uuid references public.products(id),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on public.inspection_plans (tenant_id, active);

create table public.inspection_plan_criteria (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.inspection_plans(id) on delete cascade,
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  criterion    text not null,
  is_critical  boolean not null default false,
  sort_order   integer not null default 0
);

create index on public.inspection_plan_criteria (tenant_id, plan_id);

-- Una inspeccion real es un hecho historico: inmutable desde el
-- primer insert, igual que `production_reports` de manufacturing.
create table public.inspections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  plan_id       uuid not null references public.inspection_plans(id),
  product_id    uuid references public.products(id),
  performed_by  uuid,
  performed_at  timestamptz not null default now(),
  result        text not null check (result in ('passed', 'failed', 'conditional')),
  notes         text
);

create index on public.inspections (tenant_id, performed_at desc);
create index on public.inspections (tenant_id, result);

create table public.inspection_results (
  id             uuid primary key default gen_random_uuid(),
  inspection_id  uuid not null references public.inspections(id) on delete cascade,
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  criterion      text not null,
  is_critical    boolean not null default false,
  passed         boolean not null,
  notes          text
);

create index on public.inspection_results (tenant_id, inspection_id);

create table public.non_conformances (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  description     text not null,
  severity        text not null check (severity in ('minor', 'major', 'critical')),
  status          text not null default 'open'
                    check (status in ('open', 'investigating', 'capa_created', 'closed', 'dismissed')),
  inspection_id   uuid references public.inspections(id),
  detected_by     uuid,
  detected_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.non_conformances (tenant_id, status);

create table public.capas (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references regb.tenants(id) on delete cascade,
  non_conformance_id   uuid not null references public.non_conformances(id),
  root_cause           text not null,
  corrective_action    text not null,
  preventive_action    text,
  status               text not null default 'open'
                         check (status in ('open', 'in_progress', 'verified', 'closed')),
  assigned_to          uuid,
  due_date             date,
  verified_by          uuid,
  verified_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index on public.capas (tenant_id, status);
create index on public.capas (tenant_id, non_conformance_id);

-- Certificados de calidad de un producto: registro vivo, se puede
-- corregir o renovar -no un hecho historico como una inspeccion-.
create table public.quality_certificates (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  product_id     uuid not null references public.products(id),
  cert_number    text not null,
  issuing_body   text not null,
  issued_at      date not null,
  expires_at     date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index on public.quality_certificates (tenant_id, product_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.inspection_plans enable row level security;
alter table public.inspection_plans force row level security;
alter table public.inspection_plan_criteria enable row level security;
alter table public.inspection_plan_criteria force row level security;
alter table public.inspections enable row level security;
alter table public.inspections force row level security;
alter table public.inspection_results enable row level security;
alter table public.inspection_results force row level security;
alter table public.non_conformances enable row level security;
alter table public.non_conformances force row level security;
alter table public.capas enable row level security;
alter table public.capas force row level security;
alter table public.quality_certificates enable row level security;
alter table public.quality_certificates force row level security;

create policy tenant_module on public.inspection_plans for all
  using (tenant_id = rls.tenant_id() and rls.module_active('quality'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('quality'));
create policy provider_impersonating on public.inspection_plans for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.inspection_plan_criteria for all
  using (tenant_id = rls.tenant_id() and rls.module_active('quality'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('quality'));
create policy provider_impersonating on public.inspection_plan_criteria for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.inspections for all
  using (tenant_id = rls.tenant_id() and rls.module_active('quality'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('quality'));
create policy provider_impersonating on public.inspections for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.inspection_results for all
  using (tenant_id = rls.tenant_id() and rls.module_active('quality'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('quality'));
create policy provider_impersonating on public.inspection_results for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.non_conformances for all
  using (tenant_id = rls.tenant_id() and rls.module_active('quality'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('quality'));
create policy provider_impersonating on public.non_conformances for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.capas for all
  using (tenant_id = rls.tenant_id() and rls.module_active('quality'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('quality'));
create policy provider_impersonating on public.capas for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.quality_certificates for all
  using (tenant_id = rls.tenant_id() and rls.module_active('quality'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('quality'));
create policy provider_impersonating on public.quality_certificates for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_referencia_ajena_criterio() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.inspection_plans where id = new.plan_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese plan de inspeccion no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_referencia_ajena_criterio
  before insert or update on public.inspection_plan_criteria
  for each row execute function public.impedir_referencia_ajena_criterio();

create function public.impedir_referencia_ajena_inspeccion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_plan uuid;
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_plan from public.inspection_plans where id = new.plan_id;
  if v_tenant_plan is distinct from new.tenant_id then
    raise exception 'Ese plan de inspeccion no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  if new.product_id is not null then
    select tenant_id into v_tenant_producto from public.products where id = new.product_id;
    if v_tenant_producto is distinct from new.tenant_id then
      raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_inspeccion
  before insert on public.inspections
  for each row execute function public.impedir_referencia_ajena_inspeccion();

create function public.impedir_referencia_ajena_resultado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.inspections where id = new.inspection_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa inspeccion no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_referencia_ajena_resultado
  before insert on public.inspection_results
  for each row execute function public.impedir_referencia_ajena_resultado();

create function public.impedir_referencia_ajena_no_conformidad() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.inspection_id is not null then
    select tenant_id into v_tenant from public.inspections where id = new.inspection_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Esa inspeccion no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_referencia_ajena_no_conformidad
  before insert or update on public.non_conformances
  for each row execute function public.impedir_referencia_ajena_no_conformidad();

create function public.impedir_no_conformidad_ajena_capa() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.non_conformances where id = new.non_conformance_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa no conformidad no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_conformidad_ajena_capa
  before insert or update on public.capas
  for each row execute function public.impedir_no_conformidad_ajena_capa();

create function public.impedir_producto_ajeno_certificado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.products where id = new.product_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_producto_ajeno_certificado
  before insert or update on public.quality_certificates
  for each row execute function public.impedir_producto_ajeno_certificado();

-- ── Inmutabilidad ─────────────────────────────────────────────────────
create function public.impedir_editar_inspeccion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una inspeccion ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_inspeccion
  before update or delete on public.inspections
  for each row execute function public.impedir_editar_inspeccion();

create trigger no_editar_resultado
  before update or delete on public.inspection_results
  for each row execute function public.impedir_editar_inspeccion();

create function public.impedir_editar_no_conformidad_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('closed', 'dismissed') then
    raise exception 'Esa no conformidad ya se resolvio y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_no_conformidad_resuelta
  before update or delete on public.non_conformances
  for each row execute function public.impedir_editar_no_conformidad_resuelta();

create function public.impedir_editar_capa_cerrado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'closed' then
    raise exception 'Ese CAPA ya esta cerrado y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_capa_cerrado
  before update or delete on public.capas
  for each row execute function public.impedir_editar_capa_cerrado();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.inspection_plans
  for each row execute function audit.record('quality');
create trigger audit_me after insert or update or delete on public.inspection_plan_criteria
  for each row execute function audit.record('quality');
create trigger audit_me after insert on public.inspections
  for each row execute function audit.record('quality');
create trigger audit_me after insert or update on public.non_conformances
  for each row execute function audit.record('quality');
create trigger audit_me after insert or update on public.capas
  for each row execute function audit.record('quality');
create trigger audit_me after insert or update on public.quality_certificates
  for each row execute function audit.record('quality');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Un criterio critico reprobado nunca se disfraza de "condicional"',
    problem      = 'Sin planes de inspeccion con criterios explicitos, "revisar la calidad" significa que cada quien decide en el momento que fue suficiente, y las no conformidades se resuelven de palabra, sin quedar registradas ni sin garantia de que se corrigio la causa raiz.',
    features     = '[
      {"titulo":"Resultado honesto, no binario","detalle":"Un criterio critico reprobado siempre reprueba la inspeccion entera; uno menor la deja condicional -aprobada con salvedad, no aprobada a secas-."},
      {"titulo":"No conformidad hasta cerrarla con un CAPA","detalle":"Una no conformidad no se cierra directo: pasa por un CAPA con causa raiz, accion correctiva y verificacion antes de cerrar."},
      {"titulo":"CAPA que no se cierra sin verificar","detalle":"Declarar que la accion correctiva funciono y cerrar en el mismo paso no esta permitido: hay que verificarlo primero."}
    ]'::jsonb,
    audience     = '{"Cualquiera que reciba mercancia y necesite un criterio de aceptacion explicito, fabrique o no","Fabricantes que ya usan manufacturing y necesitan control de calidad en proceso o final"}',
    faq          = '[
      {"p":"¿Necesito el modulo de produccion para usar este?","r":"No -quality no lo exige, aunque se complementa con el si fabricas-."},
      {"p":"¿Un CAPA se puede cerrar sin verificar la correccion?","r":"No -el sistema no permite saltar de en progreso a cerrado sin pasar por verificado-."}
    ]'::jsonb,
    setup_minutes = 20
where id = 'quality';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'quality'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'quality no tiene precio en los 3 tiers';
  end if;
end $$;
