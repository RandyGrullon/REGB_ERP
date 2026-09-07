-- ═══════════════════════════════════════════════════════════════════════
--  0065 — Recepciones (modulo 46, F8/S45)
--
--  `purchase-orders` (45) ya sabe recibir una linea a la vez: incrementa
--  qty_received, postea el movimiento de inventario, deriva el estado de
--  la orden (recibirLinea() en apps/web/src/app/compras/actions.ts). Este
--  modulo NO reinventa eso -reutiliza pendingReceipt()/validateReceipt()/
--  costVariance() de @regb/operations/procurement.ts tal cual-.
--
--  Lo que agrega de verdad, y que la orden de compra por si sola no
--  tiene:
--    1. Un documento de recepcion que agrupa varias lineas de un mismo
--       camion con quien recibio, no una accion suelta por linea.
--    2. INSPECCION real: cuanto se acepta contra cuanto se rechaza, no
--       solo "cuanto llego".
--    3. Discrepancia detectada automaticamente contra lo esperado.
--    4. Devolucion al proveedor de lo rechazado, con su propio
--       movimiento de inventario en sentido contrario.
--
--  Honesto sobre el alcance: la devolucion queda registrada y mueve el
--  inventario -sale del almacen-, pero NO genera una nota de credito ni
--  un ajuste en `ap` automaticamente. Esa integracion contable es un
--  paso futuro, declarado explicitamente.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Un movimiento de salida nuevo: devolver al proveedor ─────────────────
-- Mismo trigger de 0019 (apply_inventory_movement): solo mira el signo de
-- qty, no necesita saber de "receipts" para nada.
alter table public.inventory_movements
  drop constraint inventory_movements_movement_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check check (movement_type in (
    'receipt', 'sale', 'adjustment_in', 'adjustment_out',
    'transfer_in', 'transfer_out', 'reservation',
    'reservation_release', 'count_adjustment', 'return_to_supplier'
  ));

create table public.goods_receipts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references regb.tenants(id) on delete cascade,
  purchase_order_id  uuid not null references public.purchase_orders(id),
  warehouse_id       uuid not null references public.warehouses(id),
  supplier_id        uuid not null references public.suppliers(id),
  -- Usuario autenticado que recibio -no una fila de employees; mismo
  -- criterio que decided_by en time-off (0054) y approved_by en
  -- requisitions (0063, corregido)-.
  received_by        uuid,
  received_at        timestamptz not null default now(),
  notes              text,
  -- Se DERIVA de las lineas (deriveGoodsReceiptStatus), no se escribe a
  -- mano: mismo principio que purchase_orders.status.
  status             text not null default 'completed'
                       check (status in ('completed', 'with_discrepancies')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index on public.goods_receipts (tenant_id, purchase_order_id);
create index on public.goods_receipts (tenant_id, supplier_id);

create table public.goods_receipt_lines (
  id                      uuid primary key default gen_random_uuid(),
  receipt_id              uuid not null references public.goods_receipts(id) on delete cascade,
  tenant_id               uuid not null references regb.tenants(id) on delete cascade,
  purchase_order_line_id  uuid not null references public.purchase_order_lines(id),
  product_id              uuid not null references public.products(id),
  -- Foto de lo pendiente (pendingReceipt()) AL MOMENTO de esta recepcion,
  -- no lo pedido originalmente: si ya se habia recibido una parte antes,
  -- lo esperado esta vez es lo que queda, no el total de la orden.
  qty_expected            numeric(14,3) not null check (qty_expected >= 0),
  qty_received            numeric(14,3) not null check (qty_received > 0),
  qty_accepted            numeric(14,3) not null check (qty_accepted >= 0),
  qty_rejected            numeric(14,3) not null check (qty_rejected >= 0),
  rejection_reason        text,
  unit_cost               numeric(12,4) not null check (unit_cost >= 0),
  created_at              timestamptz not null default now(),
  -- validateInspeccion(): aceptado + rechazado tiene que ser exactamente
  -- lo recibido -no puede desaparecer unidades entre inspeccionar y
  -- registrar-.
  check (qty_accepted + qty_rejected = qty_received)
);

create index on public.goods_receipt_lines (tenant_id, receipt_id);
create index on public.goods_receipt_lines (tenant_id, purchase_order_line_id);

create table public.supplier_returns (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references regb.tenants(id) on delete cascade,
  goods_receipt_line_id   uuid not null references public.goods_receipt_lines(id),
  supplier_id             uuid not null references public.suppliers(id),
  qty                     numeric(14,3) not null check (qty > 0),
  reason                  text not null,
  status                  text not null default 'pending'
                            check (status in ('pending', 'sent', 'cancelled')),
  sent_at                 timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index on public.supplier_returns (tenant_id, goods_receipt_line_id);
create index on public.supplier_returns (tenant_id, status);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.goods_receipts enable row level security;
alter table public.goods_receipts force row level security;
alter table public.goods_receipt_lines enable row level security;
alter table public.goods_receipt_lines force row level security;
alter table public.supplier_returns enable row level security;
alter table public.supplier_returns force row level security;

create policy tenant_module on public.goods_receipts for all
  using (tenant_id = rls.tenant_id() and rls.module_active('receipts'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('receipts'));
create policy provider_impersonating on public.goods_receipts for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.goods_receipt_lines for all
  using (tenant_id = rls.tenant_id() and rls.module_active('receipts'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('receipts'));
create policy provider_impersonating on public.goods_receipt_lines for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.supplier_returns for all
  using (tenant_id = rls.tenant_id() and rls.module_active('receipts'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('receipts'));
create policy provider_impersonating on public.supplier_returns for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenecen las referencias.
create function public.impedir_recepcion_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_orden uuid;
  v_tenant_almacen uuid;
  v_tenant_proveedor uuid;
begin
  select tenant_id into v_tenant_orden from public.purchase_orders where id = new.purchase_order_id;
  if v_tenant_orden is distinct from new.tenant_id then
    raise exception 'Esa orden de compra no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_almacen from public.warehouses where id = new.warehouse_id;
  if v_tenant_almacen is distinct from new.tenant_id then
    raise exception 'Ese almacen no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_proveedor from public.suppliers where id = new.supplier_id;
  if v_tenant_proveedor is distinct from new.tenant_id then
    raise exception 'Ese proveedor no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_recepcion_ajena before insert or update on public.goods_receipts
  for each row execute function public.impedir_recepcion_ajena();

create function public.impedir_referencia_ajena_linea_recepcion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_linea_orden uuid;
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_linea_orden
    from public.purchase_order_lines where id = new.purchase_order_line_id;
  if v_tenant_linea_orden is distinct from new.tenant_id then
    raise exception 'Esa linea de orden no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_producto from public.products where id = new.product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_linea_recepcion
  before insert or update on public.goods_receipt_lines
  for each row execute function public.impedir_referencia_ajena_linea_recepcion();

create function public.impedir_devolucion_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_linea uuid;
  v_tenant_proveedor uuid;
begin
  select tenant_id into v_tenant_linea
    from public.goods_receipt_lines where id = new.goods_receipt_line_id;
  if v_tenant_linea is distinct from new.tenant_id then
    raise exception 'Esa linea de recepcion no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_proveedor from public.suppliers where id = new.supplier_id;
  if v_tenant_proveedor is distinct from new.tenant_id then
    raise exception 'Ese proveedor no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_devolucion_ajena before insert or update on public.supplier_returns
  for each row execute function public.impedir_devolucion_ajena();

-- ── Inmutabilidad ─────────────────────────────────────────────────────
-- Un documento de recepcion es un hecho historico -lo que de verdad
-- llego y se inspecciono en un momento dado-, no un borrador: inmutable
-- desde el primer insert, sin condicion. Mismo criterio que rfq_quotes
-- (0064) o benefit_loan_payments (0057).
create function public.impedir_editar_recepcion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una recepcion ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_recepcion
  before update or delete on public.goods_receipts
  for each row execute function public.impedir_editar_recepcion();

create trigger no_editar_linea_recepcion
  before update or delete on public.goods_receipt_lines
  for each row execute function public.impedir_editar_recepcion();

-- La devolucion SI es un flujo con estados: pending es editable (por si
-- se corrige la cantidad o la razon antes de despacharla), sent/cancelled
-- son terminales.
create function public.impedir_editar_devolucion_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('sent', 'cancelled') then
    raise exception 'Esa devolucion ya quedo resuelta y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_devolucion_resuelta
  before update or delete on public.supplier_returns
  for each row execute function public.impedir_editar_devolucion_resuelta();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.goods_receipts
  for each row execute function audit.record('receipts');
create trigger audit_me after insert or update or delete on public.goods_receipt_lines
  for each row execute function audit.record('receipts');
create trigger audit_me after insert or update or delete on public.supplier_returns
  for each row execute function audit.record('receipts');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Inspeccion real al recibir, no solo contar cajas -y devolucion al proveedor cuando algo llega mal-',
    problem      = 'Sin esto, lo que llega en el camion se da por bueno de una vez: nadie deja constancia de lo que se rechazo ni de que se le devolvio al proveedor.',
    features     = '[
      {"titulo":"Inspeccion, no solo conteo","detalle":"Cada linea recibida se divide en aceptado y rechazado, con la razon del rechazo -no basta con anotar cuanto llego-."},
      {"titulo":"La discrepancia se detecta sola","detalle":"Si lo que llego no coincide con lo esperado, el documento entero queda marcado -nadie tiene que comparar dos numeros a mano-."},
      {"titulo":"Devolucion con su propio movimiento de inventario","detalle":"Lo rechazado se puede devolver al proveedor, y ese movimiento sale del almacen de verdad -no solo queda anotado en un papel-."}
    ]'::jsonb,
    audience     = '{"Negocios que ya usan purchase-orders y reciben mercancia de proveedores con regularidad","Cualquiera al que le haya llegado un pedido incompleto o con productos danados y no tenga como probarlo"}',
    faq          = '[
      {"p":"¿La devolucion genera una nota de credito o ajusta lo que se le debe al proveedor?","r":"Todavia no -queda registrada y mueve el inventario, pero la integracion con ap es un paso futuro-."},
      {"p":"¿Reemplaza la recepcion que ya trae purchase-orders?","r":"No -la complementa. purchase-orders recibe linea por linea; este modulo agrupa varias lineas de un mismo camion en un documento con inspeccion y discrepancia-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'receipts';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'receipts'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'receipts no tiene precio en los 3 tiers';
  end if;
end $$;
