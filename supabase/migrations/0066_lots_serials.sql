-- ═══════════════════════════════════════════════════════════════════════
--  0066 — Lotes, series y vencimientos (modulo 49, F8/S46)
--
--  FEFO (first-expired-first-out) real: seleccionFefo() en
--  @regb/operations/lots-serials.ts elige de que lote sacar cada unidad
--  -el que vence mas pronto primero-, un algoritmo, no una tabla que
--  alguien revisa a mano. La vigencia de un lote reutiliza
--  certificadoVigente() de training.ts (reexportada como loteVigente())
--  en vez de reinventar "esto ya vencio?".
--
--  Un item SERIALIZADO no es un concepto aparte: es un lote de
--  cantidad 1 cuyo lot_number ES el numero de serie. No hay columna de
--  serial separada -mantiene el esquema en una sola idea, no dos-.
--
--  Honesto sobre el alcance: el consumo FEFO es una accion MANUAL
--  ("consumir stock") que corre el algoritmo por el usuario -todavia
--  NO esta conectado al checkout de sales-orders/pos, que seguiria
--  vendiendo sin elegir lote automaticamente-. Esa integracion es un
--  paso futuro, declarado explicitamente.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.products add column if not exists tracks_lots boolean not null default false;

-- Un lote es un registro vivo, no un hecho historico congelado: corregir
-- una fecha de vencimiento mal capturada es una correccion de datos
-- legitima, no una reescritura de la historia -mismo criterio que los
-- objetivos de OKR en performance (0059), sin trigger de inmutabilidad-.
create table public.product_lots (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references regb.tenants(id) on delete cascade,
  product_id         uuid not null references public.products(id),
  lot_number         text not null,
  expiry_date        date,
  manufactured_date  date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, product_id, lot_number)
);

create index on public.product_lots (tenant_id, product_id);
create index on public.product_lots (tenant_id, expiry_date);

comment on column public.product_lots.lot_number is
  'Para un item serializado, el numero de serie ES el lot_number -cantidad siempre 1, sin columna aparte-.';

-- Existencia por lote: la misma idea que stock_levels (0019), pero
-- desglosada por lote en vez de solo por producto. Es una PROYECCION
-- que muta con cada movimiento, igual que stock_levels -no lleva
-- trigger de inmutabilidad-.
create table public.lot_stock (
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  warehouse_id  uuid not null references public.warehouses(id),
  lot_id        uuid not null references public.product_lots(id),
  qty_on_hand   numeric(14,3) not null default 0 check (qty_on_hand >= 0),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, warehouse_id, lot_id)
);

create index on public.lot_stock (tenant_id, lot_id);

-- El kardex ya existente (0019) gana una columna nueva y opcional: que
-- movimientos SI se pueden atar a un lote. Aditivo -ningun movimiento
-- viejo ni de un producto sin tracks_lots necesita llenarla-.
alter table public.inventory_movements add column if not exists lot_id uuid references public.product_lots(id);
create index on public.inventory_movements (tenant_id, lot_id) where lot_id is not null;

-- ── Recall: abrir/cerrar, sobre un producto entero o un lote especifico ──
create table public.product_recalls (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  -- Nulo = recall de TODO el producto, no de un lote en particular.
  lot_id       uuid references public.product_lots(id),
  reason       text not null,
  status       text not null default 'open' check (status in ('open', 'closed')),
  created_at   timestamptz not null default now(),
  closed_at    timestamptz
);

create index on public.product_recalls (tenant_id, product_id);
create index on public.product_recalls (tenant_id, status);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.product_lots enable row level security;
alter table public.product_lots force row level security;
alter table public.lot_stock enable row level security;
alter table public.lot_stock force row level security;
alter table public.product_recalls enable row level security;
alter table public.product_recalls force row level security;

create policy tenant_module on public.product_lots for all
  using (tenant_id = rls.tenant_id() and rls.module_active('lots-serials'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('lots-serials'));
create policy provider_impersonating on public.product_lots for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.lot_stock for all
  using (tenant_id = rls.tenant_id() and rls.module_active('lots-serials'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('lots-serials'));
create policy provider_impersonating on public.lot_stock for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.product_recalls for all
  using (tenant_id = rls.tenant_id() and rls.module_active('lots-serials'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('lots-serials'));
create policy provider_impersonating on public.product_recalls for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenecen las referencias.
create function public.impedir_lote_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_producto from public.products where id = new.product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_lote_ajeno before insert or update on public.product_lots
  for each row execute function public.impedir_lote_ajeno();

create function public.impedir_referencia_ajena_lot_stock() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_almacen uuid;
  v_tenant_lote uuid;
begin
  select tenant_id into v_tenant_almacen from public.warehouses where id = new.warehouse_id;
  if v_tenant_almacen is distinct from new.tenant_id then
    raise exception 'Ese almacen no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_lote from public.product_lots where id = new.lot_id;
  if v_tenant_lote is distinct from new.tenant_id then
    raise exception 'Ese lote no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_lot_stock before insert or update on public.lot_stock
  for each row execute function public.impedir_referencia_ajena_lot_stock();

create function public.impedir_recall_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_producto uuid;
  v_tenant_lote uuid;
begin
  select tenant_id into v_tenant_producto from public.products where id = new.product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  if new.lot_id is not null then
    select tenant_id into v_tenant_lote from public.product_lots where id = new.lot_id;
    if v_tenant_lote is distinct from new.tenant_id then
      raise exception 'Ese lote no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger no_recall_ajeno before insert or update on public.product_recalls
  for each row execute function public.impedir_recall_ajeno();

-- Un recall cerrado es terminal -reabrirlo es una decision humana que
-- crea un recall nuevo, no una edicion del viejo-.
create function public.impedir_editar_recall_cerrado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'closed' then
    raise exception 'Ese recall ya esta cerrado y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_recall_cerrado
  before update or delete on public.product_recalls
  for each row execute function public.impedir_editar_recall_cerrado();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.product_lots
  for each row execute function audit.record('lots-serials');
create trigger audit_me after insert or update or delete on public.product_recalls
  for each row execute function audit.record('lots-serials');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'FEFO de verdad -el algoritmo elige el lote, nadie tiene que acordarse cual vence primero-',
    problem      = 'Sin trazabilidad por lote, un producto vencido se descubre cuando el cliente se queja, y un recall real no tiene como saber que salio de la puerta y a quien.',
    features     = '[
      {"titulo":"FEFO como algoritmo, no como memoria","detalle":"Consumir stock elige solo de que lote sacar cada unidad -el que vence mas pronto primero-, nunca a criterio de quien despacha."},
      {"titulo":"Alertas de vencimiento antes de que sea tarde","detalle":"Un lote por vencer se ve distinto de uno ya vencido -dos alertas separadas, no una sola confusa-."},
      {"titulo":"Recall real, por producto o por lote especifico","detalle":"Abrir un recall sobre un lote exacto, no sobre todo el catalogo, cuando el problema es de un solo lote."}
    ]'::jsonb,
    audience     = '{"Negocios con productos perecederos o con vencimiento (alimentos, farmacia, quimicos)","Cualquiera que necesite trazabilidad real por numero de serie"}',
    faq          = '[
      {"p":"¿El FEFO se aplica solo al vender?","r":"Todavia no -es una accion manual (consumir stock) que corre el mismo algoritmo, pero no esta conectada al checkout de sales-orders o pos-. Esa integracion es un paso futuro."},
      {"p":"¿Los numeros de serie son una tabla aparte?","r":"No -un item serializado es un lote de cantidad 1 cuyo numero de lote ES el numero de serie, para no duplicar el concepto-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'lots-serials';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'lots-serials'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'lots-serials no tiene precio en los 3 tiers';
  end if;
end $$;
