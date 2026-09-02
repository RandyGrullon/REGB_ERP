-- ═══════════════════════════════════════════════════════════════════════
--  0038 — Proveedores y ordenes de compra (modulo 45, §5.4)
--
--  Hasta ahora el inventario solo entraba por ajustes manuales. Con esto
--  una entrada real queda documentada —a que proveedor, a que costo,
--  cuando— y ese costo alimenta el MISMO trigger de promedio ponderado
--  que ya usan los ajustes (apply_inventory_movement(), 0019): un
--  movimiento 'receipt' con unit_cost mueve el promedio exactamente
--  igual que un 'adjustment_in'. No hace falta tocar el trigger.
--
--  Alcance deliberado, igual que se decidio con products/inventory/
--  sales-orders/pos/ar en F4: sin requisiciones internas, sin cotizacion
--  a multiples proveedores, sin cuentas por pagar. Eso son los modulos
--  42-44 del catalogo y una fase aparte. Aqui solo pedir y recibir.
--
--  RECIBIR NO ES LO MISMO QUE CONFIRMAR, por el lado contrario a como se
--  decidio en pedidos de venta: confirmar una orden de compra NO mueve
--  inventario —es una promesa del proveedor, no nuestra—, y recibir es
--  el UNICO momento que entra mercancia. No hay "reserva" que liberar.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Proveedores ──────────────────────────────────────────────────────────
--  Vive aqui y no en un modulo `suppliers` propio, mismo razonamiento que
--  `customers` en 0020: una tabla con RLS de un solo consumidor hasta que
--  exista `ap` (cuentas por pagar) o `suppliers` (evaluacion, homologacion).
create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  code          text,
  name          text not null,
  tax_id        text,                                 -- RNC del proveedor
  email         text,
  phone         text,
  address       text,
  -- Dias que da el proveedor para pagarle. Informativo hasta que exista
  -- cuentas por pagar; no genera ningun vencimiento todavia.
  payment_terms smallint not null default 0 check (payment_terms >= 0),
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, code)
);

create index on public.suppliers (tenant_id, is_active, name);
create index suppliers_search_idx on public.suppliers (tenant_id, name text_pattern_ops);

-- ── Ordenes de compra ────────────────────────────────────────────────────
create table public.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  number       text not null,
  supplier_id  uuid not null references public.suppliers(id),
  warehouse_id uuid not null references public.warehouses(id),
  -- El estado NO se escribe a mano: lo deriva deriveReceiptStatus() de las
  -- lineas, igual que sales_orders.status. Guardarlo es una proyeccion.
  status       text not null default 'draft'
                 check (status in ('draft','confirmed','partially_received','received','cancelled')),
  order_date   date not null default current_date,
  -- Datos del comprobante que el PROVEEDOR entrega al recibir. Ninguno se
  -- usa todavia —el 606 no esta implementado (necesita el mismo tipo de
  -- verificacion contra la DGII que se hizo para el 607/608 y no se ha
  -- hecho)— pero capturarlos ahora evita re-preguntarle al cliente sus
  -- facturas viejas el dia que se construya el reporte.
  supplier_ncf       text,
  supplier_ncf_date  date,
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

create index on public.purchase_orders (tenant_id, status, order_date desc);
create index on public.purchase_orders (tenant_id, supplier_id, order_date desc);

create table public.purchase_order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.purchase_orders(id) on delete cascade,
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  qty_ordered   numeric(14,3) not null check (qty_ordered > 0),
  qty_received  numeric(14,3) not null default 0 check (qty_received >= 0),
  -- Costo COTIZADO al ordenar. Lo que de verdad entra al promedio es el
  -- costo declarado al RECIBIR (puede llegar mas caro o mas barato) — ver
  -- recibirLinea() en actions.ts. Se guardan los dos para poder avisar la
  -- diferencia sin tener que ir a buscar el papel.
  unit_cost     numeric(12,4) not null check (unit_cost >= 0),
  -- Descuento comercial que a veces da el proveedor (pronto pago, volumen).
  -- No es habitual, pero cuando aparece va aqui en vez de bajar el costo
  -- unitario a mano: asi el costo que promedia el inventario sigue siendo
  -- el real de catalogo, y el descuento queda visible en el total.
  discount_pct  numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate      numeric(5,4) not null default 0.18 check (tax_rate >= 0 and tax_rate <= 1),
  line_total    numeric(12,2) not null default 0,
  -- No se puede recibir mas de lo pedido, ni en una carrera de dos
  -- recepciones simultaneas del mismo contenedor.
  check (qty_received <= qty_ordered)
);

create index on public.purchase_order_lines (tenant_id, order_id);
create index on public.purchase_order_lines (tenant_id, product_id);

comment on column public.purchase_order_lines.tax_rate is
  'FRACCION (0.18), no porcentaje — misma trampa y misma regla que sales_order_lines desde la 0021.';

-- ── Numeracion por tenant y ano ──────────────────────────────────────────
--  Misma forma que sales_order_counters (0020), y con la guarda que la
--  0031 tuvo que anadirle a esa DESPUES de encontrar el agujero: el tenant
--  se compara aqui mismo porque una funcion security definer elude la RLS
--  por definicion, y sin esta comprobacion cualquier autenticado podia
--  numerar ordenes de otro cliente. Se escribe bien desde el principio en
--  vez de repetir el ciclo de "construir, encontrar el agujero, parchear".
create table public.purchase_order_counters (
  tenant_id uuid not null references regb.tenants(id) on delete cascade,
  year      smallint not null,
  last_n    integer not null default 0,
  primary key (tenant_id, year)
);

create function public.next_purchase_order_number(p_tenant uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from now())::smallint;
  v_n    integer;
begin
  if p_tenant is distinct from auth.tenant_id() then
    raise exception 'No puedes numerar ordenes de otro cliente.' using errcode = '42501';
  end if;
  if not auth.module_active('purchase-orders') then
    raise exception 'El modulo de compras no esta activo: no se entregan numeros.'
      using errcode = '42501';
  end if;

  insert into public.purchase_order_counters as c (tenant_id, year, last_n)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;

  return format('OC-%s-%s', v_year, lpad(v_n::text, 5, '0'));
end;
$$;

revoke all on function public.next_purchase_order_number(uuid) from public;
grant execute on function public.next_purchase_order_number(uuid) to authenticated;

comment on function public.next_purchase_order_number(uuid) is
  'Proximo numero de orden de compra. Solo del cliente que llama y solo con el modulo activo (mismo patron que next_sales_order_number tras la 0031).';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('suppliers',                'purchase-orders'),
      ('purchase_orders',          'purchase-orders'),
      ('purchase_order_lines',     'purchase-orders'),
      ('purchase_order_counters',  'purchase-orders')
    ) as t(tabla, modulo)
  loop
    execute format('alter table public.%I enable row level security', r.tabla);
    execute format('alter table public.%I force row level security', r.tabla);
    execute format(
      'create policy tenant_module on public.%I for all
         using (tenant_id = auth.tenant_id() and auth.module_active(%L))
         with check (tenant_id = auth.tenant_id() and auth.module_active(%L))',
      r.tabla, r.modulo, r.modulo);
    execute format(
      'create policy provider_impersonating on public.%I for select
         using (auth.impersonating(tenant_id))', r.tabla);
  end loop;
end $$;

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.suppliers
  for each row execute function audit.record('purchase-orders');
create trigger audit_me after insert or update or delete on public.purchase_orders
  for each row execute function audit.record('purchase-orders');
