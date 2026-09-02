-- ═══════════════════════════════════════════════════════════════════════
--  0019 — Inventario: almacenes, kardex y existencias (F4 · S19)
--
--  El corazon de F4. Tres piezas:
--   1. warehouses     — donde esta fisicamente el stock
--   2. inventory_movements — el kardex: cada entrada y salida, INMUTABLE
--   3. stock_levels   — la foto actual (on_hand, reservado, costo promedio),
--                        mantenida por trigger sobre el kardex
--
--  Decision: tabla propia de almacenes, no reutilizar `branches`. El propio
--  documento maestro describe `transfers` (#50, F8) como "entre almacenes Y
--  sucursales" — son conceptos distintos mas adelante. Colgar el stock de
--  branch_id hoy obligaria a migrar TODO el historico de movimientos cuando
--  llegue F8. Separar ahora es barato; separar despues no.
--
--  Decision: costeo por PROMEDIO PONDERADO, no FIFO. FIFO real exige capas
--  de lotes (que entrada especifica se esta consumiendo), y eso es
--  exactamente lo que construye `lots-serials` en F8. La formula vive en
--  @regb/operations (src/costing.ts) y aqui solo se replica en SQL porque el
--  trigger no puede llamar a TypeScript.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Almacenes ────────────────────────────────────────────────────────────
create table public.warehouses (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  branch_id  uuid references public.branches(id) on delete set null,
  name       text not null,
  code       text,
  is_default boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

-- Un solo almacen puede ser el default: es donde cae el stock cuando el
-- usuario no elige uno explicitamente.
create unique index warehouses_one_default_idx
  on public.warehouses (tenant_id)
  where is_default;

create index on public.warehouses (tenant_id, is_active);

comment on column public.warehouses.branch_id is
  'Sucursal fisica donde esta este almacen. Nulo = deposito central sin cara al publico.';

-- ── Kardex: INMUTABLE por diseno ──────────────────────────────────────────
--  Append-only de verdad. Corregir un movimiento es registrar el CONTRARIO,
--  nunca editar ni borrar la fila original — igual que audit.log.
create table public.inventory_movements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  warehouse_id   uuid not null references public.warehouses(id),
  product_id     uuid not null references public.products(id),
  movement_type  text not null check (movement_type in (
                   'receipt', 'sale', 'adjustment_in', 'adjustment_out',
                   'transfer_in', 'transfer_out', 'reservation',
                   'reservation_release', 'count_adjustment'
                 )),
  -- Positiva = entra al on_hand (receipt, adjustment_in, transfer_in,
  -- reservation_release). Negativa = sale (sale, adjustment_out,
  -- transfer_out, reservation). `reservation`/`reservation_release` NO
  -- tocan on_hand, solo qty_reserved — ver el trigger.
  qty            numeric(14,3) not null check (qty <> 0),
  unit_cost      numeric(12,4) check (unit_cost >= 0),
  reference_type text,
  reference_id   uuid,
  reason         text,
  notes          text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);

create index on public.inventory_movements (tenant_id, product_id, created_at desc);
create index on public.inventory_movements (tenant_id, warehouse_id, created_at desc);
create index on public.inventory_movements (tenant_id, reference_type, reference_id);

comment on table public.inventory_movements is
  'Kardex inmutable. Sin politica de update/delete: force RLS lo deniega. Corregir = movimiento contrario.';

-- ── Existencias: la foto vigente ─────────────────────────────────────────
create table public.stock_levels (
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  warehouse_id  uuid not null references public.warehouses(id),
  product_id    uuid not null references public.products(id),
  qty_on_hand   numeric(14,3) not null default 0,
  qty_reserved  numeric(14,3) not null default 0 check (qty_reserved >= 0),
  avg_cost      numeric(12,4) not null default 0 check (avg_cost >= 0),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, warehouse_id, product_id)
);

create index on public.stock_levels (tenant_id, product_id);
-- Para la alerta de bajo stock: solo mira productos con punto de reorden.
create index stock_levels_low_idx on public.stock_levels (tenant_id, warehouse_id)
  include (product_id, qty_on_hand);

-- ── Conteos ciclicos ──────────────────────────────────────────────────────
create table public.stock_counts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id),
  status       text not null default 'open' check (status in ('open', 'closed')),
  started_by   uuid,
  started_at   timestamptz not null default now(),
  closed_at    timestamptz
);

create table public.stock_count_lines (
  id          uuid primary key default gen_random_uuid(),
  count_id    uuid not null references public.stock_counts(id) on delete cascade,
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  product_id  uuid not null references public.products(id),
  -- Fotografia del sistema AL ABRIR el conteo, no al cerrar: si algo se
  -- vendio mientras se contaba, la diferencia debe reflejarlo.
  system_qty  numeric(14,3) not null,
  counted_qty numeric(14,3),
  unique (count_id, product_id)
);

create index on public.stock_count_lines (tenant_id, count_id);

-- ── Transferencias simples (un solo paso, sin "en transito") ─────────────
--  Version minima para F4. La version completa con estado de transito es
--  `transfers` (#50), que llega en F8 y reemplaza esta.
create table public.stock_transfers (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references regb.tenants(id) on delete cascade,
  from_warehouse_id uuid not null references public.warehouses(id),
  to_warehouse_id   uuid not null references public.warehouses(id)
                       check (to_warehouse_id <> from_warehouse_id),
  status            text not null default 'draft' check (status in ('draft', 'completed', 'cancelled')),
  created_by        uuid,
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);

create table public.stock_transfer_lines (
  id            uuid primary key default gen_random_uuid(),
  transfer_id   uuid not null references public.stock_transfers(id) on delete cascade,
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  qty           numeric(14,3) not null check (qty > 0)
);

create index on public.stock_transfer_lines (tenant_id, transfer_id);

-- ═══════════════════════════════════════════════════════════════════════
--  Trigger: el kardex alimenta stock_levels
-- ═══════════════════════════════════════════════════════════════════════
--  Corre DESPUES de cada insert en inventory_movements, dentro de la MISMA
--  transaccion: stock_levels nunca puede desincronizarse del kardex, porque
--  es literalmente su proyeccion.
create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.stock_levels;
  v_new_qty numeric(14,3);
  v_new_avg numeric(12,4);
begin
  insert into public.stock_levels (tenant_id, warehouse_id, product_id)
  values (new.tenant_id, new.warehouse_id, new.product_id)
  on conflict (tenant_id, warehouse_id, product_id) do nothing;

  select * into v_current from public.stock_levels
  where tenant_id = new.tenant_id
    and warehouse_id = new.warehouse_id
    and product_id = new.product_id
  for update;

  if new.movement_type = 'reservation' then
    -- Aparta unidades: NO toca on_hand, solo lo reservado.
    update public.stock_levels
    set qty_reserved = qty_reserved + abs(new.qty), updated_at = now()
    where tenant_id = new.tenant_id and warehouse_id = new.warehouse_id
      and product_id = new.product_id;
    return new;
  end if;

  if new.movement_type = 'reservation_release' then
    update public.stock_levels
    set qty_reserved = greatest(0, qty_reserved - new.qty), updated_at = now()
    where tenant_id = new.tenant_id and warehouse_id = new.warehouse_id
      and product_id = new.product_id;
    return new;
  end if;

  -- Entradas y salidas de verdad: mueven on_hand. Promedio ponderado movil,
  -- igual que packages/operations/src/costing.ts#applyInbound.
  v_new_qty := v_current.qty_on_hand + new.qty;

  if new.qty > 0 and new.unit_cost is not null then
    if v_current.qty_on_hand <= 0 then
      v_new_avg := new.unit_cost;
    else
      v_new_avg := (v_current.qty_on_hand * v_current.avg_cost + new.qty * new.unit_cost)
                   / v_new_qty;
    end if;
  else
    -- Salida, o entrada sin costo declarado (devolucion/ajuste de cantidad):
    -- el promedio no cambia.
    v_new_avg := v_current.avg_cost;
  end if;

  update public.stock_levels
  set qty_on_hand = v_new_qty,
      avg_cost    = round(v_new_avg, 4),
      updated_at  = now()
  where tenant_id = new.tenant_id and warehouse_id = new.warehouse_id
    and product_id = new.product_id;

  return new;
end;
$$;

create trigger apply_movement after insert on public.inventory_movements
  for each row execute function public.apply_inventory_movement();

comment on function public.apply_inventory_movement() is
  'Proyecta el kardex a stock_levels. Replica costing.ts#applyInbound en SQL porque un trigger no puede llamar a TypeScript.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('warehouses'),
      ('stock_levels'),
      ('stock_counts'),
      ('stock_count_lines'),
      ('stock_transfers'),
      ('stock_transfer_lines')
    ) as t(tabla)
  loop
    execute format('alter table public.%I enable row level security', r.tabla);
    execute format('alter table public.%I force row level security', r.tabla);
    execute format(
      'create policy tenant_module on public.%I for all
         using (tenant_id = rls.tenant_id() and rls.module_active(''inventory''))
         with check (tenant_id = rls.tenant_id() and rls.module_active(''inventory''))',
      r.tabla);
    execute format(
      'create policy provider_impersonating on public.%I for select
         using (rls.impersonating(tenant_id))', r.tabla);
  end loop;
end $$;

-- `inventory_movements` es la UNICA excepcion deliberada: solo select e
-- insert. Sin politica de update ni de delete, `force row level security`
-- las niega por completo para el rol `authenticated`. Corregir un
-- movimiento es insertar el contrario, jamas editar ni borrar el original.
--
-- ADVERTENCIA para quien audite RLS mas adelante: esto NO es un descuido,
-- es la garantia central del modulo. No "completar" con un `for all`.
alter table public.inventory_movements enable row level security;
alter table public.inventory_movements force row level security;

create policy tenant_module_select on public.inventory_movements
  for select
  using (tenant_id = rls.tenant_id() and rls.module_active('inventory'));

create policy tenant_module_insert on public.inventory_movements
  for insert
  with check (tenant_id = rls.tenant_id() and rls.module_active('inventory'));

create policy provider_impersonating on public.inventory_movements
  for select
  using (rls.impersonating(tenant_id));

-- ── Bitacora ───────────────────────────────────────────────────────────
--  El kardex NO se audita en audit.log: ya es su propio libro inmutable,
--  con created_by y timestamp. Duplicarlo en audit.log es almacenamiento
--  sin señal nueva. Se audita el resto, que son decisiones administrativas.
create trigger audit_me after insert or update or delete on public.warehouses
  for each row execute function audit.record('inventory');
create trigger audit_me after insert or update or delete on public.stock_counts
  for each row execute function audit.record('inventory');
create trigger audit_me after insert or update or delete on public.stock_transfers
  for each row execute function audit.record('inventory');

-- ── Un almacen por defecto para cada sucursal existente ────────────────
--  Asi el caso "tengo un solo almacen" (el mas comun, segun la ficha del
--  marketplace) queda listo sin que el usuario tenga que configurar nada.
do $$
declare b record;
begin
  for b in select id, tenant_id, name from public.branches where deleted_at is null loop
    insert into public.warehouses (tenant_id, branch_id, name, is_default)
    values (b.tenant_id, b.id, b.name,
            not exists (select 1 from public.warehouses w where w.tenant_id = b.tenant_id))
    on conflict do nothing;
  end loop;
end $$;
