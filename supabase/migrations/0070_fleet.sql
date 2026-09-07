-- ═══════════════════════════════════════════════════════════════════════
--  0070 — Flota & Vehiculos (modulo 54, F8/S49)
--
--  Vehiculos, combustible, mantenimiento, licencias/seguros y multas.
--  La vigencia de un documento del vehiculo (licencia, seguro,
--  inspeccion) reutiliza certificadoVigente() de training.ts
--  (reexportada como documentoVehiculoVigente() en @regb/operations) -
--  la misma pregunta que certificados de empleados-. El mantenimiento
--  vencido se detecta por kilometraje o por fecha, cada uno con su
--  propia funcion pura.
--
--  Honesto sobre el alcance: no hay integracion real con
--  telematica/GPS de vehiculos ni con el registro de transito de la
--  DGII para verificar multas -eso es `logistics` (53, seguimiento GPS,
--  con su propia honestidad declarada) y una integracion externa
--  futura respectivamente. Aqui se REGISTRA lo que ya paso -combustible
--  cargado, servicio hecho, multa recibida-, no se conecta a ningun
--  sensor.
-- ═══════════════════════════════════════════════════════════════════════

create table public.vehicles (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references regb.tenants(id) on delete cascade,
  plate              text not null,
  brand              text not null,
  model              text not null,
  year               integer check (year >= 1980 and year <= 2100),
  vin                text,
  status             text not null default 'active'
                       check (status in ('active', 'maintenance', 'retired')),
  assigned_driver_id uuid references public.employees(id),
  odometer_km        numeric(10,1) not null default 0 check (odometer_km >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, plate)
);

create index on public.vehicles (tenant_id, status);

-- Un vehiculo es un registro vivo -su kilometraje, su estado, su
-- conductor asignado cambian seguido-, mismo criterio que
-- product_lots (0066): sin trigger de inmutabilidad.
create table public.vehicle_documents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  vehicle_id   uuid not null references public.vehicles(id) on delete cascade,
  doc_type     text not null check (doc_type in ('license', 'insurance', 'inspection')),
  expiry_date  date not null,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on public.vehicle_documents (tenant_id, vehicle_id);
create index on public.vehicle_documents (tenant_id, expiry_date);

-- Cargar combustible es un hecho historico -paso en un momento dado,
-- con ese kilometraje exacto-: inmutable desde el primer insert, sin
-- condicion, igual que benefit_loan_payments (0057).
create table public.fuel_logs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  vehicle_id   uuid not null references public.vehicles(id),
  driver_id    uuid references public.employees(id),
  filled_at    timestamptz not null default now(),
  liters       numeric(8,2) not null check (liters > 0),
  cost         numeric(10,2) not null check (cost >= 0),
  odometer_km  numeric(10,1) not null check (odometer_km >= 0)
);

create index on public.fuel_logs (tenant_id, vehicle_id, filled_at desc);

-- Un servicio de mantenimiento ya hecho tampoco se reescribe -mismo
-- criterio que fuel_logs-.
create table public.maintenance_records (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  vehicle_id    uuid not null references public.vehicles(id),
  service_date  date not null default current_date,
  type          text not null check (type in ('preventive', 'corrective')),
  description   text not null,
  cost          numeric(10,2) not null default 0 check (cost >= 0),
  odometer_km   numeric(10,1) not null check (odometer_km >= 0),
  next_due_km   numeric(10,1),
  next_due_date date
);

create index on public.maintenance_records (tenant_id, vehicle_id, service_date desc);

-- Una multa SI es un flujo con estados -pending/disputed son
-- editables, paid/dismissed son terminales-.
create table public.traffic_fines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  vehicle_id   uuid not null references public.vehicles(id),
  driver_id    uuid references public.employees(id),
  fine_date    date not null default current_date,
  amount       numeric(10,2) not null check (amount > 0),
  reason       text not null,
  status       text not null default 'pending'
                 check (status in ('pending', 'disputed', 'paid', 'dismissed')),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on public.traffic_fines (tenant_id, vehicle_id);
create index on public.traffic_fines (tenant_id, status);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.vehicles enable row level security;
alter table public.vehicles force row level security;
alter table public.vehicle_documents enable row level security;
alter table public.vehicle_documents force row level security;
alter table public.fuel_logs enable row level security;
alter table public.fuel_logs force row level security;
alter table public.maintenance_records enable row level security;
alter table public.maintenance_records force row level security;
alter table public.traffic_fines enable row level security;
alter table public.traffic_fines force row level security;

create policy tenant_module on public.vehicles for all
  using (tenant_id = rls.tenant_id() and rls.module_active('fleet'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('fleet'));
create policy provider_impersonating on public.vehicles for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.vehicle_documents for all
  using (tenant_id = rls.tenant_id() and rls.module_active('fleet'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('fleet'));
create policy provider_impersonating on public.vehicle_documents for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.fuel_logs for all
  using (tenant_id = rls.tenant_id() and rls.module_active('fleet'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('fleet'));
create policy provider_impersonating on public.fuel_logs for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.maintenance_records for all
  using (tenant_id = rls.tenant_id() and rls.module_active('fleet'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('fleet'));
create policy provider_impersonating on public.maintenance_records for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.traffic_fines for all
  using (tenant_id = rls.tenant_id() and rls.module_active('fleet'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('fleet'));
create policy provider_impersonating on public.traffic_fines for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenecen las referencias.
create function public.impedir_vehiculo_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_conductor uuid;
begin
  if new.assigned_driver_id is not null then
    select tenant_id into v_tenant_conductor from public.employees where id = new.assigned_driver_id;
    if v_tenant_conductor is distinct from new.tenant_id then
      raise exception 'Ese conductor no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_vehiculo_ajeno before insert or update on public.vehicles
  for each row execute function public.impedir_vehiculo_ajeno();

create function public.impedir_referencia_ajena_vehiculo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_vehiculo uuid;
begin
  select tenant_id into v_tenant_vehiculo from public.vehicles where id = new.vehicle_id;
  if v_tenant_vehiculo is distinct from new.tenant_id then
    raise exception 'Ese vehiculo no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_referencia_ajena_documento_vehiculo
  before insert or update on public.vehicle_documents
  for each row execute function public.impedir_referencia_ajena_vehiculo();

create function public.impedir_referencia_ajena_combustible() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_vehiculo uuid;
  v_tenant_conductor uuid;
begin
  select tenant_id into v_tenant_vehiculo from public.vehicles where id = new.vehicle_id;
  if v_tenant_vehiculo is distinct from new.tenant_id then
    raise exception 'Ese vehiculo no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  if new.driver_id is not null then
    select tenant_id into v_tenant_conductor from public.employees where id = new.driver_id;
    if v_tenant_conductor is distinct from new.tenant_id then
      raise exception 'Ese conductor no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_combustible
  before insert or update on public.fuel_logs
  for each row execute function public.impedir_referencia_ajena_combustible();

create trigger no_referencia_ajena_mantenimiento
  before insert or update on public.maintenance_records
  for each row execute function public.impedir_referencia_ajena_vehiculo();

-- Multas comparten la validacion de vehiculo Y conductor -mismo patron
-- que fuel_logs, reutilizado tal cual en vez de escribirlo de nuevo-.
create trigger no_referencia_ajena_multa
  before insert or update on public.traffic_fines
  for each row execute function public.impedir_referencia_ajena_combustible();

-- ── Inmutabilidad ─────────────────────────────────────────────────────
create function public.impedir_editar_combustible() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una carga de combustible ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_combustible
  before update or delete on public.fuel_logs
  for each row execute function public.impedir_editar_combustible();

create function public.impedir_editar_mantenimiento() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un mantenimiento ya registrado no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_mantenimiento
  before update or delete on public.maintenance_records
  for each row execute function public.impedir_editar_mantenimiento();

create function public.impedir_editar_multa_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('paid', 'dismissed') then
    raise exception 'Esa multa ya quedo resuelta y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_multa_resuelta
  before update or delete on public.traffic_fines
  for each row execute function public.impedir_editar_multa_resuelta();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.vehicles
  for each row execute function audit.record('fleet');
create trigger audit_me after insert or update or delete on public.fuel_logs
  for each row execute function audit.record('fleet');
create trigger audit_me after insert or update or delete on public.maintenance_records
  for each row execute function audit.record('fleet');
create trigger audit_me after insert or update or delete on public.traffic_fines
  for each row execute function audit.record('fleet');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Combustible, mantenimiento, licencias y multas de la flota -en un solo lugar, no en una libreta-',
    problem      = 'Sin esto, saber si a un camion le toca cambio de aceite, o si la licencia de un conductor ya vencio, depende de que alguien se acuerde -no de que el sistema lo avise-.',
    features     = '[
      {"titulo":"Mantenimiento vencido, calculado","detalle":"Por kilometraje o por fecha -lo que se cumpla primero-, no una fecha que alguien anota en un calendario aparte."},
      {"titulo":"Licencias y seguros con vigencia real","detalle":"La misma pregunta de vigencia que ya resuelve capacitacion de empleados, aplicada a los documentos del vehiculo."},
      {"titulo":"Multas con flujo real","detalle":"Pendiente, disputada, pagada o descartada -no solo un campo de texto libre-."}
    ]'::jsonb,
    audience     = '{"Negocios con vehiculos propios de reparto o servicio","Cualquiera que hoy lleve el mantenimiento de su flota en una libreta o una hoja de calculo"}',
    faq          = '[
      {"p":"¿Rastrea la posicion del vehiculo en tiempo real?","r":"No -eso es logistics (seguimiento GPS), y tampoco esta conectado a ningun dispositivo real todavia-. Este modulo registra combustible, mantenimiento, documentos y multas."},
      {"p":"¿Verifica las multas contra el registro de transito real?","r":"No todavia -se registran manualmente. Esa integracion externa es un paso futuro-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'fleet';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'fleet'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'fleet no tiene precio en los 3 tiers';
  end if;
end $$;
