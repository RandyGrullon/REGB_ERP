-- ═══════════════════════════════════════════════════════════════════════
--  0054 — Vacaciones & Permisos (modulo 64, F7/S39)
--
--  El saldo de vacaciones NUNCA se guarda -se deriva siempre de la fecha
--  de contratacion (Codigo de Trabajo Art. 177) y de lo ya aprobado, con
--  vacacionesAcumuladas()/saldoVacaciones() en @regb/operations-, mismo
--  principio que el saldo de una factura o de un activo fijo.
--
--  Solo el tipo 'vacation' tiene un saldo legal calculado. El resto de
--  tipos de ausencia (enfermedad, maternidad, paternidad, duelo, personal,
--  otro) se registran y se aprueban igual, pero este sistema NO calcula
--  un saldo para ellos -eso pide certificacion medica y reglas que no se
--  pueden verificar aqui, declarado tambien en la ficha del modulo-.
-- ═══════════════════════════════════════════════════════════════════════

create table public.time_off_requests (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  employee_id    uuid not null references public.employees(id),
  leave_type     text not null check (leave_type in
                   ('vacation', 'sick', 'personal', 'maternity', 'paternity', 'bereavement', 'other')),
  start_date     date not null,
  end_date       date not null,
  business_days  integer not null check (business_days > 0),
  reason         text,
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_date >= start_date)
);

create index on public.time_off_requests (tenant_id, employee_id, start_date desc);
create index on public.time_off_requests (tenant_id, status);

comment on column public.time_off_requests.business_days is
  'Calculado UNA vez al crear la solicitud -con diasLaborablesEntre() de @regb/operations, no reimplementado en SQL- y guardado como hecho historico.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.time_off_requests enable row level security;
alter table public.time_off_requests force row level security;

create policy tenant_module on public.time_off_requests for all
  using (tenant_id = rls.tenant_id() and rls.module_active('time-off'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('time-off'));

create policy provider_impersonating on public.time_off_requests for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7 desde entonces):
-- la RLS de insert solo compara el tenant_id de la fila nueva, no a quien
-- pertenece employee_id.
create function public.impedir_solicitud_ausencia_ajena() returns trigger
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

create trigger no_solicitud_ajena before insert on public.time_off_requests
  for each row execute function public.impedir_solicitud_ausencia_ajena();

-- ── Una solicitud ya resuelta es inmutable ───────────────────────────────
-- La transicion pending -> approved/rejected/cancelled SI es un update
-- valido (pasa porque OLD.status todavia es 'pending'); lo que se bloquea
-- es editar o borrar una vez que YA salio de 'pending'.
create function public.impedir_editar_solicitud_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    raise exception 'Esta solicitud ya fue resuelta y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_solicitud_resuelta
  before update or delete on public.time_off_requests
  for each row execute function public.impedir_editar_solicitud_resuelta();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.time_off_requests
  for each row execute function audit.record('time-off');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Saldo de vacaciones calculado de verdad -Codigo de Trabajo Art. 177-, no a ojo',
    problem      = 'Sin un calculo real, el saldo de vacaciones se discute de memoria y las solicitudes se aprueban por WhatsApp sin que nadie sepa cuanto le queda a quien.',
    features     = '[
      {"titulo":"Saldo segun la ley, no a ojo","detalle":"14 dias laborables por año durante los primeros cuatro, 18 desde el quinto -Art. 177-, calculado siempre de la fecha de contratacion, nunca guardado como un numero que se desincroniza."},
      {"titulo":"Solicitud y aprobacion con flujo real","detalle":"Pendiente, aprobada, rechazada o cancelada -una solicitud ya resuelta no se edita: se corrige con una solicitud nueva-."},
      {"titulo":"Calendario del equipo","detalle":"Quien esta fuera y cuando, de un vistazo -sin tener que preguntar-."},
      {"titulo":"Honesto sobre lo que no calcula","detalle":"Enfermedad, maternidad, paternidad y duelo se registran y se aprueban igual, pero el sistema no calcula un saldo legal para ellos -eso pide certificacion medica y reglas que no se pueden verificar aqui-."}
    ]'::jsonb,
    audience     = '{"Cualquiera que ya use employees y quiera dejar de discutir el saldo de memoria","Negocios con mas de un supervisor aprobando ausencias"}',
    faq          = '[
      {"p":"¿Calcula el saldo de licencia por enfermedad o maternidad?","r":"No -esas licencias dependen de certificacion medica y reglas que este sistema no puede verificar-. Se registran y se aprueban igual, pero sin un saldo calculado."},
      {"p":"¿Se puede editar una solicitud ya aprobada?","r":"No. Una vez resuelta -aprobada, rechazada o cancelada- queda fija; una correccion se hace con una solicitud nueva."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'time-off';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'time-off'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'time-off no tiene precio en los 3 tiers';
  end if;
end $$;
