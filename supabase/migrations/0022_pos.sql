-- ═══════════════════════════════════════════════════════════════════════
--  0022 — Punto de venta: turnos, ventas y arqueo (F4 · S21)
--
--  El modulo que engancha a una PYME. Tres piezas:
--   1. pos_shifts      — el turno del cajero: apertura, cierre y arqueo
--   2. pos_sales       — cada ticket
--   3. pos_sale_lines / pos_payments — que se vendio y como se pago
--
--  Un ticket SIEMPRE pertenece a un turno abierto. Sin esa regla no hay
--  arqueo posible: al cerrar la caja no se sabria que ventas contar.
--
--  El pago admite varias formas en un mismo ticket (mitad efectivo, mitad
--  tarjeta), que es lo normal en un mostrador dominicano.
-- ═══════════════════════════════════════════════════════════════════════

create table public.pos_shifts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  warehouse_id   uuid not null references public.warehouses(id),
  cashier_id     uuid,
  opening_float  numeric(12,2) not null default 0 check (opening_float >= 0),
  -- Lo que el cajero CONTO al cerrar. Null mientras el turno esta abierto.
  counted_cash   numeric(12,2) check (counted_cash >= 0),
  -- Diferencia contra lo esperado. Se guarda calculada para poder
  -- reconstruir el cierre aunque despues se anule un ticket.
  expected_cash  numeric(12,2),
  variance       numeric(12,2),
  status         text not null default 'open' check (status in ('open','closed')),
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  notes          text
);

-- Un cajero, un turno abierto por almacen. Dos turnos abiertos a la vez
-- hacen imposible saber a cual cargar la venta.
create unique index pos_shifts_one_open_idx
  on public.pos_shifts (tenant_id, warehouse_id)
  where status = 'open';

create index on public.pos_shifts (tenant_id, opened_at desc);

create table public.pos_sales (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  shift_id     uuid not null references public.pos_shifts(id),
  number       text not null,
  customer_id  uuid references public.customers(id),   -- null = consumidor final
  subtotal     numeric(12,2) not null default 0,
  discount     numeric(12,2) not null default 0,
  tax          numeric(12,2) not null default 0,
  total        numeric(12,2) not null default 0,
  -- Anular NO borra el ticket: lo marca. Un ticket que desaparece es un
  -- agujero en la numeracion y en la auditoria fiscal.
  voided       boolean not null default false,
  void_reason  text,
  voided_at    timestamptz,
  cashier_id   uuid,
  created_at   timestamptz not null default now(),
  unique (tenant_id, number),
  check (not voided or void_reason is not null)
);

create index on public.pos_sales (tenant_id, shift_id);
create index on public.pos_sales (tenant_id, created_at desc);

create table public.pos_sale_lines (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references public.pos_sales(id) on delete cascade,
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  qty          numeric(14,3) not null check (qty > 0),
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  -- FRACCION (0.18 = 18%), igual que products y sales_order_lines. Ver 0021.
  tax_rate     numeric(5,4) not null default 0.18 check (tax_rate >= 0 and tax_rate <= 1),
  line_total   numeric(12,2) not null default 0
);

create index on public.pos_sale_lines (tenant_id, sale_id);

create table public.pos_payments (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references public.pos_sales(id) on delete cascade,
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  method     text not null check (method in ('cash','card','transfer')),
  amount     numeric(12,2) not null check (amount > 0),
  reference  text
);

create index on public.pos_payments (tenant_id, sale_id);

-- ── Numeracion del ticket, por tenant y ano ──────────────────────────────
create table public.pos_sale_counters (
  tenant_id uuid not null references regb.tenants(id) on delete cascade,
  year      smallint not null,
  last_n    integer not null default 0,
  primary key (tenant_id, year)
);

create function public.next_pos_sale_number(p_tenant uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from now())::smallint;
  v_n    integer;
begin
  insert into public.pos_sale_counters as c (tenant_id, year, last_n)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;

  return format('TK-%s-%s', v_year, lpad(v_n::text, 6, '0'));
end;
$$;

revoke all on function public.next_pos_sale_number(uuid) from public;
grant execute on function public.next_pos_sale_number(uuid) to authenticated;

-- ── Efectivo esperado en un turno ────────────────────────────────────────
--  Fondo de apertura + todo lo cobrado EN EFECTIVO en tickets no anulados.
--  Las tarjetas y transferencias no estan en la gaveta, asi que no cuentan.
create function public.pos_expected_cash(p_shift uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.opening_float, 0) + coalesce((
    select sum(p.amount)
    from public.pos_payments p
    join public.pos_sales sa on sa.id = p.sale_id
    where sa.shift_id = p_shift and not sa.voided and p.method = 'cash'
  ), 0)
  from public.pos_shifts s
  where s.id = p_shift
$$;

comment on function public.pos_expected_cash(uuid) is
  'Fondo + efectivo cobrado en tickets vigentes. Tarjeta y transferencia no estan en la gaveta.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'pos_shifts','pos_sales','pos_sale_lines','pos_payments','pos_sale_counters'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy tenant_module on public.%I for all
         using (tenant_id = rls.tenant_id() and rls.module_active(''pos''))
         with check (tenant_id = rls.tenant_id() and rls.module_active(''pos''))', t);
    execute format(
      'create policy provider_impersonating on public.%I for select
         using (rls.impersonating(tenant_id))', t);
  end loop;
end $$;

-- ── Bitacora ────────────────────────────────────────────────────────────
--  El ticket individual no se audita: ya es inmutable por diseno (anular
--  marca, no borra) y una caja genera miles al dia. Se auditan el turno y
--  las anulaciones, que son las decisiones que alguien tiene que explicar.
create trigger audit_me after insert or update or delete on public.pos_shifts
  for each row execute function audit.record('pos');
