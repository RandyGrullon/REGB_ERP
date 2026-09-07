-- ═══════════════════════════════════════════════════════════════════════
--  0067 — Transferencias (modulo 50, F8/S47)
--
--  `inventory` (0019) ya tiene `stock_transfers`: un movimiento simple,
--  en un solo paso, sin estado de transito -pensado para un colmado
--  con un almacen y una sucursal, moviendo cuatro cajas-. Este modulo
--  NO la reemplaza ni la toca: agrega el flujo completo -despachado,
--  en transito, recibido, con discrepancia si lo que llega no es lo
--  mismo que salio- para quien de verdad necesita rastrear un traslado
--  entre almacenes distantes.
--
--  transicionValidaTransferencia() (@regb/operations) valida la
--  maquina de estados. La discrepancia al recibir reutiliza
--  detectarDiscrepancia() de receipts.ts -misma pregunta, no una
--  funcion nueva-.
-- ═══════════════════════════════════════════════════════════════════════

create table public.transfer_orders (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references regb.tenants(id) on delete cascade,
  from_warehouse_id  uuid not null references public.warehouses(id),
  to_warehouse_id    uuid not null references public.warehouses(id),
  status             text not null default 'draft'
                       check (status in ('draft', 'in_transit', 'received', 'cancelled')),
  notes              text,
  created_by         uuid,
  dispatched_at      timestamptz,
  received_at        timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (from_warehouse_id <> to_warehouse_id)
);

create index on public.transfer_orders (tenant_id, status);
create index on public.transfer_orders (tenant_id, from_warehouse_id);
create index on public.transfer_orders (tenant_id, to_warehouse_id);

create table public.transfer_order_lines (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.transfer_orders(id) on delete cascade,
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  product_id     uuid not null references public.products(id),
  -- Lo pedido -editable mientras la orden sigue en draft-.
  qty_requested  numeric(14,3) not null check (qty_requested > 0),
  -- Lo que de verdad salio del almacen de origen -null hasta despachar,
  -- fijo desde ese momento-.
  qty_sent       numeric(14,3) check (qty_sent >= 0),
  -- Lo que de verdad llego al almacen de destino -null hasta recibir,
  -- puede ser distinto de qty_sent: eso ES la discrepancia-.
  qty_received   numeric(14,3) check (qty_received >= 0)
);

create index on public.transfer_order_lines (tenant_id, order_id);
create index on public.transfer_order_lines (tenant_id, product_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.transfer_orders enable row level security;
alter table public.transfer_orders force row level security;
alter table public.transfer_order_lines enable row level security;
alter table public.transfer_order_lines force row level security;

create policy tenant_module on public.transfer_orders for all
  using (tenant_id = rls.tenant_id() and rls.module_active('transfers'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('transfers'));
create policy provider_impersonating on public.transfer_orders for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.transfer_order_lines for all
  using (tenant_id = rls.tenant_id() and rls.module_active('transfers'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('transfers'));
create policy provider_impersonating on public.transfer_order_lines for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenecen las referencias.
create function public.impedir_transferencia_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_origen  uuid;
  v_tenant_destino uuid;
begin
  select tenant_id into v_tenant_origen from public.warehouses where id = new.from_warehouse_id;
  if v_tenant_origen is distinct from new.tenant_id then
    raise exception 'Ese almacen de origen no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_destino from public.warehouses where id = new.to_warehouse_id;
  if v_tenant_destino is distinct from new.tenant_id then
    raise exception 'Ese almacen de destino no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_transferencia_ajena before insert or update on public.transfer_orders
  for each row execute function public.impedir_transferencia_ajena();

create function public.impedir_referencia_ajena_linea_transferencia() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_orden uuid;
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_orden from public.transfer_orders where id = new.order_id;
  if v_tenant_orden is distinct from new.tenant_id then
    raise exception 'Esa transferencia no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_producto from public.products where id = new.product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_linea_transferencia
  before insert or update on public.transfer_order_lines
  for each row execute function public.impedir_referencia_ajena_linea_transferencia();

-- ── Inmutabilidad condicional, por campo -no por fila entera- ──────────
-- Una vez despachada (qty_sent lleno), lo pedido ya no se puede cambiar
-- -el camion ya salio con esa cantidad-. Una vez recibida (qty_received
-- lleno), la linea entera queda fija: es un hecho historico completo.
create function public.impedir_editar_linea_transferencia_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.qty_received is not null then
    raise exception 'Esa linea ya fue recibida y no se edita.' using errcode = '55000';
  end if;
  if old.qty_sent is not null and new.qty_requested is distinct from old.qty_requested then
    raise exception 'Esa linea ya fue despachada; lo pedido no se puede cambiar.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger no_editar_linea_transferencia_resuelta
  before update on public.transfer_order_lines
  for each row execute function public.impedir_editar_linea_transferencia_resuelta();

create function public.impedir_borrar_linea_transferencia_despachada() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.qty_sent is not null then
    raise exception 'Esa linea ya fue despachada y no se borra.' using errcode = '55000';
  end if;
  return old;
end;
$$;

create trigger no_borrar_linea_transferencia_despachada
  before delete on public.transfer_order_lines
  for each row execute function public.impedir_borrar_linea_transferencia_despachada();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.transfer_orders
  for each row execute function audit.record('transfers');
create trigger audit_me after insert or update or delete on public.transfer_order_lines
  for each row execute function audit.record('transfers');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Transito de verdad -despachado no es lo mismo que recibido, y la diferencia se ve-',
    problem      = 'Sin estado de transito, un traslado entre almacenes lejanos "desaparece" un dia entero: no se sabe si ya salio, si llego, ni si llego completo.',
    features     = '[
      {"titulo":"Tres momentos, no uno solo","detalle":"Despachado mueve el inventario del origen; recibido mueve el del destino -son dos movimientos distintos, con el tiempo real de transito entre ellos-."},
      {"titulo":"La discrepancia se ve al recibir","detalle":"Lo que llega puede ser distinto de lo que salio -perdida en el camino, error de conteo-, y el sistema lo muestra en vez de asumir que coinciden."},
      {"titulo":"No reemplaza la transferencia simple de inventory","detalle":"Un traslado de un solo paso entre almacenes cercanos sigue disponible sin este modulo -esto es para quien necesita rastrear el transito, no una obligacion-."}
    ]'::jsonb,
    audience     = '{"Negocios con mas de un almacen lejos entre si","Cualquiera al que se le haya perdido mercancia en un traslado sin poder probarlo"}',
    faq          = '[
      {"p":"¿Reemplaza la transferencia simple que ya tiene inventory?","r":"No -esa sigue funcionando para traslados de un solo paso. Este modulo agrega el estado de transito para quien lo necesita-."},
      {"p":"¿Que pasa si lo que llega es distinto de lo que salio?","r":"Se registra tal cual -el sistema no bloquea la recepcion, solo muestra la diferencia-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'transfers';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'transfers'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'transfers no tiene precio en los 3 tiers';
  end if;
end $$;
