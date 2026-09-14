-- ═══════════════════════════════════════════════════════════════════════
--  0113 — Reportar un gasto desde el telefono
--
--  Misma forma que 0112: QUIEN reporta sale del token, jamas de un
--  parametro. Un `employee_id` que viaje desde el cliente convierte el
--  reembolso de gastos en un formulario para cobrarle a la empresa a
--  nombre de otro.
--
--  ── Por que importa reportarlo EN EL MOMENTO ──────────────────────────
--
--  Un gasto con NCF de credito fiscal entra en la 606 del mes. Reunir
--  los papeles el dia 18 para declarar el 20 es como se pierden
--  deducciones —y como se pasan fechas—. El telefono esta en el bolsillo
--  cuando dan el comprobante; la computadora, no.
--
--  ── Lo que se valida ──────────────────────────────────────────────────
--
--  · El monto positivo, porque un gasto negativo es un cobro disfrazado.
--  · La fecha, que no puede ser del futuro: un gasto que todavia no
--    ocurrio no se reembolsa.
--  · El RNC del proveedor se limpia de guiones ANTES de guardarlo. Es el
--    mismo criterio de todo el repo -la 606 los quiere en digitos- y
--    hacerlo aqui evita que el telefono y la web guarden formatos
--    distintos para el mismo proveedor.
--
--  No valida el NCF contra la DGII: eso necesita red y este no es el
--  sitio. Lo que se guarda mal se corrige antes de declarar.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.reportar_gasto(
  p_categoria   text,
  p_fecha       date,
  p_monto       numeric,
  p_proveedor   text default null,
  p_rnc         text default null,
  p_ncf         text default null,
  p_nota        text default null
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

  -- QUIEN reporta sale del token.
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

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor que cero.' using errcode = '22023';
  end if;

  if p_fecha is null or p_fecha > current_date then
    raise exception 'La fecha del gasto no puede ser del futuro.' using errcode = '22023';
  end if;

  insert into public.expenses
    (tenant_id, employee_id, category, expense_date, amount,
     vendor_name, vendor_tax_id, ncf, receipt_note, status)
  values (
    v_tenant, v_emp, p_categoria, p_fecha, p_monto,
    nullif(trim(coalesce(p_proveedor, '')), ''),
    -- Solo digitos, como en toda la 606. Que lo haga la base evita que
    -- el telefono guarde '131-22334-5' y la web '131223345'.
    nullif(regexp_replace(coalesce(p_rnc, ''), '[^0-9]', '', 'g'), ''),
    nullif(upper(trim(coalesce(p_ncf, ''))), ''),
    nullif(trim(coalesce(p_nota, '')), ''),
    'submitted'
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.reportar_gasto(text, date, numeric, text, text, text, text) is
  'Gasto reportado desde el movil. El empleado sale del token, nunca de un parametro: si no, es un formulario para cobrarle a la empresa a nombre de otro (0113).';

revoke all on function public.reportar_gasto(text, date, numeric, text, text, text, text) from public;
grant execute on function public.reportar_gasto(text, date, numeric, text, text, text, text) to authenticated;
