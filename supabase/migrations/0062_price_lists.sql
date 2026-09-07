-- ═══════════════════════════════════════════════════════════════════════
--  0062 — Listas de precios (modulo 41, F8/S43)
--
--  `public.customers.price_list` (0020) era una columna de texto libre
--  que NUNCA se leyo ni se escribio desde ningun codigo de la app -un
--  scaffold muerto, mismo hallazgo que el `payroll`/`attendance` sin
--  substancia de sesiones anteriores-. Se elimina y se reemplaza por
--  `price_list_id`, una referencia real a este modulo.
--
--  Que lista aplica y que precio corresponde se resuelven SIEMPRE en
--  TypeScript (listaAplicable()/precioPorVolumen() en @regb/operations),
--  nunca en SQL. Este modulo resuelve el precio para consulta -un
--  cotizador-; todavia NO se conecta automaticamente al checkout de
--  sales-orders o pos, declarado explicitamente como pendiente.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.customers drop column price_list;

create table public.price_lists (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  name         text not null,
  scope        text not null check (scope in ('customer', 'channel', 'general')),
  customer_id  uuid references public.customers(id),
  channel      text,
  start_date   date not null default current_date,
  end_date     date,
  status       text not null default 'active' check (status in ('active', 'inactive')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (scope <> 'customer' or customer_id is not null),
  check (scope <> 'channel' or channel is not null),
  check (end_date is null or end_date >= start_date)
);

create index on public.price_lists (tenant_id, status);
create index on public.price_lists (tenant_id, customer_id);

alter table public.customers add column price_list_id uuid references public.price_lists(id);

create table public.price_list_entries (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  min_quantity  numeric(14,4) not null default 1 check (min_quantity > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  created_at    timestamptz not null default now(),
  unique (tenant_id, price_list_id, product_id, min_quantity)
);

create index on public.price_list_entries (tenant_id, price_list_id);
create index on public.price_list_entries (tenant_id, product_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('price_lists',         'price-lists'),
      ('price_list_entries',  'price-lists')
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

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenece customer_id.
create function public.impedir_lista_precio_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.customer_id is not null then
    select tenant_id into v_tenant from public.customers where id = new.customer_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Ese cliente no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_lista_precio_ajena before insert or update on public.price_lists
  for each row execute function public.impedir_lista_precio_ajena();

create function public.impedir_entrada_lista_precio_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_lista   uuid;
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_lista from public.price_lists where id = new.price_list_id;
  if v_tenant_lista is distinct from new.tenant_id then
    raise exception 'Esa lista de precios no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_producto from public.products where id = new.product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_entrada_lista_precio_ajena before insert on public.price_list_entries
  for each row execute function public.impedir_entrada_lista_precio_ajena();

-- `customers.price_list_id` es una referencia nueva sobre una tabla que
-- ya existia desde 0020 -mismo agujero, ahora en una columna agregada
-- despues, no en la tabla original-.
create function public.impedir_lista_precio_ajena_en_cliente() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.price_list_id is not null then
    select tenant_id into v_tenant from public.price_lists where id = new.price_list_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Esa lista de precios no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_lista_precio_ajena_en_cliente before insert or update on public.customers
  for each row execute function public.impedir_lista_precio_ajena_en_cliente();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.price_lists
  for each row execute function audit.record('price-lists');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Precio por cliente, canal o volumen -resuelto con la misma regla siempre, nunca a ojo-',
    problem      = 'Sin un registro real, el precio especial de un cliente vive en la memoria de quien factura, y el descuento por volumen se calcula distinto cada vez.',
    features     = '[
      {"titulo":"La lista mas especifica gana, siempre igual","detalle":"Una lista propia del cliente vence a una de canal, que vence a la general -la misma regla de precedencia cada vez, nunca a criterio de quien cotiza-."},
      {"titulo":"Descuento por volumen real","detalle":"Cada cuota de cantidad tiene su propio precio; se usa siempre la cuota mas alta que la cantidad pedida todavia alcanza."},
      {"titulo":"Vigencias que se respetan solas","detalle":"Una lista fuera de su rango de fechas -o inactiva- simplemente no aplica, sin que nadie tenga que acordarse de desactivarla a mano."}
    ]'::jsonb,
    audience     = '{"Negocios que ya dan precios especiales por cliente o por volumen de forma informal","Cualquiera con mas de un canal de venta -mayorista, minorista, en linea- con precios distintos"}',
    faq          = '[
      {"p":"¿El precio se aplica solo al facturar?","r":"Todavia no -este modulo resuelve el precio para consulta, un cotizador-. La integracion automatica con el checkout de ventas o del POS es un paso futuro, declarado explicitamente."},
      {"p":"¿Que pasa si un cliente califica para dos listas a la vez?","r":"Gana la mas especifica: una lista propia del cliente vence a una de canal, que vence a la general -nunca una mezcla ni un empate silencioso-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'price-lists';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'price-lists'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'price-lists no tiene precio en los 3 tiers';
  end if;
end $$;
