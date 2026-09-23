-- ═══════════════════════════════════════════════════════════════════════
--  0132 — Nomina: el volante es de quien es, un dia se paga una sola vez,
--         y las tasas viven en una tabla
--
--  ── Los hallazgos (analisis de flujo del 23-sep-2026, hallazgo 10) ────
--
--  1. PRIVACIDAD. El portal emparejaba cuenta y expediente por CORREO
--     (`user_profiles.email = employees.email`), sin unicidad. En la demo,
--     Maria Rosario abria /portal y veia el expediente, el salario y el
--     volante de Rafael Encarnacion. Las dos funciones del telefono
--     (`pedir_vacaciones`, `reportar_gasto`) resolvian "quien soy" igual:
--     con un correo repetido se pedian vacaciones a nombre de otro.
--
--  2. DOBLE PAGO. Los periodos solo tenian `unique (tenant, inicio, fin)`:
--     1-30 y 16-30 de septiembre convivian, y cada uno pagaba el salario
--     mensual completo.
--
--  3. UN SOLO TOPE DE TSS (415,492) para AFP y SFS juntos, escrito en el
--     codigo. La ley pone topes distintos -SFS 10 salarios minimos
--     cotizables, AFP 20- y la TSS los actualiza por resolucion.
--
--  ── Lo que cambia ─────────────────────────────────────────────────────
--
--  1. `employees.user_id`: vinculo EXPLICITO, unico por cliente, con la
--     guarda de cliente en la propia llave -(tenant_id, user_id) apunta a
--     `memberships`-. Solo lo escribe RRHH con `vincular_empleado_usuario()`;
--     un token no puede escribir la columna directo (si pudiera, alguien
--     con employees.view se vincularia al expediente del gerente y leeria
--     su volante por la rama "lo mio" de la RLS). Sin vinculo, el portal
--     lo dice: no se adivina por correo. NO se rellena desde el correo: el
--     correo es justo lo que emparejaba mal.
--
--  2. `payroll_lines.period_range` + restriccion de EXCLUSION por
--     (cliente, empleado, rango): dos lineas del mismo empleado en
--     periodos que se cruzan no pueden existir, venga de donde venga el
--     insert. Es POR EMPLEADO a proposito: el que se cobra dos veces es
--     una persona, no un periodo.
--
--  3. `payroll_tax_params`: una fila por vigencia con el salario minimo
--     cotizable, los multiplos de tope de SFS y AFP, las tasas del
--     empleado y la escala de ISR, cada una con su fuente.
--
--  4. RLS de la nomina: leer la linea sigue exigiendo payroll.view; el
--     empleado lee SUS volantes con `mis_volantes()`, por el token.
--     Escribir linea o periodo exige payroll.run (antes bastaba
--     payroll.view para insertar una linea por PostgREST), y borrar
--     tambien, por trigger. Mismo patron que 0127.
--
--  5. Lo que se le asigna a una nomina (un reembolso, un pago de
--     prestamo) solo puede apuntar a un periodo en borrador: apuntar a uno
--     ya procesado es darlo por pagado sin que nadie lo pague.
--
--  Sin archivo de reversa, como las anteriores: el repo no los usa.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  1. Vinculo cuenta ↔ expediente
-- ═══════════════════════════════════════════════════════════════════════
alter table public.employees add column user_id uuid;

alter table public.employees
  add constraint employees_tenant_user_key unique (tenant_id, user_id);

-- La guarda de cliente va EN la llave: (tenant_id, user_id) tiene que ser
-- una membresia de ESTE cliente. Si la persona sale del equipo (se borra
-- su membresia), el expediente queda sin vinculo, no apuntando a nadie.
alter table public.employees
  add constraint employees_user_es_del_equipo
  foreign key (tenant_id, user_id) references public.memberships (tenant_id, user_id)
  on delete set null (user_id);

comment on column public.employees.user_id is
  'La cuenta que ve ESTE expediente en el portal. Lo asigna RRHH con vincular_empleado_usuario(); un token no puede escribirlo directo (0132). Nunca se deduce del correo.';

-- ── Un token no escribe el vinculo directo ──────────────────────────────
--  NO es security definer a proposito: `current_user` tiene que ser quien
--  ejecuta la sentencia. Dentro de vincular_empleado_usuario() -que si lo
--  es- current_user es el dueño y pasa; por PostgREST o desde la app es
--  `authenticated` y no.
create function public.impedir_vinculo_directo() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.user_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id then
    return new;
  end if;
  if current_user in ('authenticated', 'anon') then
    raise exception 'El vinculo con una cuenta lo asigna RRHH con vincular_empleado_usuario().'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_vinculo_directo
  before insert or update of user_id on public.employees
  for each row execute function public.impedir_vinculo_directo();

-- ── Quien soy yo, en este cliente ───────────────────────────────────────
--  Security definer: el rol Empleado no tiene employees.view (0109) y aun
--  asi tiene que saber cual es SU expediente.
create function rls.mi_empleado() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.employees e
  where e.tenant_id = rls.tenant_id() and e.user_id = rls.regb_uid()
$$;

comment on function rls.mi_empleado() is
  'El expediente vinculado a la cuenta del token en este cliente, o null. Por employees.user_id (0132), nunca por correo.';

revoke all on function rls.mi_empleado() from public;
grant execute on function rls.mi_empleado() to authenticated;

-- ── RRHH asigna el vinculo ──────────────────────────────────────────────
create function public.vincular_empleado_usuario(p_empleado uuid, p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := rls.tenant_id();
  v_actual uuid;
  v_otro   text;
begin
  if v_tenant is null then
    raise exception 'Sesion sin cliente.' using errcode = '28000';
  end if;
  if not rls.module_active('employees') then
    raise exception 'El modulo de empleados no esta activo.' using errcode = '42501';
  end if;
  if not rls.has_perm('employees.employee.link') then
    raise exception 'Tu rol no permite vincular cuentas con expedientes.' using errcode = '42501';
  end if;

  select e.user_id into v_actual
  from public.employees e
  where e.id = p_empleado and e.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  if p_usuario is not null then
    if not exists (
      select 1 from public.memberships m
      where m.tenant_id = v_tenant and m.user_id = p_usuario
    ) then
      raise exception 'Esa persona no es parte de tu equipo.' using errcode = '42501';
    end if;

    select e.first_name || ' ' || e.last_name into v_otro
    from public.employees e
    where e.tenant_id = v_tenant and e.user_id = p_usuario and e.id <> p_empleado;
    if found then
      raise exception 'Esa cuenta ya esta vinculada al expediente de %. Quitala de ahi primero.', v_otro
        using errcode = '23505';
    end if;
  end if;

  if v_actual is not distinct from p_usuario then
    return;
  end if;

  update public.employees
  set user_id = p_usuario, updated_at = now()
  where id = p_empleado;

  perform public.emit_event(
    'employees.employee.user-linked',
    jsonb_build_object('employee_id', p_empleado, 'linked', p_usuario is not null),
    'employees');
end;
$$;

comment on function public.vincular_empleado_usuario(uuid, uuid) is
  'Vincula (o con null, desvincula) la cuenta que ve un expediente en el portal. Exige employees.employee.link; la cuenta tiene que ser del equipo de este cliente y no estar ya en otro expediente (0132).';

revoke all on function public.vincular_empleado_usuario(uuid, uuid) from public;
grant execute on function public.vincular_empleado_usuario(uuid, uuid) to authenticated;

-- ── Lo que el portal lee: MI expediente, MIS volantes ──────────────────
--  El portal ya no consulta las tablas con un filtro de la app: pregunta
--  por el token. Asi, aunque la web corre sin role_id (has_perm devuelve
--  true), no hay forma de que una pantalla del portal traiga otra fila.
create function public.mi_expediente()
returns table (
  id          uuid,
  code        text,
  first_name  text,
  last_name   text,
  "position"  text,
  department  text,
  hire_date   date,
  phone       text,
  email       text,
  status      text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.code, e.first_name, e.last_name, e.position, e.department,
         e.hire_date, e.phone, e.email, e.status
  from public.employees e
  where e.tenant_id = rls.tenant_id()
    and e.user_id = rls.regb_uid()
    and e.status <> 'terminated'
    and rls.module_active('hr-portal')
$$;

comment on function public.mi_expediente() is
  'El expediente de quien mira, por el vinculo explicito (0132). Vacio si no hay vinculo: el portal lo dice, no adivina.';

revoke all on function public.mi_expediente() from public;
grant execute on function public.mi_expediente() to authenticated;

-- El unico dato que el empleado edita de SU expediente. Por el token: con
-- el rol real en los claims (asUser, 0127) el rol Empleado no tiene
-- employees.view y la RLS de employees no le deja tocar la tabla -ni
-- deberia: con ese permiso podria editar cualquier expediente-.
create function public.editar_mi_telefono(p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp uuid := rls.mi_empleado();
begin
  if not rls.module_active('hr-portal') then
    raise exception 'El portal del empleado no esta activo.' using errcode = '42501';
  end if;
  if not rls.has_perm('hr-portal.edit-profile') then
    raise exception 'Tu rol no permite editar tus datos en el portal.' using errcode = '42501';
  end if;
  if v_emp is null then
    raise exception 'Tu cuenta no esta vinculada a ningun expediente. Pide a RRHH que la vincule desde Empleados.'
      using errcode = '42501';
  end if;
  if length(coalesce(p_phone, '')) > 40 then
    raise exception 'Ese telefono es demasiado largo.' using errcode = '22023';
  end if;

  update public.employees
  set phone = nullif(trim(coalesce(p_phone, '')), ''), updated_at = now()
  where id = v_emp and status <> 'terminated';
end;
$$;

comment on function public.editar_mi_telefono(text) is
  'El empleado cambia el telefono de SU expediente -el vinculado a su cuenta (0132)-. Nunca el de otro: no recibe ningun id.';

revoke all on function public.editar_mi_telefono(text) from public;
grant execute on function public.editar_mi_telefono(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  2. Lineas de nomina: dias pagados, reembolsos y el rango del periodo
-- ═══════════════════════════════════════════════════════════════════════
alter table public.payroll_lines
  add column paid_days      numeric(5,2) check (paid_days is null or paid_days >= 0),
  add column reimbursements numeric(12,2) not null default 0 check (reimbursements >= 0),
  add column period_range   daterange;

comment on column public.payroll_lines.paid_days is
  'Dias comerciales pagados (mes = 30, quincena = 15). Null en lineas anteriores a 0132.';
comment on column public.payroll_lines.reimbursements is
  'Reembolsos de gastos pagados en esta linea: suman al neto, no son base de TSS ni de ISR.';
comment on column public.payroll_lines.period_range is
  'Copia del rango del periodo, para la restriccion de exclusion por empleado. La mantiene un trigger: nunca se escribe a mano.';

-- Relleno de las lineas que ya existen. Casi todas son de periodos
-- procesados, que no se editan (0052): se aparta el trigger SOLO para
-- copiar el rango -no cambia ningun monto- y se vuelve a poner.
alter table public.payroll_lines disable trigger no_editar_linea_procesada;
update public.payroll_lines l
set period_range = daterange(p.period_start, p.period_end, '[]')
from public.payroll_periods p
where p.id = l.period_id;
alter table public.payroll_lines enable trigger no_editar_linea_procesada;

alter table public.payroll_lines alter column period_range set not null;

-- El neto cuadra con sus partes. NOT VALID: las lineas anteriores no se
-- revisan (un periodo procesado no se reescribe); todas las nuevas si.
alter table public.payroll_lines
  add constraint payroll_lines_neto_cuadra
  check (net_salary = gross_salary + reimbursements - tss_deduction - income_tax - other_deductions)
  not valid;

-- ── El rango lo pone la base ────────────────────────────────────────────
--  Nombre con "fijar_": los BEFORE corren en orden alfabetico y este va
--  antes de las guardas de cliente (no_*). Si el periodo es de otro
--  cliente, la guarda de 0121 lo rechaza igual un paso despues.
create function public.fijar_rango_del_periodo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select daterange(p.period_start, p.period_end, '[]') into new.period_range
  from public.payroll_periods p
  where p.id = new.period_id;
  if new.period_range is null then
    raise exception 'Ese periodo de nomina no existe.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger fijar_rango_del_periodo
  before insert or update of period_id, period_range on public.payroll_lines
  for each row execute function public.fijar_rango_del_periodo();

-- Si un borrador cambia de fechas, sus lineas se mueven con el. Un periodo
-- procesado no cambia de fechas (0052), asi que esto solo toca borradores.
create function public.mover_rango_de_las_lineas() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payroll_lines
  set period_range = daterange(new.period_start, new.period_end, '[]')
  where period_id = new.id;
  return new;
end;
$$;

create trigger mover_rango_de_las_lineas
  after update of period_start, period_end on public.payroll_periods
  for each row execute function public.mover_rango_de_las_lineas();

-- ── Un dia se paga una sola vez, por empleado ───────────────────────────
--  Exclusion y no un trigger: dos procesos a la vez no pueden colarse
--  entre la comprobacion y el insert. btree_gist hace falta para el `=`
--  sobre uuid dentro de un indice gist. En Supabase el esquema
--  `extensions` ya existe; en el Postgres local de pruebas se crea.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- Si una base ya tiene lineas cruzadas (se pudo: era el hallazgo), la
-- migracion para aqui y dice cuales, en vez de fallar con un mensaje de
-- indice. Esas lineas son de periodos procesados e inmutables: se
-- corrigen con un ajuste, decidido por una persona.
do $$
declare
  v_cruces text;
begin
  select string_agg(format('empleado %s: %s y %s', a.employee_id, a.period_range, b.period_range), '; ')
  into v_cruces
  from public.payroll_lines a
  join public.payroll_lines b
    on b.tenant_id = a.tenant_id and b.employee_id = a.employee_id
   and b.id > a.id and b.period_range && a.period_range;
  if v_cruces is not null then
    raise exception 'Hay lineas de nomina que pagan dos veces los mismos dias: %', v_cruces;
  end if;
end $$;

alter table public.payroll_lines
  add constraint payroll_lines_un_dia_se_paga_una_vez
  exclude using gist (tenant_id with =, employee_id with =, period_range with &&);

-- ═══════════════════════════════════════════════════════════════════════
--  3. RLS de la nomina: ver no es escribir, y lo mio es lo mio
-- ═══════════════════════════════════════════════════════════════════════
--  Mismo patron que 0127 (memberships/roles): la lectura se queda como
--  estaba -la linea con payroll.view, el periodo con el modulo- y la
--  escritura exige ademas payroll.run en WITH CHECK, para que un intento
--  sin permiso salga 42501 y no "0 filas". Borrar lo mira un trigger: un
--  has_perm en el USING de un delete seria "0 filas" en silencio, y el
--  respaldo (0122) exige que todo has_perm de un USING sea el .view del
--  modulo.
--
--  "Lo mio" NO entra a la politica de la tabla: el respaldo deriva de sus
--  politicas quien ve que, y una condicion que no conoce la haria mentir.
--  El empleado lee SUS volantes con `mis_volantes()` (abajo), que resuelve
--  por el token; directo a la tabla, sin payroll.view, no lee ninguno -ni
--  el suyo ni el de otro-.
drop policy if exists tenant_module on public.payroll_lines;
create policy tenant_module on public.payroll_lines for select
  using (tenant_id = rls.tenant_id() and rls.module_active('payroll')
         and rls.has_perm('payroll.view'));
create policy escribir_con_run on public.payroll_lines for insert
  with check (tenant_id = rls.tenant_id() and rls.module_active('payroll')
              and rls.has_perm('payroll.run'));
create policy editar_con_run on public.payroll_lines for update
  using      (tenant_id = rls.tenant_id() and rls.module_active('payroll'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('payroll')
              and rls.has_perm('payroll.run'));
create policy borrar_con_run on public.payroll_lines for delete
  using (tenant_id = rls.tenant_id() and rls.module_active('payroll'));

drop policy if exists tenant_module on public.payroll_periods;
create policy tenant_module on public.payroll_periods for select
  using (tenant_id = rls.tenant_id() and rls.module_active('payroll'));
create policy escribir_con_run on public.payroll_periods for insert
  with check (tenant_id = rls.tenant_id() and rls.module_active('payroll')
              and rls.has_perm('payroll.run'));
create policy editar_con_run on public.payroll_periods for update
  using      (tenant_id = rls.tenant_id() and rls.module_active('payroll'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('payroll')
              and rls.has_perm('payroll.run'));
create policy borrar_con_run on public.payroll_periods for delete
  using (tenant_id = rls.tenant_id() and rls.module_active('payroll'));

-- Borrar un borrador (o sus lineas) tambien pide payroll.run. Solo se mira
-- a quien llega con token (`authenticated`): el dueño -borrar un cliente en
-- cascada, el seed, las pruebas- no trae claims y rls.role_id() (0109) no
-- sabe leer unos claims vacios. No es security definer, para que
-- current_user sea quien ejecuta.
create function public.exigir_payroll_run_al_borrar() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and not rls.has_perm('payroll.run') then
    raise exception 'Tu rol no permite borrar en la nomina (payroll.run).' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger exigir_payroll_run_al_borrar
  before delete on public.payroll_lines
  for each row execute function public.exigir_payroll_run_al_borrar();
create trigger exigir_payroll_run_al_borrar
  before delete on public.payroll_periods
  for each row execute function public.exigir_payroll_run_al_borrar();

-- ── MIS volantes, para el portal y el telefono ──────────────────────────
create function public.mis_volantes(p_limite integer default 12)
returns table (
  period_id        uuid,
  period_start     date,
  period_end       date,
  pay_date         date,
  paid_days        numeric,
  gross_salary     numeric,
  reimbursements   numeric,
  tss_deduction    numeric,
  income_tax       numeric,
  other_deductions numeric,
  net_salary       numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select pp.id, pp.period_start, pp.period_end, pp.pay_date, pl.paid_days,
         pl.gross_salary, pl.reimbursements, pl.tss_deduction, pl.income_tax,
         pl.other_deductions, pl.net_salary
  from public.payroll_lines pl
  join public.payroll_periods pp on pp.id = pl.period_id
  where pl.tenant_id = rls.tenant_id()
    and pl.employee_id = rls.mi_empleado()
    and pp.status <> 'draft'
    and rls.module_active('payroll')
    and rls.module_active('hr-portal')
  order by pp.period_end desc
  limit least(greatest(coalesce(p_limite, 12), 1), 60)
$$;

comment on function public.mis_volantes(integer) is
  'Los volantes ya procesados de quien mira, por el vinculo explicito (0132). Nunca los de otro, ni con el mismo correo.';

revoke all on function public.mis_volantes(integer) from public;
grant execute on function public.mis_volantes(integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  4. Las funciones del telefono resuelven "quien soy" por el vinculo
-- ═══════════════════════════════════════════════════════════════════════
--  Mismo cuerpo que 0114; solo cambia la busqueda del empleado. Misma
--  firma: `create or replace` conserva los permisos.
create or replace function public.reportar_gasto(
  p_categoria   text,
  p_fecha       date,
  p_monto       numeric,
  p_proveedor   text default null,
  p_rnc         text default null,
  p_ncf         text default null,
  p_nota        text default null,
  p_ref         uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := rls.tenant_id();
  v_uid    uuid := rls.regb_uid();
  v_emp    uuid;
  v_id     uuid;
begin
  if v_tenant is null or v_uid is null then
    raise exception 'Sesion no valida.' using errcode = '28000';
  end if;

  if not rls.module_active('expenses') then
    raise exception 'El modulo de gastos no esta activo.' using errcode = '42501';
  end if;

  if not rls.has_perm('expenses.submit') then
    raise exception 'Tu rol no permite reportar gastos.' using errcode = '42501';
  end if;

  if p_ref is not null and exists (
    select 1 from public.expenses where id = p_ref and tenant_id = v_tenant
  ) then
    return p_ref;
  end if;

  -- QUIEN reporta sale del token, por el vinculo que asigno RRHH (0132).
  select e.id into v_emp
  from public.employees e
  where e.tenant_id = v_tenant and e.user_id = v_uid and e.status = 'active';

  if v_emp is null then
    raise exception 'No encontramos un expediente vinculado a tu cuenta. Pide a RRHH que lo vincule.'
      using errcode = '42501';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor que cero.' using errcode = '22023';
  end if;

  if p_fecha is null or p_fecha > current_date then
    raise exception 'La fecha del gasto no puede ser del futuro.' using errcode = '22023';
  end if;

  v_id := coalesce(p_ref, gen_random_uuid());

  begin
    insert into public.expenses
      (id, tenant_id, employee_id, category, expense_date, amount,
       vendor_name, vendor_tax_id, ncf, receipt_note, status)
    values (
      v_id, v_tenant, v_emp, p_categoria, p_fecha, p_monto,
      nullif(trim(coalesce(p_proveedor, '')), ''),
      nullif(regexp_replace(coalesce(p_rnc, ''), '[^0-9]', '', 'g'), ''),
      nullif(upper(trim(coalesce(p_ncf, ''))), ''),
      nullif(trim(coalesce(p_nota, '')), ''),
      'submitted'
    );
  exception when unique_violation then
    if p_ref is not null and exists (
      select 1 from public.expenses where id = p_ref and tenant_id = v_tenant
    ) then
      return p_ref;
    end if;
    raise;
  end;

  return v_id;
end;
$$;

create or replace function public.pedir_vacaciones(
  p_inicio date,
  p_fin    date,
  p_tipo   text default 'vacation',
  p_motivo text default null,
  p_ref    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := rls.tenant_id();
  v_uid    uuid := rls.regb_uid();
  v_emp    uuid;
  v_dias   integer;
  v_id     uuid;
begin
  if v_tenant is null or v_uid is null then
    raise exception 'Sesion no valida.' using errcode = '28000';
  end if;

  if not rls.module_active('time-off') then
    raise exception 'El modulo de vacaciones no esta activo.' using errcode = '42501';
  end if;

  if p_ref is not null and exists (
    select 1 from public.time_off_requests where id = p_ref and tenant_id = v_tenant
  ) then
    return p_ref;
  end if;

  -- QUIEN pide sale del token, por el vinculo que asigno RRHH (0132).
  select e.id into v_emp
  from public.employees e
  where e.tenant_id = v_tenant and e.user_id = v_uid and e.status = 'active';

  if v_emp is null then
    raise exception 'No encontramos un expediente vinculado a tu cuenta. Pide a RRHH que lo vincule.'
      using errcode = '42501';
  end if;

  if p_fin < p_inicio then
    raise exception 'La fecha de fin no puede ser antes que la de inicio.'
      using errcode = '22023';
  end if;

  v_dias := public.dias_laborables(p_inicio, p_fin);
  if v_dias = 0 then
    raise exception 'El rango elegido no incluye ningun dia laborable.'
      using errcode = '22023';
  end if;

  v_id := coalesce(p_ref, gen_random_uuid());

  begin
    insert into public.time_off_requests
      (id, tenant_id, employee_id, leave_type, start_date, end_date, business_days, reason)
    values (v_id, v_tenant, v_emp, p_tipo, p_inicio, p_fin, v_dias,
            nullif(trim(coalesce(p_motivo, '')), ''));
  exception when unique_violation then
    if p_ref is not null and exists (
      select 1 from public.time_off_requests where id = p_ref and tenant_id = v_tenant
    ) then
      return p_ref;
    end if;
    raise;
  end;

  return v_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  5. Parametros de TSS e ISR: una fila por vigencia
-- ═══════════════════════════════════════════════════════════════════════
--  Catalogo GLOBAL, como `currencies` (0049): la ley es la misma para
--  todos los clientes. Cualquiera autenticado la lee; nadie con token la
--  escribe (no hay politica de escritura): una fila nueva entra por
--  migracion, con su fuente.
create table public.payroll_tax_params (
  valid_from             date primary key,
  min_contribution_wage  numeric(12,2) not null check (min_contribution_wage > 0),
  sfs_cap_multiple       numeric(5,2)  not null check (sfs_cap_multiple > 0),
  afp_cap_multiple       numeric(5,2)  not null check (afp_cap_multiple > 0),
  sfs_employee_rate      numeric(6,5)  not null check (sfs_employee_rate between 0 and 1),
  afp_employee_rate      numeric(6,5)  not null check (afp_employee_rate between 0 and 1),
  income_tax_brackets    jsonb         not null check (jsonb_typeof(income_tax_brackets) = 'array'
                                                     and jsonb_array_length(income_tax_brackets) > 0),
  source                 text          not null check (length(source) > 10),
  verified               boolean       not null default false,
  notes                  text,
  created_at             timestamptz   not null default now()
);

comment on table public.payroll_tax_params is
  'Tasas y topes de TSS (empleado) y escala de ISR por vigencia. Catalogo global. Los topes son multiplos del salario minimo cotizable que publica la TSS por resolucion: SFS 10, AFP (SVDS) 20. verified = todos los valores de la fila confirmados contra la fuente oficial citada.';
comment on column public.payroll_tax_params.min_contribution_wage is
  'Salario minimo nacional que la TSS usa para los topes de cotizacion (RD$/mes).';

alter table public.payroll_tax_params enable row level security;
alter table public.payroll_tax_params force row level security;
create policy lectura_publica on public.payroll_tax_params for select
  to authenticated using (true);

revoke insert, update, delete on public.payroll_tax_params from authenticated, anon;

-- Escala de ISR asalariados (Ley 11-92 art. 296). La de 2026 la confirma
-- la DGII ("CA687 ¿Cual es la escala salarial correspondiente al ano 2026
-- del ISR?", ayuda.dgii.gov.do); la Ley 30-26 art. 10 la cambia a partir
-- del ejercicio 2027: esa escala necesita su propia fila cuando se publique.
insert into public.payroll_tax_params
  (valid_from, min_contribution_wage, sfs_cap_multiple, afp_cap_multiple,
   sfs_employee_rate, afp_employee_rate, income_tax_brackets, source, verified, notes)
values
  ('2024-02-01', 19352.50, 10, 20, 0.03040, 0.02870,
   '[{"from":0,"to":416220,"rate":0,"baseAmount":0},
     {"from":416220,"to":624329,"rate":0.15,"baseAmount":0},
     {"from":624329,"to":867123,"rate":0.20,"baseAmount":31216},
     {"from":867123,"to":null,"rate":0.25,"baseAmount":79776}]'::jsonb,
   'TSS Resolucion 01-2024, vigente 1-feb-2024 (tss.gob.do, "TSS fija nuevos topes de cotizacion del regimen contributivo"): salario minimo 19,352.50; SFS 193,525.00; SVDS 387,050.00; SRL 77,410.00.',
   false,
   'POR CONFIRMAR: la escala de ISR de 2024. Se cargo la de 2026, que la DGII mantuvo sin ajuste por inflacion.'),
  ('2025-04-01', 21674.80, 10, 20, 0.03040, 0.02870,
   '[{"from":0,"to":416220,"rate":0,"baseAmount":0},
     {"from":416220,"to":624329,"rate":0.15,"baseAmount":0},
     {"from":624329,"to":867123,"rate":0.20,"baseAmount":31216},
     {"from":867123,"to":null,"rate":0.25,"baseAmount":79776}]'::jsonb,
   'TSS Resolucion 01-2025, primer tramo, vigente 1-abr-2025 (presidencia.gob.do, 3-abr-2025, "Tesoreria de la Seguridad Social informa nuevos topes de cotizacion"): salario minimo 21,674.80; SFS 216,748.00; SVDS 433,496.00; SRL 86,699.20.',
   false,
   'POR CONFIRMAR: la escala de ISR de 2025. Se cargo la de 2026, que la DGII mantuvo sin ajuste por inflacion.'),
  ('2026-02-01', 23223.00, 10, 20, 0.03040, 0.02870,
   '[{"from":0,"to":416220,"rate":0,"baseAmount":0},
     {"from":416220,"to":624329,"rate":0.15,"baseAmount":0},
     {"from":624329,"to":867123,"rate":0.20,"baseAmount":31216},
     {"from":867123,"to":null,"rate":0.25,"baseAmount":79776}]'::jsonb,
   'TSS Resolucion 01-2025, segundo tramo, vigente 1-feb-2026: salario minimo 23,223.00; SFS 232,230.00; SVDS 464,460.00; SRL 92,892.00 (presidencia.gob.do, 3-abr-2025). Tasas del empleado SFS 3.04% y AFP 2.87%. ISR: escala DGII 2026 (CA687).',
   true,
   'Los topes de SRL no se usan: el SRL lo paga solo el empleador, y los aportes patronales todavia no se calculan.')
on conflict (valid_from) do nothing;

-- La fila vigente para una fecha. La nomina la pide con el fin del periodo.
create function public.parametros_nomina(p_fecha date)
returns setof public.payroll_tax_params
language sql
stable
security invoker
set search_path = ''
as $$
  select * from public.payroll_tax_params
  where valid_from <= p_fecha
  order by valid_from desc
  limit 1
$$;

comment on function public.parametros_nomina(date) is
  'Los parametros de TSS e ISR vigentes en una fecha (0132). Sin fila, la nomina no se procesa: no se inventan tasas.';

revoke all on function public.parametros_nomina(date) from public;
grant execute on function public.parametros_nomina(date) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  6. Nada se le cuelga a una nomina ya procesada
-- ═══════════════════════════════════════════════════════════════════════
--  Un reembolso "por nomina" o un pago de prestamo "por nomina" que
--  apunta a un periodo ya procesado queda como pagado y nadie lo paga:
--  esa nomina ya no cambia. Solo se permite apuntar a un borrador.
--  Si el periodo es de otro cliente, esta funcion no dice nada -la guarda
--  de cliente de cada tabla da su propio mensaje-.
create function public.impedir_apuntar_a_nomina_cerrada() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.payroll_period_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.payroll_period_id is not distinct from old.payroll_period_id then
    return new;
  end if;

  select p.status into v_status
  from public.payroll_periods p
  where p.id = new.payroll_period_id and p.tenant_id = new.tenant_id;

  if v_status is not null and v_status <> 'draft' then
    raise exception 'Esa nomina ya se proceso: lo que se le asigne ya no se paga en ella. Elige un periodo en borrador.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger no_nomina_cerrada
  before insert or update of payroll_period_id on public.expenses
  for each row execute function public.impedir_apuntar_a_nomina_cerrada();

create trigger no_nomina_cerrada
  before insert on public.benefit_loan_payments
  for each row execute function public.impedir_apuntar_a_nomina_cerrada();

-- ═══════════════════════════════════════════════════════════════════════
--  7. Catalogo: permisos reales de los manifiestos y lo que se promete
-- ═══════════════════════════════════════════════════════════════════════
--  employees y hr-portal tenian el juego generico de 0010 (create/edit/
--  delete), que no existe en sus manifiestos: el editor de roles ofrecia
--  permisos que nadie mira y no ofrecia los reales.
update regb.module_catalog set permissions = array[
  'employees.view', 'employees.employee.create', 'employees.contract.create',
  'employees.employee.terminate', 'employees.employee.link', 'employees.export'
] where id = 'employees';

update regb.module_catalog set permissions = array[
  'hr-portal.view', 'hr-portal.request-time-off', 'hr-portal.edit-profile',
  'hr-portal.manage-announcements'
] where id = 'hr-portal';

update regb.module_catalog
set features = '[
      {"titulo":"Tu expediente, no el de todos","detalle":"RRHH vincula tu cuenta con tu expediente. Sin ese vinculo el portal te lo dice; nunca te muestra el de otra persona, aunque tengan el mismo correo."},
      {"titulo":"Tus volantes de siempre","detalle":"Los mismos numeros ya calculados y fijados por payroll: dias pagados, reembolsos y descuentos incluidos. El portal no recalcula nada."},
      {"titulo":"Tu saldo de vacaciones real","detalle":"El mismo calculo del Codigo de Trabajo Art. 177 que usa time-off, y puedes pedir tus propios dias desde aqui."},
      {"titulo":"Anuncios de la empresa","detalle":"Lo que RRHH publica, todos lo ven, sin cadenas de correo."}
    ]'::jsonb,
    faq = '[
      {"p":"¿Cualquiera puede ver el expediente de otro empleado?","r":"No. El portal muestra solo el expediente que RRHH vinculo a tu cuenta, y la base de datos lo exige tambien: aunque alguien use su token directo, solo lee sus propios volantes."},
      {"p":"¿Recalcula el volante o el saldo de vacaciones?","r":"No: muestra los mismos numeros ya calculados por payroll y time-off. El portal es una ventana, no un motor de calculo aparte."}
    ]'::jsonb
where id = 'hr-portal';

update regb.module_catalog
set features = '[
      {"titulo":"TSS e ISR calculados, no adivinados","detalle":"SFS y AFP cada uno con su tope (10 y 20 salarios minimos cotizables) e ISR con la escala progresiva, sacados de una tabla por vigencia con su fuente, no escritos en el codigo."},
      {"titulo":"Quincenal o mensual, sin pagar doble","detalle":"Cada periodo paga su parte del mes (la quincena, medio salario) y la base no deja que un empleado cobre dos veces el mismo dia."},
      {"titulo":"Ingresos y salidas a mitad de periodo","detalle":"Quien entra el 16 cobra medio mes, no el mes entero. Prestamos internos se descuentan y los reembolsos de gastos se pagan en el mismo volante."},
      {"titulo":"Un periodo procesado queda fijo","detalle":"Ni una linea de nomina ni el periodo se editan despues de procesar: se corrige con el siguiente periodo, nunca reescribiendo lo que el empleado ya vio."}
    ]'::jsonb,
    faq = '[
      {"p":"¿Las tasas de TSS e ISR estan actualizadas?","r":"Vienen de una tabla con una fila por vigencia y la fuente de cada valor (resolucion de la TSS, escala de la DGII). Cada periodo guarda que fila uso. Cuando la TSS o la DGII publiquen valores nuevos hay que cargar la fila nueva."},
      {"p":"¿Genera el archivo que pide el portal de la TSS?","r":"Todavia no: calcula y guarda el desglose por empleado, pero no genera el archivo del SUIR ni los aportes patronales."}
    ]'::jsonb
where id = 'payroll';
