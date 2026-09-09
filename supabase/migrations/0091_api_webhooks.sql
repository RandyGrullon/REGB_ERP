-- ═══════════════════════════════════════════════════════════════════════
--  0091 — API & Webhooks (modulo 89, F9/S64)
--
--  Una llave de API se muestra COMPLETA una sola vez, al crearla -solo
--  su hash SHA-256 se guarda, el mismo `createHash('sha256')` de
--  `node:crypto` que ya uso `e-sign` para su rastro de firma-. Nadie,
--  ni el propio tenant despues, puede volver a verla completa.
--
--  Los webhooks salientes SI hacen una llamada HTTP real -a diferencia
--  de `ecommerce` o `marketing`, que deliberadamente no llaman a
--  ningun proveedor externo, aqui la URL la puso el propio tenant
--  para SU propio sistema, no hay un tercero de por medio que
--  suplantar-. Consume el mismo `event_outbox` que ya usa
--  `automations` -mismo patron de solo lectura, su propia bitacora en
--  `webhook_deliveries`, nunca toca `processed_at`-.
--
--  Deliberadamente SIN requires: cualquier evento ya emitido por
--  cualquier modulo activo se puede exponer por API o webhook.
-- ═══════════════════════════════════════════════════════════════════════

create table public.api_keys (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references regb.tenants(id) on delete cascade,
  name                   text not null,
  key_prefix             text not null,
  key_hash               text not null,
  scopes                 text[] not null default '{}',
  rate_limit_per_minute  integer not null default 60 check (rate_limit_per_minute > 0),
  status                 text not null default 'active' check (status in ('active', 'revoked')),
  last_used_at           timestamptz,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  revoked_at             timestamptz,
  unique (tenant_id, name),
  unique (key_hash)
);

create index on public.api_keys (tenant_id, status);

create table public.webhook_endpoints (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  url          text not null,
  event_types  text[] not null check (coalesce(array_length(event_types, 1), 0) > 0),
  secret       text not null,
  status       text not null default 'active' check (status in ('active', 'paused')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (tenant_id, url)
);

-- Cada entrega es un hecho historico: inmutable desde el insert, y su
-- unicidad (endpoint, evento) evita entregar el mismo evento dos veces
-- al mismo destino.
create table public.webhook_deliveries (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  endpoint_id    uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_id       bigint not null references public.event_outbox(id),
  status_code    integer,
  success        boolean not null,
  response_body  text,
  attempted_at   timestamptz not null default now(),
  unique (endpoint_id, event_id)
);

create index on public.webhook_deliveries (tenant_id, endpoint_id, attempted_at desc);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.api_keys enable row level security;
alter table public.api_keys force row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_endpoints force row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.webhook_deliveries force row level security;

create policy tenant_module on public.api_keys for all
  using (tenant_id = rls.tenant_id() and rls.module_active('api-webhooks'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('api-webhooks'));
create policy provider_impersonating on public.api_keys for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.webhook_endpoints for all
  using (tenant_id = rls.tenant_id() and rls.module_active('api-webhooks'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('api-webhooks'));
create policy provider_impersonating on public.webhook_endpoints for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.webhook_deliveries for all
  using (tenant_id = rls.tenant_id() and rls.module_active('api-webhooks'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('api-webhooks'));
create policy provider_impersonating on public.webhook_deliveries for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_endpoint_ajeno_entrega() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_endpoint uuid;
  v_tenant_evento uuid;
begin
  select tenant_id into v_tenant_endpoint from public.webhook_endpoints where id = new.endpoint_id;
  select tenant_id into v_tenant_evento from public.event_outbox where id = new.event_id;
  if v_tenant_endpoint is distinct from new.tenant_id or v_tenant_evento is distinct from new.tenant_id then
    raise exception 'Ese endpoint o ese evento no pertenecen a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_endpoint_ajeno_entrega
  before insert on public.webhook_deliveries
  for each row execute function public.impedir_endpoint_ajeno_entrega();

-- ── Inmutabilidad: una entrega es un hecho historico ────────────────────
create function public.impedir_editar_entrega() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una entrega de webhook ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_entrega
  before update or delete on public.webhook_deliveries
  for each row execute function public.impedir_editar_entrega();

-- Una llave revocada es terminal: no vuelve a activarse.
create function public.impedir_reactivar_llave() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'revoked' and new.status = 'active' then
    raise exception 'Una llave revocada no se puede reactivar -crea una nueva-.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger no_reactivar_llave
  before update on public.api_keys
  for each row execute function public.impedir_reactivar_llave();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.api_keys
  for each row execute function audit.record('api-webhooks');
create trigger audit_me after insert or update on public.webhook_endpoints
  for each row execute function audit.record('api-webhooks');
create trigger audit_me after insert on public.webhook_deliveries
  for each row execute function audit.record('api-webhooks');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'La llave completa se ve una sola vez -solo su hash se guarda, nunca el valor real-',
    problem      = 'Sin llaves de API propias ni webhooks salientes, cada integracion a la medida necesita que alguien del equipo copie datos a mano hacia el sistema externo del cliente.',
    features     = '[
      {"titulo":"La llave se ve una sola vez","detalle":"Al crearla se muestra completa -solo su hash SHA-256 se guarda despues, ni el propio tenant puede volver a verla-."},
      {"titulo":"Webhooks salientes de verdad","detalle":"A diferencia de otras integraciones de este proyecto, aqui SI se hace una llamada HTTP real -al sistema del propio tenant, no a un tercero que suplantar-."},
      {"titulo":"Limite de uso por llave","detalle":"Cada llave tiene su propio limite de solicitudes por minuto, para que una integracion con errores no consuma la cuenta entera."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio que necesite conectar su propio sistema o el de un cliente via API o webhooks"}',
    faq          = '[
      {"p":"¿Puedo ver mi llave de API despues de crearla?","r":"No -se muestra completa una sola vez; si la pierdes, hay que crear una nueva-."},
      {"p":"¿Los webhooks llaman a un proveedor externo de verdad?","r":"Llaman a la URL que TU configuraste para tu propio sistema -no hay integracion con Shopify, WooCommerce ni ningun tercero aqui-."}
    ]'::jsonb,
    setup_minutes = 20
where id = 'api-webhooks';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'api-webhooks'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'api-webhooks no tiene precio en los 3 tiers';
  end if;
end $$;
