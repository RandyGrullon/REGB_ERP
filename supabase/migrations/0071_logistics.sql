-- ═══════════════════════════════════════════════════════════════════════
--  0071 — Logistica & Rutas (modulo 53, F8/S49)
--
--  Planificacion de rutas y prueba de entrega. Honesto desde el
--  primer dia: NO hay optimizacion de ruta por distancia real -eso
--  pediria geocodificacion y un motor de rutas que este sistema no
--  tiene-, y NO hay seguimiento GPS -ningun dispositivo real esta
--  conectado-. El catalogo menciona ambos; se declaran explicitamente
--  ausentes en vez de simularlos.
--
--  Sin acoplamiento duro a `fleet`: el vehiculo de una ruta es texto
--  libre (la placa), no una referencia -logistics no REQUIERE fleet,
--  solo lo recomienda, y un acoplamiento silencioso violaria la regla
--  del registry (§2.2)-. `customer_id`/`sales_order_id` en cada parada
--  SI son referencias reales -esas tablas ya existen en el esquema
--  base independientemente de si `sales-orders` esta activo o no-.
--
--  transicionValidaRuta()/rutaCompleta()/tasaEntregaExitosa()
--  (@regb/operations) son las unicas funciones nuevas: la maquina de
--  estados y la tasa de exito real, no declarada a mano.
-- ═══════════════════════════════════════════════════════════════════════

create table public.delivery_routes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  driver_id     uuid references public.employees(id),
  vehicle_plate text,
  route_date    date not null default current_date,
  status        text not null default 'planned'
                  check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  notes         text,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.delivery_routes (tenant_id, route_date);
create index on public.delivery_routes (tenant_id, status);

create table public.route_stops (
  id               uuid primary key default gen_random_uuid(),
  route_id         uuid not null references public.delivery_routes(id) on delete cascade,
  tenant_id        uuid not null references regb.tenants(id) on delete cascade,
  sequence         integer not null check (sequence > 0),
  customer_id      uuid references public.customers(id),
  sales_order_id   uuid references public.sales_orders(id),
  address          text not null,
  status           text not null default 'pending'
                     check (status in ('pending', 'delivered', 'failed')),
  -- Prueba de entrega: quien la recibio, no una firma digital ni una
  -- foto -eso pediria captura real de imagen/firma, declarado
  -- explicitamente fuera de alcance-.
  recipient_name   text,
  delivery_notes   text,
  delivered_at     timestamptz,
  unique (route_id, sequence)
);

create index on public.route_stops (tenant_id, route_id);
create index on public.route_stops (tenant_id, status);

comment on column public.route_stops.recipient_name is
  'Prueba de entrega: el nombre de quien recibio, escrito por el conductor. Sin firma digital ni foto -eso es un paso futuro-.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.delivery_routes enable row level security;
alter table public.delivery_routes force row level security;
alter table public.route_stops enable row level security;
alter table public.route_stops force row level security;

create policy tenant_module on public.delivery_routes for all
  using (tenant_id = rls.tenant_id() and rls.module_active('logistics'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('logistics'));
create policy provider_impersonating on public.delivery_routes for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.route_stops for all
  using (tenant_id = rls.tenant_id() and rls.module_active('logistics'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('logistics'));
create policy provider_impersonating on public.route_stops for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenecen las referencias.
create function public.impedir_ruta_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_conductor uuid;
begin
  if new.driver_id is not null then
    select tenant_id into v_tenant_conductor from public.employees where id = new.driver_id;
    if v_tenant_conductor is distinct from new.tenant_id then
      raise exception 'Ese conductor no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_ruta_ajena before insert or update on public.delivery_routes
  for each row execute function public.impedir_ruta_ajena();

create function public.impedir_referencia_ajena_parada() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_ruta uuid;
  v_tenant_cliente uuid;
  v_tenant_orden uuid;
begin
  select tenant_id into v_tenant_ruta from public.delivery_routes where id = new.route_id;
  if v_tenant_ruta is distinct from new.tenant_id then
    raise exception 'Esa ruta no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  if new.customer_id is not null then
    select tenant_id into v_tenant_cliente from public.customers where id = new.customer_id;
    if v_tenant_cliente is distinct from new.tenant_id then
      raise exception 'Ese cliente no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;

  if new.sales_order_id is not null then
    select tenant_id into v_tenant_orden from public.sales_orders where id = new.sales_order_id;
    if v_tenant_orden is distinct from new.tenant_id then
      raise exception 'Esa orden de venta no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_parada before insert or update on public.route_stops
  for each row execute function public.impedir_referencia_ajena_parada();

-- ── Inmutabilidad condicional ───────────────────────────────────────────
-- Una ruta completada o cancelada es terminal -reabrirla es planificar
-- una ruta nueva, no editar la vieja-.
create function public.impedir_editar_ruta_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('completed', 'cancelled') then
    raise exception 'Esa ruta ya quedo resuelta y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_ruta_resuelta
  before update or delete on public.delivery_routes
  for each row execute function public.impedir_editar_ruta_resuelta();

-- Una parada entregada o fallida es la prueba de entrega -un hecho ya
-- resuelto, no se corrige despues-. Pending SI se puede editar (cambiar
-- la direccion, el orden de secuencia, etc.).
create function public.impedir_editar_parada_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('delivered', 'failed') then
    raise exception 'Esa parada ya quedo resuelta y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_parada_resuelta
  before update or delete on public.route_stops
  for each row execute function public.impedir_editar_parada_resuelta();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.delivery_routes
  for each row execute function audit.record('logistics');
create trigger audit_me after insert or update or delete on public.route_stops
  for each row execute function audit.record('logistics');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Prueba de entrega real -quien recibio, cuando, en que estado quedo la parada-',
    problem      = 'Sin esto, saber si el reparto de hoy ya termino, cuantas paradas fallaron, o quien recibio cada entrega, depende de llamar al chofer.',
    features     = '[
      {"titulo":"Estado real de cada parada","detalle":"Pendiente, entregada o fallida -no una lista que alguien tacha en papel-, con quien recibio como prueba de entrega."},
      {"titulo":"Tasa de entrega exitosa calculada","detalle":"De las paradas resueltas de verdad, no un numero que alguien estima al final del dia."},
      {"titulo":"Honesto sobre lo que no hace","detalle":"Sin seguimiento GPS ni optimizacion de ruta por distancia -ninguno de los dos esta conectado a un dispositivo o motor de mapas real todavia-."}
    ]'::jsonb,
    audience     = '{"Negocios que reparten a domicilio o entre sucursales con regularidad","Cualquiera que hoy confirme entregas por WhatsApp o llamada"}',
    faq          = '[
      {"p":"¿Rastrea la posicion del conductor en tiempo real?","r":"No todavia -no hay ningun dispositivo GPS conectado. Se planifica la ruta y se registra cada entrega, pero no se ve el mapa en vivo-."},
      {"p":"¿Optimiza el orden de las paradas por distancia?","r":"No -el orden lo decide quien planifica la ruta. Optimizar por distancia real pediria geocodificacion, que este sistema no tiene-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'logistics';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'logistics'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'logistics no tiene precio en los 3 tiers';
  end if;
end $$;
