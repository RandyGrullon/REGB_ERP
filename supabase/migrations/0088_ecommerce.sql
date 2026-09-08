-- ═══════════════════════════════════════════════════════════════════════
--  0088 — E-commerce sync (modulo 36, F9/S60)
--
--  Deliberadamente NO llama a la API de Shopify/WooCommerce/Tiendanube
--  de verdad -no hay integracion con un proveedor externo todavia-:
--  "sincronizar" un producto solo registra que se envio y cuando
--  (`synced_at`), y un pedido entrante se REGISTRA tal cual llega -no
--  se recalculan sus totales, porque esos ya los calculo el canal
--  externo; reinventar esa formula aqui seria fabricar un numero que
--  no coincide con lo que el cliente pago afuera-.
--
--  Requiere `products` de verdad (regb.module_catalog: requires
--  '{products}'): el vinculo de catalogo es una FK real, no un SKU
--  suelto sin respaldo.
-- ═══════════════════════════════════════════════════════════════════════

create table public.sales_channels (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  name        text not null,
  platform    text not null check (platform in ('shopify', 'woocommerce', 'tiendanube')),
  store_url   text,
  status      text not null default 'connected' check (status in ('connected', 'disconnected')),
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.channel_product_links (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  channel_id    uuid not null references public.sales_channels(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  external_sku  text not null,
  synced_at     timestamptz,
  unique (channel_id, product_id),
  unique (channel_id, external_sku)
);

create index on public.channel_product_links (tenant_id, channel_id);

-- Un pedido entrante: editable hasta resolverse (importado/cancelado,
-- ambos terminales), igual que un contrato o un ticket.
create table public.channel_orders (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references regb.tenants(id) on delete cascade,
  channel_id         uuid not null references public.sales_channels(id),
  external_order_id  text not null,
  customer_name      text not null,
  customer_email     text,
  total              numeric(12,2) not null check (total >= 0),
  status             text not null default 'received' check (status in ('received', 'imported', 'cancelled')),
  received_at        timestamptz not null default now(),
  resolved_at        timestamptz,
  unique (channel_id, external_order_id)
);

create index on public.channel_orders (tenant_id, channel_id, status);

-- Cada linea es el hecho tal cual llego del canal: inmutable desde el
-- insert, igual que un mensaje de ticket.
create table public.channel_order_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  order_id      uuid not null references public.channel_orders(id) on delete cascade,
  product_id    uuid references public.products(id),
  external_sku  text not null,
  quantity      numeric(12,3) not null check (quantity > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0)
);

create index on public.channel_order_lines (tenant_id, order_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.sales_channels enable row level security;
alter table public.sales_channels force row level security;
alter table public.channel_product_links enable row level security;
alter table public.channel_product_links force row level security;
alter table public.channel_orders enable row level security;
alter table public.channel_orders force row level security;
alter table public.channel_order_lines enable row level security;
alter table public.channel_order_lines force row level security;

create policy tenant_module on public.sales_channels for all
  using (tenant_id = rls.tenant_id() and rls.module_active('ecommerce'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('ecommerce'));
create policy provider_impersonating on public.sales_channels for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.channel_product_links for all
  using (tenant_id = rls.tenant_id() and rls.module_active('ecommerce'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('ecommerce'));
create policy provider_impersonating on public.channel_product_links for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.channel_orders for all
  using (tenant_id = rls.tenant_id() and rls.module_active('ecommerce'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('ecommerce'));
create policy provider_impersonating on public.channel_orders for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.channel_order_lines for all
  using (tenant_id = rls.tenant_id() and rls.module_active('ecommerce'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('ecommerce'));
create policy provider_impersonating on public.channel_order_lines for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_producto_ajeno_vinculo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.products where id = new.product_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_producto_ajeno_vinculo
  before insert on public.channel_product_links
  for each row execute function public.impedir_producto_ajeno_vinculo();

create function public.impedir_canal_ajeno_pedido() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.sales_channels where id = new.channel_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese canal no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_canal_ajeno_pedido
  before insert on public.channel_orders
  for each row execute function public.impedir_canal_ajeno_pedido();

create function public.impedir_pedido_ajeno_linea() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant from public.channel_orders where id = new.order_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese pedido no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  if new.product_id is not null then
    select tenant_id into v_tenant_producto from public.products where id = new.product_id;
    if v_tenant_producto is distinct from new.tenant_id then
      raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_pedido_ajeno_linea
  before insert on public.channel_order_lines
  for each row execute function public.impedir_pedido_ajeno_linea();

-- ── Inmutabilidad: resuelto es terminal; la linea es un hecho historico ─
create function public.impedir_editar_pedido_canal_resuelto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('imported', 'cancelled') then
    raise exception 'Ese pedido ya se resolvio y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_pedido_canal_resuelto
  before update or delete on public.channel_orders
  for each row execute function public.impedir_editar_pedido_canal_resuelto();

create function public.impedir_editar_linea_pedido_canal() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una linea de pedido de canal ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_linea_pedido_canal
  before update or delete on public.channel_order_lines
  for each row execute function public.impedir_editar_linea_pedido_canal();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.sales_channels
  for each row execute function audit.record('ecommerce');
create trigger audit_me after insert or update on public.channel_product_links
  for each row execute function audit.record('ecommerce');
create trigger audit_me after insert or update on public.channel_orders
  for each row execute function audit.record('ecommerce');
create trigger audit_me after insert on public.channel_order_lines
  for each row execute function audit.record('ecommerce');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Honesto sobre lo que es: registra el pedido tal cual llego, no inventa su propio total',
    problem      = 'Sin un registro formal, cada pedido que llega de Shopify o WooCommerce se copia a mano a otra parte, y el catalogo de precios y existencias se desactualiza entre una plataforma y otra.',
    features     = '[
      {"titulo":"El total no se reinventa","detalle":"El total de un pedido entrante se registra tal cual lo calculo el canal externo -nunca se recalcula con una formula propia que podria no coincidir-."},
      {"titulo":"Vinculo real de catalogo","detalle":"Cada producto vinculado a un canal es una FK autentica hacia el catalogo real, no un SKU suelto sin respaldo."},
      {"titulo":"Un pedido resuelto es terminal","detalle":"Importado o cancelado se congelan -la misma disciplina que ya aplican contratos y tickets-."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio que ya vende en Shopify, WooCommerce o Tiendanube y hoy copia los pedidos a mano"}',
    faq          = '[
      {"p":"¿Se conecta de verdad con mi tienda Shopify?","r":"Todavia no -no hay integracion con la API de ningun proveedor externo-, pero registra el catalogo vinculado y los pedidos entrantes tal como llegan."},
      {"p":"¿Recalcula el total de un pedido?","r":"No -el total viene tal cual del canal externo, para nunca mostrar un numero distinto al que el cliente realmente pago-."}
    ]'::jsonb,
    setup_minutes = 20
where id = 'ecommerce';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'ecommerce'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'ecommerce no tiene precio en los 3 tiers';
  end if;
end $$;
