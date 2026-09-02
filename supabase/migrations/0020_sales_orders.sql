-- ═══════════════════════════════════════════════════════════════════════
--  0020 — Clientes y pedidos de venta (F4 · S20)
--
--  `customers` vive aqui, no en un modulo propio: lo comparten pedidos,
--  POS y cuentas por cobrar, y los tres llegan en esta misma fase. Un
--  modulo "clientes" separado seria una tabla con RLS de un solo consumidor
--  hasta F9 (crm).
--
--  RESERVAR NO ES ENTREGAR. Confirmar un pedido aparta unidades
--  (`qty_reserved` sube, `qty_on_hand` NO se mueve): el stock sigue en el
--  almacen y el conteo del almacenista cuadra. Entregar es lo que lo saca.
--  Ver packages/operations/src/fulfillment.ts.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Clientes ─────────────────────────────────────────────────────────────
create table public.customers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  code           text,
  name           text not null,
  tax_id         text,                                  -- RNC / cedula
  email          text,
  phone          text,
  address        text,
  -- Dias de credito. 0 = contado. Alimenta el vencimiento de las facturas.
  payment_terms  smallint not null default 0 check (payment_terms >= 0),
  credit_limit   numeric(12,2) check (credit_limit >= 0),
  price_list     text,
  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, code)
);

create index on public.customers (tenant_id, is_active, name);
-- Busqueda por nombre y RNC desde el mostrador.
create index customers_search_idx on public.customers (tenant_id, name text_pattern_ops);

comment on column public.customers.payment_terms is
  'Dias de credito. 0 = contado. De aqui sale la fecha de vencimiento de la factura (§5.3 #17).';

-- ── Pedidos ──────────────────────────────────────────────────────────────
create table public.sales_orders (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  number       text not null,
  customer_id  uuid not null references public.customers(id),
  warehouse_id uuid not null references public.warehouses(id),
  -- El estado NO se escribe a mano: lo deriva deriveOrderStatus() de las
  -- lineas. Guardarlo aqui es una proyeccion para poder filtrar e indexar.
  status       text not null default 'draft'
                 check (status in ('draft','confirmed','partially_delivered','delivered','cancelled')),
  order_date   date not null default current_date,
  notes        text,
  subtotal     numeric(12,2) not null default 0,
  discount     numeric(12,2) not null default 0,
  tax          numeric(12,2) not null default 0,
  total        numeric(12,2) not null default 0,
  created_by   uuid,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, number)
);

create index on public.sales_orders (tenant_id, status, order_date desc);
create index on public.sales_orders (tenant_id, customer_id, order_date desc);

create table public.sales_order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.sales_orders(id) on delete cascade,
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  qty_ordered   numeric(14,3) not null check (qty_ordered > 0),
  qty_reserved  numeric(14,3) not null default 0 check (qty_reserved >= 0),
  qty_delivered numeric(14,3) not null default 0 check (qty_delivered >= 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  discount_pct  numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate      numeric(5,2) not null default 18,
  line_total    numeric(12,2) not null default 0,
  -- No se puede entregar mas de lo pedido, ni en una carrera de dos cajeros.
  check (qty_delivered <= qty_ordered)
);

create index on public.sales_order_lines (tenant_id, order_id);
create index on public.sales_order_lines (tenant_id, product_id);

-- ── Numeracion por tenant y ano ──────────────────────────────────────────
--  Misma forma que las facturas del proveedor (0014): contador con lock, un
--  numero por pedido, sin huecos por transacciones abortadas visibles.
create table public.sales_order_counters (
  tenant_id uuid not null references regb.tenants(id) on delete cascade,
  year      smallint not null,
  last_n    integer not null default 0,
  primary key (tenant_id, year)
);

create function public.next_sales_order_number(p_tenant uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from now())::smallint;
  v_n    integer;
begin
  insert into public.sales_order_counters as c (tenant_id, year, last_n)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;

  return format('PV-%s-%s', v_year, lpad(v_n::text, 5, '0'));
end;
$$;

revoke all on function public.next_sales_order_number(uuid) from public;
grant execute on function public.next_sales_order_number(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('customers',            'sales-orders'),
      ('sales_orders',         'sales-orders'),
      ('sales_order_lines',    'sales-orders'),
      ('sales_order_counters', 'sales-orders')
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

/*
 * Los clientes los necesitan tambien el POS y cuentas por cobrar, que son
 * modulos distintos. Sin esta politica, activar el POS sin pedidos de venta
 * dejaria la caja sin poder elegir a quien le vende.
 */
create policy tenant_pos on public.customers
  for all
  using (tenant_id = rls.tenant_id() and rls.module_active('pos'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('pos'));

create policy tenant_ar on public.customers
  for all
  using (tenant_id = rls.tenant_id() and rls.module_active('ar'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('ar'));

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.customers
  for each row execute function audit.record('sales-orders');
create trigger audit_me after insert or update or delete on public.sales_orders
  for each row execute function audit.record('sales-orders');
