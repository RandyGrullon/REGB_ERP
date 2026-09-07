-- ═══════════════════════════════════════════════════════════════════════
--  0057 — Beneficios (modulo 69, F7/S41)
--
--  SIN integracion real con aseguradoras -procesar un reclamo ante una
--  ARS/seguro pide una integracion con esa aseguradora que este sistema
--  no tiene, mismo criterio que el gateway de payments-. `benefit_enrollments`
--  registra quien esta inscrito y cuanto aporta cada quien, no procesa
--  reclamos.
--
--  El saldo de un prestamo NUNCA se guarda: se deriva siempre del
--  principal menos los pagos -`saldoPrestamo()` en @regb/operations-,
--  mismo principio que el saldo de una factura o el saldo de vacaciones.
-- ═══════════════════════════════════════════════════════════════════════

create table public.benefit_loans (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references regb.tenants(id) on delete cascade,
  employee_id         uuid not null references public.employees(id),
  loan_type           text not null check (loan_type in ('loan', 'advance')),
  principal           numeric(12,2) not null check (principal > 0),
  installments        integer not null check (installments > 0),
  installment_amount  numeric(12,2) not null check (installment_amount > 0),
  monthly_rate        numeric(6,4) not null default 0 check (monthly_rate >= 0),
  status              text not null default 'active' check (status in ('active', 'paid', 'cancelled')),
  start_date          date not null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index on public.benefit_loans (tenant_id, employee_id);
create index on public.benefit_loans (tenant_id, status);

-- Pagos de un prestamo: hecho historico, NUNCA editado ni borrado -mismo
-- criterio que un asiento contabilizado-. El saldo se deriva de la suma
-- de estas filas, nunca al reves.
create table public.benefit_loan_payments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references regb.tenants(id) on delete cascade,
  loan_id             uuid not null references public.benefit_loans(id) on delete cascade,
  amount              numeric(12,2) not null check (amount > 0),
  paid_at             timestamptz not null default now(),
  source              text not null default 'payroll' check (source in ('payroll', 'cash', 'transfer')),
  payroll_period_id   uuid references public.payroll_periods(id),
  created_at          timestamptz not null default now()
);

create index on public.benefit_loan_payments (tenant_id, loan_id);

create table public.benefit_enrollments (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references regb.tenants(id) on delete cascade,
  employee_id             uuid not null references public.employees(id),
  plan_name               text not null,
  employee_contribution   numeric(12,2) not null default 0 check (employee_contribution >= 0),
  employer_contribution   numeric(12,2) not null default 0 check (employer_contribution >= 0),
  effective_date          date not null,
  status                  text not null default 'active' check (status in ('active', 'cancelled')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, employee_id, plan_name)
);

create index on public.benefit_enrollments (tenant_id, employee_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('benefit_loans',         'benefits'),
      ('benefit_loan_payments', 'benefits'),
      ('benefit_enrollments',   'benefits')
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

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenecen employee_id, loan_id ni payroll_period_id.
create function public.impedir_prestamo_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.employees where id = new.employee_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_prestamo_ajeno before insert on public.benefit_loans
  for each row execute function public.impedir_prestamo_ajeno();

create function public.impedir_pago_prestamo_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_prestamo uuid;
  v_tenant_periodo  uuid;
begin
  select tenant_id into v_tenant_prestamo from public.benefit_loans where id = new.loan_id;
  if v_tenant_prestamo is distinct from new.tenant_id then
    raise exception 'Ese prestamo no pertenece a esta cuenta.' using errcode = '42501';
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

create trigger no_pago_prestamo_ajeno before insert on public.benefit_loan_payments
  for each row execute function public.impedir_pago_prestamo_ajeno();

create function public.impedir_inscripcion_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.employees where id = new.employee_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_inscripcion_ajena before insert on public.benefit_enrollments
  for each row execute function public.impedir_inscripcion_ajena();

-- ── Un prestamo saldado o cancelado es inmutable ─────────────────────────
create function public.impedir_editar_prestamo_resuelto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('paid', 'cancelled') then
    raise exception 'Ese prestamo ya quedo resuelto y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_prestamo_resuelto
  before update or delete on public.benefit_loans
  for each row execute function public.impedir_editar_prestamo_resuelto();

-- ── Un pago de prestamo, como un asiento, no se edita nunca ──────────────
create function public.impedir_editar_pago_prestamo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un pago de prestamo ya registrado no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_pago_prestamo
  before update or delete on public.benefit_loan_payments
  for each row execute function public.impedir_editar_pago_prestamo();

-- ── Una inscripcion cancelada es inmutable ───────────────────────────────
create function public.impedir_editar_inscripcion_cancelada() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'cancelled' then
    raise exception 'Esa inscripcion ya fue cancelada y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_inscripcion_cancelada
  before update or delete on public.benefit_enrollments
  for each row execute function public.impedir_editar_inscripcion_cancelada();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.benefit_loans
  for each row execute function audit.record('benefits');
create trigger audit_me after insert or update or delete on public.benefit_enrollments
  for each row execute function audit.record('benefits');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Prestamos y adelantos con saldo calculado de verdad, sin una hoja de Excel aparte',
    problem      = 'Sin un registro real, un prestamo interno se lleva en una hoja de calculo que nadie actualiza a tiempo, y el saldo que se descuenta de la nomina se discute cada quincena.',
    features     = '[
      {"titulo":"Cuota calculada, no adivinada","detalle":"Sin interes -el caso tipico de un prestamo interno- o con una tasa mensual, la cuota se calcula con el sistema frances de amortizacion."},
      {"titulo":"Saldo siempre derivado","detalle":"Nunca un numero guardado que se desincroniza: el saldo es el principal menos la suma de los pagos registrados."},
      {"titulo":"Un pago registrado es un hecho, no una nota editable","detalle":"Igual que un asiento contabilizado: un pago de prestamo no se edita ni se borra una vez registrado."},
      {"titulo":"Honesto sobre el seguro","detalle":"Registra quien esta inscrito en que plan y cuanto aporta cada quien -no procesa reclamos ante la aseguradora, eso es una integracion que este sistema no tiene-."}
    ]'::jsonb,
    audience     = '{"Negocios que ya prestan dinero a sus empleados de forma informal","Cualquiera que ya use employees y quiera dejar la hoja de Excel"}',
    faq          = '[
      {"p":"¿Procesa reclamos ante la ARS o la aseguradora?","r":"No -eso pide una integracion real con esa aseguradora que este sistema no tiene-. Registra la inscripcion y el aporte de cada plan, nada mas."},
      {"p":"¿Se puede editar un pago de prestamo ya registrado?","r":"No, igual que un asiento contabilizado: un pago registrado es un hecho fijo. Un error se corrige con un ajuste nuevo, no editando el pago."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'benefits';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'benefits'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'benefits no tiene precio en los 3 tiers';
  end if;
end $$;
