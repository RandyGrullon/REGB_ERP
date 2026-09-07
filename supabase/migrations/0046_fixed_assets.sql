-- ═══════════════════════════════════════════════════════════════════════
--  0046 — Activos fijos (modulo 21, F6/S34)
--
--  Alta, depreciacion (linea recta/acelerada), revaluo y baja. El saldo en
--  libros NUNCA se guarda: se deriva de la base actual -acquisition_cost,
--  o el ultimo revaluo si lo hay- menos la depreciacion acumulada. Mismo
--  principio que invoice_balance()/ap_invoice_balance()/
--  bank_account_balance().
--
--  Cada corrida de depreciacion es un registro historico INMUTABLE -ni se
--  edita ni se borra, mismo criterio que un asiento contabilizado (0041) o
--  un movimiento bancario (0044)-. Un revaluo tambien es historico: no se
--  sobreescribe el anterior, se agrega uno nuevo.
--
--  Simplificacion deliberada: el revaluo aqui NO postea el superavit o
--  deficit de revaluacion contra patrimonio -eso pide que accounting sepa
--  auto-contabilizar desde otro modulo, que todavia no existe para
--  ninguno-. Se documenta en la ficha, no se esconde.
-- ═══════════════════════════════════════════════════════════════════════

create table public.fixed_assets (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references regb.tenants(id) on delete cascade,
  code                text not null,
  name                text not null,
  category            text not null default 'other'
                        check (category in ('vehicle', 'equipment', 'furniture', 'building', 'other')),
  acquisition_date    date not null,
  acquisition_cost    numeric(12,2) not null check (acquisition_cost > 0),
  salvage_value       numeric(12,2) not null default 0 check (salvage_value >= 0),
  useful_life_months  integer not null check (useful_life_months > 0),
  depreciation_method text not null default 'straight_line'
                        check (depreciation_method in ('straight_line', 'declining_balance')),
  status              text not null default 'active' check (status in ('active', 'disposed')),
  disposed_at         date,
  disposed_amount     numeric(12,2),
  disposed_reason     text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, code),
  check (salvage_value <= acquisition_cost),
  check (status <> 'disposed' or (disposed_at is not null and disposed_reason is not null)),
  check (status = 'disposed' or (disposed_at is null and disposed_amount is null and disposed_reason is null))
);

create index on public.fixed_assets (tenant_id, status);

create table public.fixed_asset_depreciations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  asset_id    uuid not null references public.fixed_assets(id),
  -- Fin del periodo depreciado (normalmente fin de mes). Unico por activo
  -- y periodo: correr la depreciacion dos veces para el mismo mes no debe
  -- duplicar el gasto.
  period_date date not null,
  amount      numeric(12,2) not null check (amount > 0),
  created_at  timestamptz not null default now(),
  unique (tenant_id, asset_id, period_date)
);

create index on public.fixed_asset_depreciations (tenant_id, asset_id, period_date desc);

create table public.fixed_asset_revaluations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references regb.tenants(id) on delete cascade,
  asset_id          uuid not null references public.fixed_assets(id),
  revaluation_date  date not null default current_date,
  old_value         numeric(12,2) not null,
  new_value         numeric(12,2) not null check (new_value >= 0),
  reason            text not null,
  created_by        uuid,
  created_at        timestamptz not null default now()
);

create index on public.fixed_asset_revaluations (tenant_id, asset_id, revaluation_date desc);

-- ── Derivados: base actual, acumulada, saldo en libros, cuota del mes ────
create function public.fixed_asset_current_basis(p_asset uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select new_value from public.fixed_asset_revaluations
      where asset_id = p_asset order by revaluation_date desc, created_at desc limit 1),
    (select acquisition_cost from public.fixed_assets where id = p_asset)
  )
$$;

create function public.fixed_asset_accumulated_depreciation(p_asset uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.fixed_asset_depreciations where asset_id = p_asset
$$;

create function public.fixed_asset_book_value(p_asset uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select public.fixed_asset_current_basis(p_asset) - public.fixed_asset_accumulated_depreciation(p_asset)
$$;

comment on function public.fixed_asset_book_value(uuid) is
  'base actual (costo o ultimo revaluo) - depreciacion acumulada. Derivado a proposito: un saldo guardado se desincroniza el dia que se corrija algo.';

-- Espejo en SQL de monthlyDepreciation() en @regb/operations: la formula
-- vive en los dos lados a proposito -uno avisa antes de correr, el otro es
-- el que de verdad protege el dato-, igual que post_journal_entry().
create function public.fixed_asset_monthly_depreciation(p_asset uuid) returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_metodo      text;
  v_rescate     numeric;
  v_vida        integer;
  v_base        numeric;
  v_valor_libros numeric;
  v_depreciable numeric;
  v_monto       numeric;
begin
  select depreciation_method, salvage_value, useful_life_months
    into v_metodo, v_rescate, v_vida
    from public.fixed_assets where id = p_asset;
  if not found then
    return 0;
  end if;

  v_base := public.fixed_asset_current_basis(p_asset);
  v_valor_libros := v_base - public.fixed_asset_accumulated_depreciation(p_asset);
  v_depreciable := greatest(v_valor_libros - v_rescate, 0);
  if v_depreciable <= 0 then
    return 0;
  end if;

  if v_metodo = 'straight_line' then
    v_monto := (v_base - v_rescate) / v_vida;
  else
    v_monto := v_valor_libros * (2.0 / v_vida);
  end if;

  return round(least(v_monto, v_depreciable), 2);
end;
$$;

-- ── Corre la depreciacion del periodo para todos los activos activos ─────
create function public.run_fixed_asset_depreciation(p_tenant uuid, p_period date) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n     integer := 0;
  r       record;
  v_monto numeric;
begin
  if p_tenant is distinct from rls.tenant_id() then
    raise exception 'No puedes depreciar activos de otro cliente.' using errcode = '42501';
  end if;
  if not rls.module_active('fixed-assets') then
    raise exception 'El modulo de activos fijos no esta activo.' using errcode = '42501';
  end if;

  for r in
    select a.id from public.fixed_assets a
    where a.tenant_id = p_tenant and a.status = 'active'
      and not exists (
        select 1 from public.fixed_asset_depreciations d
        where d.asset_id = a.id and d.period_date = p_period)
  loop
    v_monto := public.fixed_asset_monthly_depreciation(r.id);
    if v_monto > 0 then
      insert into public.fixed_asset_depreciations (tenant_id, asset_id, period_date, amount)
      values (p_tenant, r.id, p_period, v_monto);
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.run_fixed_asset_depreciation(uuid, date) from public;
grant execute on function public.run_fixed_asset_depreciation(uuid, date) to authenticated;

comment on function public.run_fixed_asset_depreciation(uuid, date) is
  'Corre un periodo para todos los activos activos sin depreciacion ya registrada para esa fecha. Idempotente: correrla dos veces para el mismo periodo no duplica nada -el unique (tenant_id, asset_id, period_date) lo impide-.';

-- ── Revaluar: historico, nunca sobreescribe ──────────────────────────────
create function public.revalue_fixed_asset(p_asset uuid, p_new_value numeric, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status text;
  v_actual numeric;
begin
  select tenant_id, status into v_tenant, v_status
    from public.fixed_assets where id = p_asset for update;

  if not found then
    raise exception 'Ese activo no existe.' using errcode = 'P0002';
  end if;
  if v_tenant is distinct from rls.tenant_id() then
    raise exception 'Ese activo no es de este cliente.' using errcode = '42501';
  end if;
  if v_status = 'disposed' then
    raise exception 'Un activo dado de baja no se revalua.' using errcode = '55000';
  end if;
  if p_reason is null or length(trim(p_reason)) < 4 then
    raise exception 'Escribe el motivo del revaluo.' using errcode = '55000';
  end if;

  v_actual := public.fixed_asset_current_basis(p_asset);

  insert into public.fixed_asset_revaluations
    (tenant_id, asset_id, old_value, new_value, reason, created_by)
  values (v_tenant, p_asset, v_actual, p_new_value, p_reason, rls.regb_uid());
end;
$$;

revoke all on function public.revalue_fixed_asset(uuid, numeric, text) from public;
grant execute on function public.revalue_fixed_asset(uuid, numeric, text) to authenticated;

-- ── Dar de baja ───────────────────────────────────────────────────────────
create function public.dispose_fixed_asset(
  p_asset uuid, p_disposed_at date, p_disposed_amount numeric, p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status text;
begin
  select tenant_id, status into v_tenant, v_status
    from public.fixed_assets where id = p_asset for update;

  if not found then
    raise exception 'Ese activo no existe.' using errcode = 'P0002';
  end if;
  if v_tenant is distinct from rls.tenant_id() then
    raise exception 'Ese activo no es de este cliente.' using errcode = '42501';
  end if;
  if v_status = 'disposed' then
    raise exception 'Ese activo ya esta dado de baja.' using errcode = '55000';
  end if;
  if p_reason is null or length(trim(p_reason)) < 4 then
    raise exception 'Escribe el motivo de la baja.' using errcode = '55000';
  end if;

  update public.fixed_assets
  set status = 'disposed', disposed_at = p_disposed_at,
      disposed_amount = p_disposed_amount, disposed_reason = p_reason
  where id = p_asset;
end;
$$;

revoke all on function public.dispose_fixed_asset(uuid, date, numeric, text) from public;
grant execute on function public.dispose_fixed_asset(uuid, date, numeric, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('fixed_assets',             'fixed-assets'),
      ('fixed_asset_depreciations','fixed-assets'),
      ('fixed_asset_revaluations', 'fixed-assets')
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

-- El mismo agujero de siempre (0031/0040/accounting/ap/treasury/bank-rec),
-- tapado desde el primer dia: la RLS de insert solo compara el tenant_id
-- de la fila nueva, no a quien pertenece asset_id. Una sola funcion sirve
-- para las dos tablas -depreciaciones y revaluos-: ambas tienen la misma
-- forma (asset_id + tenant_id).
create function public.impedir_activo_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.fixed_assets where id = new.asset_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese activo no pertenece a ese cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_activo_ajeno before insert on public.fixed_asset_depreciations
  for each row execute function public.impedir_activo_ajeno();
create trigger no_activo_ajeno before insert on public.fixed_asset_revaluations
  for each row execute function public.impedir_activo_ajeno();

-- ── Un registro de depreciacion o de revaluo no se edita ni se borra ─────
create function public.impedir_editar_historico_activo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Este registro es historico: no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_depreciacion before update or delete on public.fixed_asset_depreciations
  for each row execute function public.impedir_editar_historico_activo();
create trigger no_editar_revaluo before update or delete on public.fixed_asset_revaluations
  for each row execute function public.impedir_editar_historico_activo();

-- ── Un activo dado de baja no se edita mas ───────────────────────────────
create function public.impedir_editar_activo_de_baja() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'disposed' then
    raise exception 'Un activo dado de baja no se edita: es historico.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_activo_de_baja before update or delete on public.fixed_assets
  for each row execute function public.impedir_editar_activo_de_baja();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.fixed_assets
  for each row execute function audit.record('fixed-assets');
create trigger audit_me after insert or update or delete on public.fixed_asset_revaluations
  for each row execute function audit.record('fixed-assets');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{}',
    recommends   = '{accounting}',
    tagline      = 'Sabe cuanto valen de verdad tus vehiculos, equipos y muebles',
    problem      = 'La camioneta, la nevera del colmado, las computadoras de la oficina: se compraron hace anos y nadie sabe cuanto valen hoy en los libros, ni cuando terminan de depreciarse, ni cuanto se gano o se perdio cuando se vendio el ultimo equipo viejo.',
    features     = '[
      {"titulo":"Linea recta o acelerada","detalle":"El monto fijo de siempre, o saldos decrecientes al doble de la tasa para el equipo que pierde valor mas rapido al principio. La formula nunca deprecia por debajo del valor de rescate."},
      {"titulo":"Calendario completo de un vistazo","detalle":"Ve la depreciacion mes a mes hasta el final de la vida util antes de correr un solo periodo -para revisar el plan, no solo para ver lo que ya paso-."},
      {"titulo":"Correr el periodo no duplica nada","detalle":"Correr la depreciacion del mes dos veces por accidente no le cobra el gasto dos veces a ningun activo: el que ya tiene su registro de ese mes se salta solo."},
      {"titulo":"Revaluo con historial","detalle":"Un avaluo nuevo no borra el anterior: cada revaluo queda registrado con su motivo y su fecha, y la depreciacion futura se recalcula sobre el valor mas reciente."},
      {"titulo":"La baja calcula la ganancia o perdida sola","detalle":"Al vender o dar de baja un activo, la diferencia contra su valor en libros se calcula automaticamente -no hay que sacar la cuenta a mano-."}
    ]'::jsonb,
    audience     = '{"Negocios con vehiculos o maquinaria propia","Distribuidoras","Cualquiera que ya usa contabilidad y quiere activos fijos ordenados"}',
    faq          = '[
      {"p":"¿Necesito contabilidad para usarlo?","r":"No. Activos fijos funciona solo. Cuando accounting sepa contabilizar automaticamente desde otros modulos -todavia no construido para ninguno-, la depreciacion y el revaluo podran generar su asiento solos."},
      {"p":"¿El revaluo contabiliza el superavit o deficit contra patrimonio?","r":"No en esta version: solo registra el nuevo valor y ajusta la depreciacion futura. Contabilizarlo contra patrimonio pide que accounting sepa recibir asientos automaticos de otro modulo, una pieza que ainda no existe."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'fixed-assets';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'fixed-assets'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'fixed-assets no tiene precio en los 3 tiers';
  end if;
end $$;
