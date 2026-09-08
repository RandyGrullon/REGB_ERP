-- ═══════════════════════════════════════════════════════════════════════
--  0086 — Fidelizacion (modulo 38, F9/S59)
--
--  El saldo de puntos se DERIVA, nunca se guarda -mismo criterio que
--  bank_account_balance() de treasury y fixed_asset_book_value() de
--  fixed-assets-: se suma directo del historial de transacciones, que
--  es un hecho historico inmutable. El nivel (bronce/plata/oro) se
--  decide por puntos de por vida GANADOS, no por el saldo actual, para
--  que redimir un premio nunca baje de nivel a nadie.
--
--  Deliberadamente SIN requires (regb.module_catalog: requires '{}',
--  recommends '{pos}'): la fidelizacion es util aunque el negocio
--  todavia no venda por caja.
-- ═══════════════════════════════════════════════════════════════════════

create table public.loyalty_transactions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  customer_id  uuid not null references public.customers(id),
  points       integer not null check (points <> 0),
  reason       text not null,
  source_type  text not null check (source_type in ('purchase', 'redemption', 'referral_bonus', 'manual', 'expiration')),
  source_id    uuid,
  created_by   uuid,
  created_at   timestamptz not null default now()
);

create index on public.loyalty_transactions (tenant_id, customer_id, created_at desc);

create table public.loyalty_coupons (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  code            text not null,
  customer_id     uuid references public.customers(id),
  discount_type   text not null check (discount_type in ('percentage', 'fixed')),
  discount_value  numeric(10,4) not null check (discount_value > 0),
  status          text not null default 'active' check (status in ('active', 'redeemed', 'expired')),
  expires_at      timestamptz,
  redeemed_at     timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (tenant_id, code),
  check (discount_type <> 'percentage' or discount_value <= 1)
);

create index on public.loyalty_coupons (tenant_id, customer_id);

create table public.loyalty_referrals (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references regb.tenants(id) on delete cascade,
  referrer_customer_id   uuid not null references public.customers(id),
  referred_customer_id   uuid not null references public.customers(id),
  bonus_points           integer not null check (bonus_points > 0),
  status                 text not null default 'pending' check (status in ('pending', 'completed', 'expired')),
  completed_at           timestamptz,
  created_at             timestamptz not null default now(),
  check (referrer_customer_id <> referred_customer_id)
);

create index on public.loyalty_referrals (tenant_id, referrer_customer_id);

-- ── Saldo y nivel: se DERIVAN, nunca se guardan ─────────────────────────
create function public.loyalty_balance(p_customer uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(points), 0)::integer
  from public.loyalty_transactions
  where customer_id = p_customer;
$$;

create function public.loyalty_lifetime_points(p_customer uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(points), 0)::integer
  from public.loyalty_transactions
  where customer_id = p_customer and points > 0;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.loyalty_transactions enable row level security;
alter table public.loyalty_transactions force row level security;
alter table public.loyalty_coupons enable row level security;
alter table public.loyalty_coupons force row level security;
alter table public.loyalty_referrals enable row level security;
alter table public.loyalty_referrals force row level security;

create policy tenant_module on public.loyalty_transactions for all
  using (tenant_id = rls.tenant_id() and rls.module_active('loyalty'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('loyalty'));
create policy provider_impersonating on public.loyalty_transactions for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.loyalty_coupons for all
  using (tenant_id = rls.tenant_id() and rls.module_active('loyalty'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('loyalty'));
create policy provider_impersonating on public.loyalty_coupons for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.loyalty_referrals for all
  using (tenant_id = rls.tenant_id() and rls.module_active('loyalty'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('loyalty'));
create policy provider_impersonating on public.loyalty_referrals for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_cliente_ajeno_transaccion_puntos() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.customers where id = new.customer_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese cliente no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_cliente_ajeno_transaccion_puntos
  before insert on public.loyalty_transactions
  for each row execute function public.impedir_cliente_ajeno_transaccion_puntos();

create function public.impedir_cliente_ajeno_cupon() returns trigger
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

create trigger no_cliente_ajeno_cupon
  before insert or update on public.loyalty_coupons
  for each row execute function public.impedir_cliente_ajeno_cupon();

create function public.impedir_cliente_ajeno_referido() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_referente uuid;
  v_tenant_referido uuid;
begin
  select tenant_id into v_tenant_referente from public.customers where id = new.referrer_customer_id;
  select tenant_id into v_tenant_referido from public.customers where id = new.referred_customer_id;
  if v_tenant_referente is distinct from new.tenant_id or v_tenant_referido is distinct from new.tenant_id then
    raise exception 'Ese cliente no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_cliente_ajeno_referido
  before insert on public.loyalty_referrals
  for each row execute function public.impedir_cliente_ajeno_referido();

-- ── Inmutabilidad ────────────────────────────────────────────────────────
create function public.impedir_editar_transaccion_puntos() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una transaccion de puntos ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_transaccion_puntos
  before update or delete on public.loyalty_transactions
  for each row execute function public.impedir_editar_transaccion_puntos();

create function public.impedir_editar_cupon_resuelto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('redeemed', 'expired') then
    raise exception 'Ese cupon ya se resolvio y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_cupon_resuelto
  before update or delete on public.loyalty_coupons
  for each row execute function public.impedir_editar_cupon_resuelto();

create function public.impedir_editar_referido_resuelto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('completed', 'expired') then
    raise exception 'Ese referido ya se resolvio y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_referido_resuelto
  before update or delete on public.loyalty_referrals
  for each row execute function public.impedir_editar_referido_resuelto();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert on public.loyalty_transactions
  for each row execute function audit.record('loyalty');
create trigger audit_me after insert or update on public.loyalty_coupons
  for each row execute function audit.record('loyalty');
create trigger audit_me after insert or update on public.loyalty_referrals
  for each row execute function audit.record('loyalty');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'El nivel se gana con puntos de por vida -redimir un premio nunca te baja de nivel-',
    problem      = 'Sin un programa formal, cada negocio improvisa su propia fidelizacion en una libreta o una hoja de calculo, y no hay forma de saber cuanto vale de verdad un cliente frecuente.',
    features     = '[
      {"titulo":"El saldo se calcula, nunca se guarda mal","detalle":"El saldo de puntos se suma directo del historial completo -el mismo criterio que ya usa el saldo de una cuenta bancaria-, nunca puede desincronizarse."},
      {"titulo":"El nivel no baja por redimir","detalle":"Bronce, plata y oro se deciden por los puntos GANADOS de por vida, no por el saldo actual -premiar a un cliente nunca lo degrada-."},
      {"titulo":"Cupones y referidos con su propia maquina de estados","detalle":"Un cupon o un referido resuelto queda congelado -no se puede redimir dos veces ni completar un referido ya expirado-."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio con clientes recurrentes que hoy no tiene un programa formal de puntos"}',
    faq          = '[
      {"p":"¿Necesito el punto de venta para usar fidelizacion?","r":"No -se recomienda pos para ganar puntos automaticamente en cada venta, pero los puntos tambien se pueden registrar a mano-."},
      {"p":"¿Redimir un premio baja de nivel a un cliente?","r":"No -el nivel se calcula con los puntos ganados de por vida, no con el saldo actual-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'loyalty';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'loyalty'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'loyalty no tiene precio en los 3 tiers';
  end if;
end $$;
