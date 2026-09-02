-- ═══════════════════════════════════════════════════════════════════════
--  0040 — Cargo por mora (ar)
--
--  Hoy lo calculan a mano: cuentan cuantos dias se tardo el cliente en
--  pagar y deciden si le cobran algo encima. NO es una formula fija -no
--  es "% x saldo" ni "% x dias de atraso"- es una decision del negocio,
--  caso por caso, que se puede modificar. Por eso este modulo NO calcula
--  el cargo: solo deja ver los dias de atraso (ya visible en /cobrar) y
--  capturar el monto que decidan, respetando el cliente exento.
--
--  Ledger igual que inventory_movements y audit.log: nunca se edita ni se
--  borra un cargo ya aplicado. Si se cobro de mas por error, se corrige
--  con una nota de credito aparte, no borrando la fila.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.customers
  add column if not exists late_fee_exempt boolean not null default false;

comment on column public.customers.late_fee_exempt is
  'Si es true, esta factura nunca genera cargo por mora aunque pague tarde. Flag fijo que alguien marca a mano, no se calcula solo.';

create table public.invoice_late_fees (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  invoice_id  uuid not null references public.customer_invoices(id),
  amount      numeric(12,2) not null check (amount > 0),
  -- Informativo: cuantos dias de atraso tenia CUANDO se aplico. Se guarda
  -- porque los dias siguen corriendo despues, y sin esto no queda registro
  -- de con que atraso se decidio el monto.
  days_late_at_charge integer not null check (days_late_at_charge >= 0),
  notes       text,
  applied_by  uuid,
  applied_at  timestamptz not null default now()
);

create index on public.invoice_late_fees (tenant_id, invoice_id);

comment on table public.invoice_late_fees is
  'Cargos por mora aplicados a mano. Ledger de solo insercion, igual que inventory_movements: un cargo aplicado por error se revierte con una nota de credito, no editando ni borrando la fila.';

-- ── El saldo ahora incluye los cargos por mora ───────────────────────────
--  Mismo principio que ya tenia la funcion: se deriva, nunca se guarda.
--  Un cargo aplicado a una factura ya "paid" la reabre -es correcto: el
--  cliente termino de pagar el capital, pero ahora debe el cargo por mora
--  que se decidio despues-.
create or replace function public.invoice_balance(p_invoice uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select i.total
    + coalesce((
        select sum(f.amount) from public.invoice_late_fees f where f.invoice_id = i.id
      ), 0)
    - coalesce((
        select sum(p.amount) from public.customer_payments p where p.invoice_id = i.id
      ), 0)
  from public.customer_invoices i
  where i.id = p_invoice
$$;

comment on function public.invoice_balance(uuid) is
  'total + cargos por mora - cobrado. Derivado a proposito: un saldo guardado se desincroniza el dia que se anule un cobro o se agregue un cargo.';

-- ── Un cliente exento no genera cargos, ni por un descuido del servidor ──
--  La accion del servidor ya lo comprueba, pero la regla vive tambien aqui
--  porque es la unica manera de que sea imposible saltarsela, hoy o el dia
--  que alguien agregue un segundo camino para insertar un cargo.
create function public.impedir_mora_a_exento() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exento boolean;
  v_tenant uuid;
begin
  select c.late_fee_exempt, i.tenant_id into v_exento, v_tenant
  from public.customer_invoices i
  join public.customers c on c.id = i.customer_id
  where i.id = new.invoice_id;

  if v_tenant is distinct from new.tenant_id then
    raise exception 'La factura no pertenece a ese cliente.' using errcode = '42501';
  end if;
  if v_exento then
    raise exception 'Este cliente esta exento de cargos por mora.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger no_mora_a_exentos before insert on public.invoice_late_fees
  for each row execute function public.impedir_mora_a_exento();

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.invoice_late_fees enable row level security;
alter table public.invoice_late_fees force row level security;

create policy tenant_module on public.invoice_late_fees for all
  using (tenant_id = rls.tenant_id() and rls.module_active('ar'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('ar'));

create policy provider_impersonating on public.invoice_late_fees for select
  using (rls.impersonating(tenant_id));

create trigger audit_me after insert or update or delete on public.invoice_late_fees
  for each row execute function audit.record('ar');
