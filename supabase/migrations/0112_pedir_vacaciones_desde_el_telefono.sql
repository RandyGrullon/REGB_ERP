-- ═══════════════════════════════════════════════════════════════════════
--  0112 — Pedir vacaciones desde el telefono
--
--  ── Las dos cosas que NO pueden venir del cliente ─────────────────────
--
--  1. QUIEN pide. Si el `employee_id` llegara por parametro, cualquiera
--     con la app pediria vacaciones a nombre de otro —o se las pediria a
--     un compañero para dejarlo sin saldo—. Se resuelve del token, por
--     el correo del perfil, igual que hace el portal web.
--
--  2. CUANTOS DIAS son. `business_days` es lo que descuenta del saldo
--     legal. Si lo pone el cliente, se piden tres semanas declarando un
--     dia y el saldo no baja. Se cuenta aqui.
--
--  Las dos son el mismo principio de la puerta F0: un dato que decide
--  algo no viaja desde el cliente.
--
--  ── Los dias laborables, contados igual que en TypeScript ─────────────
--
--  Replica `diasLaborablesEntre()` de @regb/operations: de inicio a fin
--  inclusive, sin sabados ni domingos.
--
--  NO descuenta feriados dominicanos, igual que la version de
--  TypeScript. Es una diferencia conocida de las dos -no un olvido de
--  esta-: el calendario de feriados no esta en el sistema, y adivinarlo
--  aqui haria que la base y la app dieran numeros distintos para la
--  misma solicitud. Cuando se agregue, se agrega en los dos sitios.
--
--  ── Lo que NO valida ──────────────────────────────────────────────────
--
--  Que al empleado le quede saldo. El saldo se DERIVA de la fecha de
--  contratacion menos lo aprobado (Art. 177), y quien decide es quien
--  aprueba: una solicitud sin saldo tiene que poder existir para que el
--  supervisor la vea y la rechace con motivo. Bloquearla aqui esconde
--  la conversacion.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.dias_laborables(p_inicio date, p_fin date)
returns integer
language sql
immutable
as $$
  select count(*)::integer
  from generate_series(p_inicio, p_fin, interval '1 day') d
  -- 0 domingo, 6 sabado.
  where extract(dow from d) not in (0, 6)
$$;

comment on function public.dias_laborables(date, date) is
  'Dias laborables entre dos fechas, inclusive, sin sabados ni domingos. Replica diasLaborablesEntre() de @regb/operations. NO descuenta feriados: tampoco lo hace la de TypeScript, y tienen que dar el mismo numero.';

create or replace function public.pedir_vacaciones(
  p_inicio date,
  p_fin    date,
  p_tipo   text default 'vacation',
  p_motivo text default null
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

  -- QUIEN pide sale del token, jamas de un parametro.
  select e.id into v_emp
  from public.employees e
  join public.user_profiles up
    on up.email = e.email and up.tenant_id = e.tenant_id
  where e.tenant_id = v_tenant and up.user_id = v_uid and e.status = 'active'
  limit 1;

  if v_emp is null then
    raise exception 'No encontramos un expediente vinculado a tu correo.'
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

  insert into public.time_off_requests
    (tenant_id, employee_id, leave_type, start_date, end_date, business_days, reason)
  values (v_tenant, v_emp, p_tipo, p_inicio, p_fin, v_dias, nullif(trim(coalesce(p_motivo, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.pedir_vacaciones(date, date, text, text) is
  'Solicitud de ausencia para el movil. El empleado sale del token y los dias laborables se cuentan aqui: los dos deciden algo y por eso no viajan desde el cliente (0112).';

revoke all on function public.dias_laborables(date, date) from public;
revoke all on function public.pedir_vacaciones(date, date, text, text) from public;
grant execute on function public.dias_laborables(date, date) to authenticated;
grant execute on function public.pedir_vacaciones(date, date, text, text) to authenticated;
