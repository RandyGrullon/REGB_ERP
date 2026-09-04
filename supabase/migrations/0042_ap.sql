-- ═══════════════════════════════════════════════════════════════════════
--  0042 — Cuentas por pagar (modulo 18, F6/S30)
--
--  El contraparte de `ar` (0023): aqui el proveedor nos factura a
--  NOSOTROS. Reusa `public.suppliers` de purchase-orders (0038) — mismo
--  patron que `customers` es de sales-orders y lo comparten pos/ar.
--
--  Sin numeracion propia: el "numero de factura" es el del PROVEEDOR
--  (`supplier_invoice_number`), no algo que nosotros generamos — al
--  reves que `ar`, donde SI emitimos nuestra propia factura numerada.
--
--  Retencion: se CAPTURA, no se calcula. No hay formula fija de cuando
--  aplica ni de cuanto -mismo criterio que el cargo por mora de la 0040-.
-- ═══════════════════════════════════════════════════════════════════════

create table public.supplier_invoices (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references regb.tenants(id) on delete cascade,
  supplier_id            uuid not null references public.suppliers(id),
  -- El numero que el PROVEEDOR le puso a su propia factura. Distintos
  -- proveedores pueden repetir "001", por eso la unicidad es por
  -- proveedor, no por tenant a secas.
  supplier_invoice_number text not null,
  supplier_ncf           text,
  -- De donde salio: una orden de compra recibida, o capturada a mano.
  source_type            text not null default 'manual'
                            check (source_type in ('purchase_order', 'manual')),
  source_id              uuid,
  issue_date             date not null default current_date,
  due_date               date not null,
  subtotal               numeric(12,2) not null default 0,
  tax                    numeric(12,2) not null default 0,
  -- Capturada a mano, nunca calculada. Ver comentario de cabecera.
  retention_amount       numeric(12,2) not null default 0 check (retention_amount >= 0),
  total                  numeric(12,2) not null check (total >= 0),
  status                 text not null default 'open'
                           check (status in ('open','partially_paid','paid','overdue','void')),
  void_reason            text,
  notes                  text,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  unique (tenant_id, supplier_id, supplier_invoice_number),
  check (due_date >= issue_date),
  check (status <> 'void' or void_reason is not null),
  check (retention_amount <= total)
);

create index on public.supplier_invoices (tenant_id, supplier_id, due_date);
create index supplier_invoices_open_idx on public.supplier_invoices (tenant_id, due_date)
  where status in ('open','partially_paid','overdue');

comment on column public.supplier_invoices.retention_amount is
  'Retencion capturada a mano, no calculada: no hay formula fija de cuando aplica ni de cuanto. Reduce lo que se le paga al proveedor -esa parte se le paga a la DGII en su lugar-, mismo efecto que un pago para efectos del saldo.';

create table public.supplier_payments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  invoice_id  uuid not null references public.supplier_invoices(id),
  amount      numeric(12,2) not null check (amount > 0),
  method      text not null default 'transfer' check (method in ('cash','card','transfer','check')),
  reference   text,
  paid_at     timestamptz not null default now(),
  paid_by     uuid,
  notes       text
);

create index on public.supplier_payments (tenant_id, invoice_id);

-- ── Saldo: se DERIVA, nunca se guarda ────────────────────────────────────
--  Mismo principio que invoice_balance() en ar (0023): total - retencion -
--  pagado. La retencion cuenta como si fuera un pago porque, para lo que
--  el proveedor de verdad recibe, lo es -esa parte simplemente no se le
--  paga a el, se le paga a la DGII-.
create function public.ap_invoice_balance(p_invoice uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select i.total - i.retention_amount - coalesce((
    select sum(p.amount) from public.supplier_payments p where p.invoice_id = i.id
  ), 0)
  from public.supplier_invoices i
  where i.id = p_invoice
$$;

comment on function public.ap_invoice_balance(uuid) is
  'total - retencion - pagado. Derivado a proposito: un saldo guardado se desincroniza el dia que se anule un pago.';

-- ── Vencidas: marcar las que pasaron su fecha ────────────────────────────
create function public.mark_overdue_supplier_invoices(p_tenant uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.supplier_invoices i
  set status = 'overdue'
  where i.tenant_id = p_tenant
    and i.status in ('open','partially_paid')
    and i.due_date < current_date
    and public.ap_invoice_balance(i.id) > 0;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_overdue_supplier_invoices(uuid) from public;
grant execute on function public.mark_overdue_supplier_invoices(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('supplier_invoices', 'ap'),
      ('supplier_payments', 'ap')
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

-- El mismo agujero que 0040 encontro en invoice_late_fees, aqui de
-- entrada: la RLS de insert en supplier_payments solo mira el tenant_id
-- de la fila nueva, no a quien pertenece invoice_id.
create function public.impedir_pago_a_factura_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.supplier_invoices where id = new.invoice_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa factura no pertenece a ese cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_pago_a_factura_ajena before insert on public.supplier_payments
  for each row execute function public.impedir_pago_a_factura_ajena();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.supplier_invoices
  for each row execute function audit.record('ap');
create trigger audit_me after insert or update or delete on public.supplier_payments
  for each row execute function audit.record('ap');
