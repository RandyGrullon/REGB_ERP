-- ═══════════════════════════════════════════════════════════════════════
--  0076 — Mantenimiento / CMMS (modulo 59, F8.5/S53)
--
--  El vencimiento de mantenimiento preventivo reutiliza las MISMAS dos
--  funciones de fleet.ts (mantenimientoVencidoPorKm/PorFecha) -la
--  pregunta es identica sea un vehiculo con kilometraje o una maquina
--  con horas de uso-. calcularMtbfDias() promedia los intervalos ENTRE
--  fallas consecutivas de un equipo, no desde la primera falla hasta
--  hoy. Una orden de trabajo sigue open -> in_progress -> completed,
--  con cancelled como salida desde open o in_progress; completada o
--  cancelada es terminal.
--
--  Deliberadamente SIN requires (regb.module_catalog: requires '{}',
--  recommends '{inventory}'): el equipo a mantener es propio de este
--  modulo (no depende de fixed-assets, que es financiero, ni de
--  fleet, que es de vehiculos), y los repuestos usados en una orden
--  SI son productos reales de inventory -de ahi el recommends-.
-- ═══════════════════════════════════════════════════════════════════════

-- El equipo a mantener: registro vivo, se edita libremente.
create table public.equipment (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references regb.tenants(id) on delete cascade,
  code             text not null,
  name             text not null,
  location         text,
  status           text not null default 'active' check (status in ('active', 'retired')),
  usage_hours      numeric(12,2) not null default 0 check (usage_hours >= 0),
  last_service_at  date,
  last_service_usage numeric(12,2),
  maintenance_interval_usage numeric(12,2),
  maintenance_interval_days  integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, code)
);

create index on public.equipment (tenant_id, status);

create table public.work_orders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  equipment_id   uuid not null references public.equipment(id),
  type           text not null check (type in ('preventive', 'corrective')),
  status         text not null default 'open'
                   check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  priority       text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  description    text not null,
  requested_by   uuid,
  assigned_to    uuid,
  opened_at      timestamptz not null default now(),
  completed_at   timestamptz,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index on public.work_orders (tenant_id, equipment_id);
create index on public.work_orders (tenant_id, status);

create table public.work_order_parts (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders(id) on delete cascade,
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  product_id     uuid not null references public.products(id),
  qty_used       numeric(14,3) not null check (qty_used > 0)
);

create index on public.work_order_parts (tenant_id, work_order_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.equipment enable row level security;
alter table public.equipment force row level security;
alter table public.work_orders enable row level security;
alter table public.work_orders force row level security;
alter table public.work_order_parts enable row level security;
alter table public.work_order_parts force row level security;

create policy tenant_module on public.equipment for all
  using (tenant_id = rls.tenant_id() and rls.module_active('maintenance'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('maintenance'));
create policy provider_impersonating on public.equipment for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.work_orders for all
  using (tenant_id = rls.tenant_id() and rls.module_active('maintenance'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('maintenance'));
create policy provider_impersonating on public.work_orders for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.work_order_parts for all
  using (tenant_id = rls.tenant_id() and rls.module_active('maintenance'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('maintenance'));
create policy provider_impersonating on public.work_order_parts for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_equipo_ajeno_orden() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.equipment where id = new.equipment_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese equipo no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_equipo_ajeno_orden
  before insert or update on public.work_orders
  for each row execute function public.impedir_equipo_ajeno_orden();

create function public.impedir_referencia_ajena_parte() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_orden uuid;
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_orden from public.work_orders where id = new.work_order_id;
  if v_tenant_orden is distinct from new.tenant_id then
    raise exception 'Esa orden de trabajo no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_producto from public.products where id = new.product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_parte
  before insert on public.work_order_parts
  for each row execute function public.impedir_referencia_ajena_parte();

-- ── Inmutabilidad: solo la maquina de estados de la orden se congela ────
create function public.impedir_editar_orden_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('completed', 'cancelled') then
    raise exception 'Esa orden de trabajo ya se resolvio y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_orden_resuelta
  before update or delete on public.work_orders
  for each row execute function public.impedir_editar_orden_resuelta();

-- Las partes consumidas son un hecho historico, igual que las lineas
-- de produccion: se crean con la orden y no se editan despues.
create function public.impedir_editar_parte() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una parte ya registrada en una orden no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_parte
  before update or delete on public.work_order_parts
  for each row execute function public.impedir_editar_parte();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.equipment
  for each row execute function audit.record('maintenance');
create trigger audit_me after insert or update or delete on public.work_orders
  for each row execute function audit.record('maintenance');
create trigger audit_me after insert on public.work_order_parts
  for each row execute function audit.record('maintenance');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'El MTBF se promedia entre fallas consecutivas, no desde la primera falla hasta hoy',
    problem      = 'Sin ordenes de trabajo con estado real, el mantenimiento correctivo se coordina por mensaje de texto y nadie sabe cuanto dura un equipo entre fallas hasta que ya es demasiado tarde para prevenir la siguiente.',
    features     = '[
      {"titulo":"Vencimiento real, por uso o por fecha","detalle":"El mismo calculo que ya usa fleet para vehiculos -por kilometraje o por fecha limite- decide cuando un equipo necesita mantenimiento preventivo."},
      {"titulo":"MTBF que promedia intervalos, no antiguedad","detalle":"El tiempo medio entre fallas se calcula entre fallas consecutivas -detectar que un equipo esta fallando cada vez mas seguido, no solo cuanto tiempo lleva instalado-."},
      {"titulo":"Repuestos que de verdad salen del inventario","detalle":"Las partes usadas en una orden se registran contra el producto real, listas para conectar con el modulo de inventario."}
    ]'::jsonb,
    audience     = '{"Cualquiera con maquinaria o equipo que falla y necesita ordenes de trabajo reales, no una lista en un cuaderno","Quien ya usa fleet para vehiculos y quiere el mismo control para el resto del equipo"}',
    faq          = '[
      {"p":"¿Necesito el modulo de activos fijos para usar este?","r":"No -el equipo de este modulo es propio, no depende de fixed-assets ni de fleet-."},
      {"p":"¿Descuenta el repuesto del inventario automaticamente?","r":"Registra el consumo contra el producto; la resta real del stock se completa cuando se conecta con inventory."}
    ]'::jsonb,
    setup_minutes = 20
where id = 'maintenance';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'maintenance'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'maintenance no tiene precio en los 3 tiers';
  end if;
end $$;
