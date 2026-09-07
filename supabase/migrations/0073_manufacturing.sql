-- ═══════════════════════════════════════════════════════════════════════
--  0073 — Ordenes de produccion (modulo 56, F8.5/S50-51)
--
--  Lanzamiento, consumo, reporte de avance y mermas -sobre el BOM
--  activo del producto, requiere `bom`-. explotarCantidad() de bom.ts
--  se reutiliza para la explosion de componentes; progresoResultadoClave()
--  de performance.ts se reutiliza para el porcentaje de avance -misma
--  pregunta que un resultado clave de OKR-.
--
--  Simplificacion deliberada: el consumo de componentes es "backflush
--  al liberar" -toda la cantidad requerida se consume de una vez al
--  pasar la orden a `released`, no proporcional al avance reportado-.
--  Por esto mismo, una orden ya liberada NO se puede cancelar: el
--  inventario ya se consumio, y revertirlo es un ajuste manual, no
--  parte de este modulo.
-- ═══════════════════════════════════════════════════════════════════════

create table public.production_orders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  bom_id        uuid not null references public.bill_of_materials(id),
  warehouse_id  uuid not null references public.warehouses(id),
  status        text not null default 'draft'
                  check (status in ('draft', 'released', 'in_progress', 'completed', 'cancelled')),
  qty_planned   numeric(14,3) not null check (qty_planned > 0),
  qty_completed numeric(14,3) not null default 0 check (qty_completed >= 0),
  qty_scrapped  numeric(14,3) not null default 0 check (qty_scrapped >= 0),
  notes         text,
  created_by    uuid,
  released_at   timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.production_orders (tenant_id, bom_id);
create index on public.production_orders (tenant_id, status);

-- Snapshot de la explosion de componentes AL LIBERAR -no existen hasta
-- ese momento-: qty_consumed ya viene fijo, es un hecho historico
-- desde que se crea la fila, no un plan que se ajusta despues.
create table public.production_order_lines (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.production_orders(id) on delete cascade,
  tenant_id             uuid not null references regb.tenants(id) on delete cascade,
  component_product_id  uuid not null references public.products(id),
  qty_required          numeric(14,4) not null check (qty_required > 0),
  qty_consumed          numeric(14,4) not null check (qty_consumed >= 0)
);

create index on public.production_order_lines (tenant_id, order_id);

-- Un reporte de avance es un hecho historico -paso en un momento
-- dado-: inmutable desde el primer insert, igual que fuel_logs (0070).
create table public.production_reports (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.production_orders(id) on delete cascade,
  tenant_id             uuid not null references regb.tenants(id) on delete cascade,
  qty_completed_delta   numeric(14,3) not null default 0 check (qty_completed_delta >= 0),
  qty_scrapped_delta    numeric(14,3) not null default 0 check (qty_scrapped_delta >= 0),
  reported_by           uuid,
  reported_at           timestamptz not null default now(),
  notes                 text,
  check (qty_completed_delta > 0 or qty_scrapped_delta > 0)
);

create index on public.production_reports (tenant_id, order_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.production_orders enable row level security;
alter table public.production_orders force row level security;
alter table public.production_order_lines enable row level security;
alter table public.production_order_lines force row level security;
alter table public.production_reports enable row level security;
alter table public.production_reports force row level security;

create policy tenant_module on public.production_orders for all
  using (tenant_id = rls.tenant_id() and rls.module_active('manufacturing'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('manufacturing'));
create policy provider_impersonating on public.production_orders for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.production_order_lines for all
  using (tenant_id = rls.tenant_id() and rls.module_active('manufacturing'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('manufacturing'));
create policy provider_impersonating on public.production_order_lines for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.production_reports for all
  using (tenant_id = rls.tenant_id() and rls.module_active('manufacturing'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('manufacturing'));
create policy provider_impersonating on public.production_reports for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenecen las referencias.
create function public.impedir_orden_produccion_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_bom uuid;
  v_tenant_almacen uuid;
begin
  select tenant_id into v_tenant_bom from public.bill_of_materials where id = new.bom_id;
  if v_tenant_bom is distinct from new.tenant_id then
    raise exception 'Ese BOM no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_almacen from public.warehouses where id = new.warehouse_id;
  if v_tenant_almacen is distinct from new.tenant_id then
    raise exception 'Ese almacen no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_orden_produccion_ajena before insert or update on public.production_orders
  for each row execute function public.impedir_orden_produccion_ajena();

create function public.impedir_referencia_ajena_linea_produccion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_orden uuid;
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_orden from public.production_orders where id = new.order_id;
  if v_tenant_orden is distinct from new.tenant_id then
    raise exception 'Esa orden de produccion no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_producto from public.products where id = new.component_product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese componente no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_linea_produccion
  before insert or update on public.production_order_lines
  for each row execute function public.impedir_referencia_ajena_linea_produccion();

create function public.impedir_reporte_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_orden uuid;
begin
  select tenant_id into v_tenant_orden from public.production_orders where id = new.order_id;
  if v_tenant_orden is distinct from new.tenant_id then
    raise exception 'Esa orden de produccion no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_reporte_ajeno before insert or update on public.production_reports
  for each row execute function public.impedir_reporte_ajeno();

-- ── Inmutabilidad ─────────────────────────────────────────────────────
-- Una orden deja de ser editable en su "receta" (bom_id, warehouse_id,
-- qty_planned, notes) en cuanto sale de draft -pero SI se permite que
-- status/qty_completed/qty_scrapped/released_at/completed_at avancen,
-- porque eso es el progreso mismo de la orden, no una correccion-.
-- Borrarla tampoco se permite fuera de draft.
create function public.impedir_editar_orden_produccion_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if old.status != 'draft' then
      raise exception 'Esa orden ya no esta en borrador y no se borra.' using errcode = '55000';
    end if;
    return old;
  end if;

  if old.status != 'draft' then
    if new.bom_id is distinct from old.bom_id
       or new.warehouse_id is distinct from old.warehouse_id
       or new.qty_planned is distinct from old.qty_planned
       or new.notes is distinct from old.notes then
      raise exception 'Esa orden ya no esta en borrador; su receta no se puede cambiar.' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_editar_orden_produccion_resuelta
  before update or delete on public.production_orders
  for each row execute function public.impedir_editar_orden_produccion_resuelta();

-- Las lineas nacen ya consumidas -al liberar la orden-: son un hecho
-- historico desde el primer insert, sin condicion.
create function public.impedir_editar_linea_produccion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una linea de produccion ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_linea_produccion
  before update or delete on public.production_order_lines
  for each row execute function public.impedir_editar_linea_produccion();

create function public.impedir_editar_reporte() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un reporte de avance ya registrado no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_reporte
  before update or delete on public.production_reports
  for each row execute function public.impedir_editar_reporte();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.production_orders
  for each row execute function audit.record('manufacturing');
create trigger audit_me after insert or update or delete on public.production_reports
  for each row execute function audit.record('manufacturing');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Explosion de materiales real al liberar, avance y mermas reportados con su propio historial',
    problem      = 'Sin esto, lanzar una orden de produccion significa descontar el inventario a mano, y no queda registro de cuanto se produjo bien y cuanto se perdio en merma.',
    features     = '[
      {"titulo":"Explosion de materiales real","detalle":"Al liberar la orden, se calcula y se consume exactamente lo que la receta activa exige -no una estimacion a mano-."},
      {"titulo":"Avance y merma con su propio historial","detalle":"Cada reporte de produccion queda registrado por separado -cuanto se completo, cuanto se perdio en merma-, nunca sobrescrito."},
      {"titulo":"Honesto sobre el consumo","detalle":"Los componentes se consumen de una vez al liberar, no proporcional al avance -por eso una orden liberada ya no se cancela, el inventario ya salio-."}
    ]'::jsonb,
    audience     = '{"Negocios que fabrican o ensamblan lo que venden y ya usan bom","Cualquiera que hoy descuente el inventario de produccion a mano en una hoja aparte"}',
    faq          = '[
      {"p":"¿Puedo cancelar una orden ya liberada?","r":"No -los componentes ya se consumieron del inventario. Revertir eso es un ajuste manual, no una accion de este modulo-."},
      {"p":"¿El consumo es proporcional al avance reportado?","r":"No -se consume todo de una vez al liberar la orden (backflush), no poco a poco segun se reporta avance-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'manufacturing';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'manufacturing'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'manufacturing no tiene precio en los 3 tiers';
  end if;
end $$;
