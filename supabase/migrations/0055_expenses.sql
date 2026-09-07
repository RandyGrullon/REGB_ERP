-- ═══════════════════════════════════════════════════════════════════════
--  0055 — Gastos & Reembolsos (modulo 68, F7/S40)
--
--  "OCR" del catalogo (§5.6) NO se construye aqui -leer un recibo
--  fotografiado pide un servicio de vision por computadora con
--  credenciales que este sistema no tiene, mismo criterio que el
--  "biometrico" de attendance o el "gateway" de payments-. El recibo se
--  registra como una nota de texto -proveedor, RNC, NCF si tiene, monto,
--  fecha-, escrita por quien reporta el gasto.
--
--  "Reembolso en nomina" se registra como un HECHO -que periodo lo pago,
--  por que metodo-, no como una linea que se inyecta en el calculo de
--  `payroll_lines`: esa integracion real es una fase futura.
-- ═══════════════════════════════════════════════════════════════════════

create table public.expenses (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references regb.tenants(id) on delete cascade,
  employee_id            uuid not null references public.employees(id),
  category               text not null check (category in
                           ('travel', 'meals', 'transport', 'supplies', 'lodging', 'other')),
  expense_date           date not null,
  amount                 numeric(12,2) not null check (amount > 0),
  currency               text not null default 'DOP',
  vendor_name            text,
  vendor_tax_id          text,
  ncf                    text,
  receipt_note           text,
  status                 text not null default 'submitted'
                           check (status in ('submitted', 'approved', 'rejected', 'reimbursed')),
  decided_by             uuid,
  decided_at             timestamptz,
  decision_note          text,
  reimbursed_at          timestamptz,
  reimbursement_method   text check (reimbursement_method in ('payroll', 'transfer', 'cash')),
  payroll_period_id      uuid references public.payroll_periods(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index on public.expenses (tenant_id, employee_id, expense_date desc);
create index on public.expenses (tenant_id, status);

comment on column public.expenses.receipt_note is
  'Sin OCR real: nota de texto escrita a mano, no una foto procesada automaticamente.';
comment on column public.expenses.payroll_period_id is
  'Registra en que periodo se reembolso -informativo-, no modifica el calculo de payroll_lines.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.expenses enable row level security;
alter table public.expenses force row level security;

create policy tenant_module on public.expenses for all
  using (tenant_id = rls.tenant_id() and rls.module_active('expenses'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('expenses'));

create policy provider_impersonating on public.expenses for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7 desde entonces):
-- la RLS de insert solo compara el tenant_id de la fila nueva, no a quien
-- pertenecen employee_id ni payroll_period_id.
create function public.impedir_gasto_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_empleado uuid;
  v_tenant_periodo  uuid;
begin
  select tenant_id into v_tenant_empleado from public.employees where id = new.employee_id;
  if v_tenant_empleado is distinct from new.tenant_id then
    raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  if new.payroll_period_id is not null then
    select tenant_id into v_tenant_periodo from public.payroll_periods where id = new.payroll_period_id;
    if v_tenant_periodo is distinct from new.tenant_id then
      raise exception 'Ese periodo de nomina no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger no_gasto_ajeno before insert or update on public.expenses
  for each row execute function public.impedir_gasto_ajeno();

-- ── Un gasto rechazado o ya reembolsado es inmutable ─────────────────────
-- 'approved' NO es terminal: todavia puede pasar a 'reimbursed'. Solo
-- 'rejected' y 'reimbursed' bloquean edicion o borrado.
create function public.impedir_editar_gasto_resuelto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('rejected', 'reimbursed') then
    raise exception 'Ese gasto ya fue resuelto y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_gasto_resuelto
  before update or delete on public.expenses
  for each row execute function public.impedir_editar_gasto_resuelto();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.expenses
  for each row execute function audit.record('expenses');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'De la nota del gasto al reembolso, con el ITBIS deducible calculado si hay NCF',
    problem      = 'Sin un registro real, los gastos de bolsillo se reembolsan por confianza y nadie sabe si esa factura da o no da credito de ITBIS.',
    features     = '[
      {"titulo":"Flujo real de aprobacion","detalle":"Enviado, aprobado o rechazado, y solo lo aprobado pasa a reembolsado -un gasto rechazado o ya reembolsado no se edita-."},
      {"titulo":"ITBIS deducible calculado, no adivinado","detalle":"Con un NCF fiscal valido del proveedor, el sistema calcula cuanto de ese monto es ITBIS acreditable -sin NCF, se reembolsa igual, pero no es deducible para la empresa-."},
      {"titulo":"Reembolso con memoria","detalle":"Queda registrado por que metodo se pago -nomina, transferencia o efectivo- y en que periodo, sin inventar una linea que no paso por la nomina real."},
      {"titulo":"Honesto sobre el OCR","detalle":"No lee la foto del recibo automaticamente -eso pide un servicio de vision por computadora que este sistema no tiene-. El monto y el proveedor los escribe quien reporta el gasto."}
    ]'::jsonb,
    audience     = '{"Negocios con empleados que gastan de su bolsillo y luego cobran","Cualquiera que ya use employees y quiera dejar de reembolsar por confianza"}',
    faq          = '[
      {"p":"¿Lee la foto del recibo y saca el monto solo?","r":"No -eso pide un servicio de OCR con credenciales que este sistema no tiene-. El monto, la fecha y el proveedor se escriben a mano."},
      {"p":"¿El reembolso se suma solo a la nomina?","r":"No: se registra que un gasto se reembolso en un periodo y por que metodo, pero no modifica el calculo de esa nomina -esa integracion es una fase futura-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'expenses';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'expenses'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'expenses no tiene precio en los 3 tiers';
  end if;
end $$;
