-- ═══════════════════════════════════════════════════════════════════════
--  0023 — Cuentas por cobrar (F4 · S22)
--
--  Cerrar el ciclo: vender ya funciona, ahora hay que COBRAR. Sin esto un
--  negocio a credito no sabe quien le debe ni desde cuando, que es la
--  razon numero uno por la que una PYME vuelve a Excel.
--
--  Tres piezas: la factura, los cobros que la van saldando y el saldo, que
--  NO se guarda: se deriva de total - cobrado. Un saldo guardado a mano se
--  desincroniza el dia que alguien anule un cobro.
--
--  OJO con el nombre: `regb.invoices` son las facturas que REGB le cobra a
--  sus clientes (F3). `public.customer_invoices` son las que el cliente le
--  cobra a los suyos. Cosas distintas en esquemas distintos.
-- ═══════════════════════════════════════════════════════════════════════

create table public.customer_invoices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  number        text not null,
  customer_id   uuid not null references public.customers(id),
  -- De donde salio: un pedido entregado o un ticket de caja a credito.
  source_type   text check (source_type in ('sales_order','pos_sale','manual')),
  source_id     uuid,
  issue_date    date not null default current_date,
  -- Sale de customers.payment_terms al emitir. Se guarda porque los dias de
  -- credito del cliente pueden cambiar despues y esta factura ya vencio con
  -- los de aquel dia.
  due_date      date not null,
  subtotal      numeric(12,2) not null default 0,
  discount      numeric(12,2) not null default 0,
  tax           numeric(12,2) not null default 0,
  total         numeric(12,2) not null check (total >= 0),
  status        text not null default 'open'
                  check (status in ('open','partially_paid','paid','overdue','void')),
  void_reason   text,
  notes         text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (tenant_id, number),
  check (due_date >= issue_date),
  check (status <> 'void' or void_reason is not null)
);

create index on public.customer_invoices (tenant_id, customer_id, due_date);
-- Para la cartera: las que siguen debiendo, ordenadas por antiguedad.
create index customer_invoices_open_idx on public.customer_invoices (tenant_id, due_date)
  where status in ('open','partially_paid','overdue');

create table public.customer_payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  invoice_id   uuid not null references public.customer_invoices(id),
  amount       numeric(12,2) not null check (amount > 0),
  method       text not null default 'cash' check (method in ('cash','card','transfer','check')),
  reference    text,
  received_at  timestamptz not null default now(),
  received_by  uuid,
  notes        text
);

create index on public.customer_payments (tenant_id, invoice_id);

-- ── Numeracion de la factura del cliente ─────────────────────────────────
create table public.customer_invoice_counters (
  tenant_id uuid not null references regb.tenants(id) on delete cascade,
  year      smallint not null,
  last_n    integer not null default 0,
  primary key (tenant_id, year)
);

create function public.next_customer_invoice_number(p_tenant uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from now())::smallint;
  v_n    integer;
begin
  insert into public.customer_invoice_counters as c (tenant_id, year, last_n)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;

  return format('FA-%s-%s', v_year, lpad(v_n::text, 5, '0'));
end;
$$;

revoke all on function public.next_customer_invoice_number(uuid) from public;
grant execute on function public.next_customer_invoice_number(uuid) to authenticated;

-- ── Saldo: se DERIVA, nunca se guarda ────────────────────────────────────
create function public.invoice_balance(p_invoice uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select i.total - coalesce((
    select sum(p.amount) from public.customer_payments p where p.invoice_id = i.id
  ), 0)
  from public.customer_invoices i
  where i.id = p_invoice
$$;

comment on function public.invoice_balance(uuid) is
  'total - cobrado. Derivado a proposito: un saldo guardado se desincroniza el dia que se anule un cobro.';

-- ── Vencidas: marcar las que pasaron su fecha ────────────────────────────
--  Idempotente. La corre el panel o un cron; no depende de que alguien abra
--  la pantalla para que una factura cuente como vencida.
create function public.mark_overdue_invoices(p_tenant uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.customer_invoices i
  set status = 'overdue'
  where i.tenant_id = p_tenant
    and i.status in ('open','partially_paid')
    and i.due_date < current_date
    and public.invoice_balance(i.id) > 0;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_overdue_invoices(uuid) from public;
grant execute on function public.mark_overdue_invoices(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'customer_invoices','customer_payments','customer_invoice_counters'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy tenant_module on public.%I for all
         using (tenant_id = rls.tenant_id() and rls.module_active(''ar''))
         with check (tenant_id = rls.tenant_id() and rls.module_active(''ar''))', t);
    execute format(
      'create policy provider_impersonating on public.%I for select
         using (rls.impersonating(tenant_id))', t);
  end loop;
end $$;

-- ── Bitacora ────────────────────────────────────────────────────────────
--  Facturar y cobrar son las dos decisiones que alguien tiene que poder
--  explicar meses despues.
create trigger audit_me after insert or update or delete on public.customer_invoices
  for each row execute function audit.record('ar');
create trigger audit_me after insert or update or delete on public.customer_payments
  for each row execute function audit.record('ar');
