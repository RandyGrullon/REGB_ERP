-- ═══════════════════════════════════════════════════════════════════════
--  0098 — Servicio en campo (modulo 74, F10/S69)
--
--  Movil-primero de verdad (§13.5): el tecnico no lleva laptop al sitio.
--  Eso cambia las reglas, no solo la pantalla.
--
--  La regla que sostiene el modulo: una orden NO se cierra con pasos
--  obligatorios del checklist sin marcar ni sin la firma de quien
--  recibio. Esas dos cosas son lo unico que hace verificable "si lo
--  revisamos" y "si fuimos" tres semanas despues, cuando el cliente
--  reclama. Por eso la regla vive en un trigger y no solo en la UI: el
--  telefono del tecnico es un cliente remoto y no se le cree nada.
--
--  Deliberadamente SIN requires (catalogo 0009: requires '{}',
--  recommends '{inventory}'): un plomero que factura mano de obra y
--  compra el repuesto en la ferreteria de la esquina no tiene inventario
--  y aun asi necesita ordenes de servicio.
-- ═══════════════════════════════════════════════════════════════════════

create table public.service_orders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  code          text not null,
  customer_id   uuid not null references public.customers(id),
  technician_id uuid,
  status        text not null default 'draft'
                  check (status in ('draft', 'scheduled', 'in_progress', 'done', 'cancelled')),
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  scheduled_at  timestamptz,
  address       text,
  description   text not null,
  started_at    timestamptz,
  completed_at  timestamptz,
  -- La firma es el nombre de quien recibio, no un garabato: en un
  -- telefono barato el trazo se pierde y el nombre no.
  signed_by     text,
  signed_at     timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, code)
);

create index on public.service_orders (tenant_id, status);
create index on public.service_orders (tenant_id, technician_id, scheduled_at);

create table public.service_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  order_id    uuid not null references public.service_orders(id) on delete cascade,
  position    integer not null default 0,
  label       text not null,
  required    boolean not null default true,
  done        boolean not null default false,
  notes       text,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index on public.service_checklist_items (tenant_id, order_id, position);

-- Un repuesto consumido es un hecho historico: salio de la gaveta y se
-- quedo en casa del cliente. Inmutable desde el insert, igual que un
-- costo en `project-costing` o un mensaje de ticket en `helpdesk`.
create table public.service_parts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  order_id    uuid not null references public.service_orders(id) on delete cascade,
  product_id  uuid references public.products(id),
  description text not null,
  qty         numeric(14,4) not null check (qty > 0),
  unit_cost   numeric(12,2) not null check (unit_cost >= 0),
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create index on public.service_parts (tenant_id, order_id);

-- ── El costo de repuestos se DERIVA, nunca se guarda agregado ───────────
create function public.service_order_parts_cost(p_tenant uuid, p_order uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(qty * unit_cost), 0)
  from public.service_parts
  where tenant_id = p_tenant and order_id = p_order;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.service_orders enable row level security;
alter table public.service_orders force row level security;
alter table public.service_checklist_items enable row level security;
alter table public.service_checklist_items force row level security;
alter table public.service_parts enable row level security;
alter table public.service_parts force row level security;

create policy tenant_module on public.service_orders for all
  using (tenant_id = rls.tenant_id() and rls.module_active('field-service'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('field-service'));
create policy provider_impersonating on public.service_orders for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.service_checklist_items for all
  using (tenant_id = rls.tenant_id() and rls.module_active('field-service'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('field-service'));
create policy provider_impersonating on public.service_checklist_items for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.service_parts for all
  using (tenant_id = rls.tenant_id() and rls.module_active('field-service'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('field-service'));
create policy provider_impersonating on public.service_parts for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_orden_ajena_campo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.service_orders where id = new.order_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa orden de servicio no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_orden_ajena
  before insert on public.service_checklist_items
  for each row execute function public.impedir_orden_ajena_campo();

create trigger no_orden_ajena
  before insert on public.service_parts
  for each row execute function public.impedir_orden_ajena_campo();

create function public.impedir_producto_ajeno_repuesto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.product_id is null then return new; end if;
  select tenant_id into v_tenant from public.products where id = new.product_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_producto_ajeno_repuesto
  before insert on public.service_parts
  for each row execute function public.impedir_producto_ajeno_repuesto();

-- ── Un repuesto consumido no se reescribe ───────────────────────────────
create function public.impedir_editar_repuesto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un repuesto consumido no se edita: anulalo y registra el correcto.'
    using errcode = '42501';
end;
$$;

create trigger no_editar_repuesto
  before update on public.service_parts
  for each row execute function public.impedir_editar_repuesto();

-- ── La regla del modulo: no se cierra a medias ──────────────────────────
create function public.impedir_cerrar_orden_incompleta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pendientes integer;
begin
  if new.status <> 'done' or old.status = 'done' then
    return new;
  end if;

  select count(*) into v_pendientes
  from public.service_checklist_items
  where order_id = new.id and required and not done;

  if v_pendientes > 0 then
    raise exception 'No se puede cerrar: quedan % pasos obligatorios del checklist.', v_pendientes
      using errcode = '23514';
  end if;

  if new.signed_by is null or btrim(new.signed_by) = '' then
    raise exception 'No se puede cerrar sin la firma de quien recibio el trabajo.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger no_cerrar_incompleta
  before update on public.service_orders
  for each row execute function public.impedir_cerrar_orden_incompleta();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.service_orders
  for each row execute function audit.record('field-service');
create trigger audit_me after insert or update on public.service_checklist_items
  for each row execute function audit.record('field-service');
create trigger audit_me after insert on public.service_parts
  for each row execute function audit.record('field-service');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Una orden no se cierra sin checklist completo ni sin la firma de quien recibio',
    problem      = 'El tecnico dice que fue y que lo reviso todo; tres semanas despues el cliente dice que no vino nadie y no hay con que responderle.',
    features     = '[
      {"titulo":"Checklist obligatorio para cerrar","detalle":"Los pasos marcados como obligatorios bloquean el cierre de la orden -la regla vive en la base de datos, no en la pantalla del telefono-."},
      {"titulo":"Firma de quien recibio","detalle":"Se guarda el nombre de quien recibio el trabajo y la hora exacta: es la prueba de que la visita ocurrio."},
      {"titulo":"Repuestos consumidos, inmutables","detalle":"Lo que salio de la gaveta y quedo en casa del cliente se registra una vez y no se reescribe."},
      {"titulo":"Reprogramar sin perder el historial","detalle":"Mover una visita no obliga a cancelar la orden y abrir otra -se veria como si el trabajo nunca se hubiera pedido-."}
    ]'::jsonb,
    audience     = '{"Plomeros, tecnicos de refrigeracion, instaladores y talleres que trabajan en casa del cliente"}',
    faq          = '[
      {"p":"¿Necesito el modulo de inventario?","r":"No -se recomienda, pero un tecnico que compra el repuesto en la ferreteria de la esquina puede registrarlo por descripcion-."},
      {"p":"¿La firma es un garabato en la pantalla?","r":"No -es el nombre de quien recibio y la hora; en un telefono barato el trazo se pierde y el nombre no-."},
      {"p":"¿Puedo cerrar una orden si falta un paso opcional?","r":"Si -solo los pasos marcados como obligatorios bloquean el cierre-."}
    ]'::jsonb,
    setup_minutes = 20
where id = 'field-service';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'field-service'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'field-service no tiene precio en los 3 tiers';
  end if;
end $$;
