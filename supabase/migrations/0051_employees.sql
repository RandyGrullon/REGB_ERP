-- ═══════════════════════════════════════════════════════════════════════
--  0051 — Empleados (modulo 61, F7/S36)
--
--  Expediente, contratos, organigrama e historial. Puerta de entrada a
--  toda la fase de RRHH: `payroll` (62, S37-38) todavia es solo un
--  manifest sin esquema -este modulo es lo primero que necesita antes de
--  poder calcular una nomina de verdad-.
--
--  El organigrama NO es una tabla: se arma con buildOrgChart()
--  (@regb/operations) a partir de `manager_id`, mismo principio que el
--  mayor de accounting se deriva de las lineas de asientos.
--
--  Documentos (la palabra que usa el catalogo) se deja para cuando este
--  modulo integre con `files` (11, ya construido) -adjuntar un
--  documento a un empleado es una relacion polimorfica que ese modulo ya
--  resuelve, reimplementarla aqui seria duplicar trabajo-.
-- ═══════════════════════════════════════════════════════════════════════

create table public.employees (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references regb.tenants(id) on delete cascade,
  code              text not null,
  first_name        text not null,
  last_name         text not null,
  national_id       text,
  birth_date        date,
  hire_date         date not null,
  position          text not null,
  department        text,
  branch_id         uuid references public.branches(id),
  manager_id        uuid references public.employees(id),
  salary            numeric(12,2) not null check (salary >= 0),
  status            text not null default 'active'
                      check (status in ('active', 'on_leave', 'terminated')),
  termination_date  date,
  termination_reason text,
  email             text,
  phone             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, national_id),
  check (manager_id is null or manager_id <> id),
  check (status <> 'terminated' or (termination_date is not null and termination_reason is not null)),
  check (status = 'terminated' or (termination_date is null and termination_reason is null))
);

create index on public.employees (tenant_id, status);
create index on public.employees (tenant_id, manager_id);

comment on column public.employees.manager_id is
  'Auto-referencia para el organigrama. El arbol se arma en @regb/operations (buildOrgChart), no en SQL: una jerarquia con un ciclo -dato sucio- no debe tumbar una consulta.';

create table public.employee_contracts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  employee_id   uuid not null references public.employees(id),
  contract_type text not null check (contract_type in ('indefinido', 'determinado', 'por_obra')),
  start_date    date not null,
  end_date      date,
  salary        numeric(12,2) not null check (salary >= 0),
  position      text not null,
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create index on public.employee_contracts (tenant_id, employee_id, start_date desc);

comment on table public.employee_contracts is
  'Historial de contratos: una promocion o un cambio de salario no edita el contrato anterior, crea uno nuevo y marca el previo is_active=false -mismo espiritu que un revaluo de activo fijo (0046), que tampoco sobreescribe el anterior-.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('employees',          'employees'),
      ('employee_contracts', 'employees')
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

-- El mismo agujero de siempre (0031/0040/accounting/ap/treasury/bank-rec/
-- fixed-assets/budgets/cost-centers/payments), tapado desde el primer
-- dia: la RLS de insert solo compara el tenant_id de la fila nueva, no a
-- quien pertenecen branch_id ni manager_id.
create function public.impedir_referencia_ajena_empleado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.branch_id is not null then
    select tenant_id into v_tenant from public.branches where id = new.branch_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Esa sucursal no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;

  if new.manager_id is not null then
    select tenant_id into v_tenant from public.employees where id = new.manager_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Ese jefe no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena before insert or update on public.employees
  for each row execute function public.impedir_referencia_ajena_empleado();

create function public.impedir_contrato_ajeno() returns trigger
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

create trigger no_contrato_ajeno before insert on public.employee_contracts
  for each row execute function public.impedir_contrato_ajeno();

-- ── Un nuevo contrato desactiva el anterior, no lo edita ─────────────────
create function public.crear_contrato_empleado(
  p_employee uuid, p_contract_type text, p_start_date date, p_salary numeric, p_position text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_nuevo  uuid;
begin
  select tenant_id into v_tenant from public.employees where id = p_employee for update;
  if not found then
    raise exception 'Ese empleado no existe.' using errcode = 'P0002';
  end if;
  if v_tenant is distinct from rls.tenant_id() then
    raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  update public.employee_contracts
  set is_active = false
  where employee_id = p_employee and is_active;

  insert into public.employee_contracts
    (tenant_id, employee_id, contract_type, start_date, salary, position)
  values (v_tenant, p_employee, p_contract_type, p_start_date, p_salary, p_position)
  returning id into v_nuevo;

  update public.employees
  set salary = p_salary, position = p_position, updated_at = now()
  where id = p_employee;

  return v_nuevo;
end;
$$;

revoke all on function public.crear_contrato_empleado(uuid, text, date, numeric, text) from public;
grant execute on function public.crear_contrato_empleado(uuid, text, date, numeric, text) to authenticated;

comment on function public.crear_contrato_empleado(uuid, text, date, numeric, text) is
  'Registra un contrato nuevo -promocion, cambio de salario- y desactiva el anterior sin editarlo. Tambien actualiza el salario/cargo vigente en employees para que no haya que unir con el ultimo contrato en cada consulta.';

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.employees
  for each row execute function audit.record('employees');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{}',
    recommends   = '{payroll}',
    tagline      = 'El expediente de cada empleado, su historial y a quien le reporta',
    problem      = 'Los datos de cada empleado -su salario, su cargo, desde cuando trabaja, quien es su jefe- viven repartidos entre una carpeta fisica, un Excel y la memoria de recursos humanos, y cuando alguien pregunta "cuanto anos tiene aqui" o "quien le reporta a quien" no hay una respuesta rapida.',
    features     = '[
      {"titulo":"Expediente completo","detalle":"Cargo, departamento, sucursal, salario, fecha de ingreso y contacto en un solo lugar por empleado."},
      {"titulo":"Historial de contratos, no un solo salario","detalle":"Cada promocion o cambio de salario queda registrado con su fecha -nunca se sobreescribe el contrato anterior, se crea uno nuevo-."},
      {"titulo":"Organigrama que se arma solo","detalle":"A partir de quien le reporta a quien, sin tener que dibujarlo aparte -y un dato sucio (un ciclo de jefes) no rompe el reporte, solo se ve raro-."},
      {"titulo":"Antiguedad calculada, no contada a mano","detalle":"Anos y dias completos de servicio, la base que nomina va a necesitar el dia que calcule prestaciones laborales."}
    ]'::jsonb,
    audience     = '{"Negocios con mas de 5 empleados","Cualquiera que planee activar nomina","Negocios con varias sucursales o departamentos"}',
    faq          = '[
      {"p":"¿Necesito nomina para usarlo?","r":"No. Empleados funciona solo como expediente y organigrama. Cuando actives nomina -todavia en construccion-, va a usar estos mismos registros para calcular."},
      {"p":"¿Puedo adjuntar documentos del empleado -cedula, contrato firmado?","r":"Todavia no desde aqui: esa pieza se integra con el gestor documental (modulo files), y esta version no la construye todavia."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'employees';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'employees'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'employees no tiene precio en los 3 tiers';
  end if;
end $$;
