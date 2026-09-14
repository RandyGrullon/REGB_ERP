-- ═══════════════════════════════════════════════════════════════════════
--  0114 — Una accion del telefono no se repite
--
--  Lo que viene despues de esta migracion es una cola offline en el
--  movil: el almacen no tiene señal, la accion se guarda en el telefono
--  y se reintenta sola cuando vuelve. Eso es lo que hace falta para que
--  alguien pueda trabajar caminando entre estantes.
--
--  Pero una cola que reintenta SIN idempotencia es peor que no tener
--  cola. El caso que la rompe no es raro, es el mas comun de todos:
--
--    El telefono manda la transferencia. El servidor la guarda. La
--    respuesta se pierde en el camino -la señal se cayo justo ahi-. El
--    telefono nunca supo que llego, asi que reintenta. Ahora hay DOS
--    transferencias y la mercancia se movio dos veces.
--
--  Y en el kardex eso no se arregla borrando: `inventory_movements` es
--  inmutable a proposito (0107). Se arregla registrando movimientos
--  contrarios a mano, o sea que un fallo de señal termina en un ajuste
--  de inventario que alguien tiene que entender y firmar.
--
--  Con gastos es peor todavia porque nadie lo nota: un gasto duplicado
--  se reembolsa dos veces y entra dos veces en la 606 del mes.
--
--  ── La solucion: la referencia del cliente ES el id del registro ─────
--
--  El telefono genera un uuid ANTES de mandar nada y lo guarda con la
--  accion en su cola. Ese uuid se usa como clave primaria de la fila que
--  se crea. Entonces el segundo intento no es "otra transferencia
--  parecida": es literalmente la misma fila, y la clave primaria de
--  Postgres la rechaza.
--
--  Se eligio esto en vez de una tabla de referencias vistas -el patron
--  clasico- por una razon: una tabla aparte puede quedar desincronizada
--  con lo que realmente se escribio (se apunta la referencia y algo
--  falla despues, o al reves). Aqui no hay dos cosas que puedan
--  discrepar. La garantia no es contabilidad nuestra, es la clave
--  primaria del motor, que es la garantia mas fuerte que hay.
--
--  ── Por que `p_ref` es opcional ─────────────────────────────────────
--
--  La web llama estas mismas funciones sin cola: ahi el usuario esta
--  mirando la pantalla y ve si fallo. Sin `p_ref` el id se genera como
--  siempre. Solo quien encola necesita decidir el id de antemano.
--
--  ── El reintento devuelve el MISMO id, no un error ──────────────────
--
--  Para la cola, "esto ya estaba guardado" es exito, no fallo. Si
--  devolviera error, el telefono dejaria el gasto atascado en la cola
--  para siempre por algo que en realidad ya funciono. Se responde con el
--  id original y la cola lo saca tranquila.
--
--  Se comprueba SIEMPRE que la fila existente sea de este cliente. Sin
--  ese `and tenant_id = v_tenant`, mandar un uuid ajeno seria una forma
--  de que la funcion confirme que existe en otra cuenta.
--
--  ── Hay que borrar las funciones viejas, no solo reemplazarlas ──────
--
--  `create or replace` con un parametro mas no reemplaza: crea una
--  SEGUNDA funcion sobrecargada. Con la vieja todavia ahi, una llamada
--  de cuatro argumentos queda ambigua y Postgres la rechaza. Se borran
--  primero, a proposito.
-- ═══════════════════════════════════════════════════════════════════════

drop function if exists public.transferir(uuid, uuid, uuid, numeric);
drop function if exists public.reportar_gasto(text, date, numeric, text, text, text, text);
drop function if exists public.pedir_vacaciones(date, date, text, text);

-- ───────────────────────────────────────────────────────────────────────
--  Transferir entre almacenes (0111 + referencia)
-- ───────────────────────────────────────────────────────────────────────

create function public.transferir(
  p_origen   uuid,
  p_destino  uuid,
  p_producto uuid,
  p_cantidad numeric,
  p_ref      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := rls.tenant_id();
  v_uid    uuid := rls.regb_uid();
  v_id     uuid;
begin
  if v_tenant is null then
    raise exception 'Sesion sin cliente.' using errcode = '28000';
  end if;

  if not rls.module_active('inventory') then
    raise exception 'El modulo de inventario no esta activo.' using errcode = '42501';
  end if;

  if not rls.has_perm('inventory.transfer') then
    raise exception 'Tu rol no permite transferir mercancia.' using errcode = '42501';
  end if;

  -- Reintento de la cola: esta transferencia ya se guardo. Se responde
  -- con el mismo id ANTES de validar nada mas, porque las validaciones
  -- miran el estado de HOY -el stock de origen ya bajo con el primer
  -- intento- y harian fallar un reintento de algo que si funciono.
  if p_ref is not null and exists (
    select 1 from public.stock_transfers
    where id = p_ref and tenant_id = v_tenant
  ) then
    return p_ref;
  end if;

  -- ── Lo que llega del cliente ──────────────────────────────────────
  if p_origen = p_destino then
    raise exception 'El origen y el destino deben ser distintos.' using errcode = '22023';
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser positiva.' using errcode = '22023';
  end if;

  -- Los tres ids se comprueban contra el tenant de la sesion. La RLS no
  -- esta aqui para hacerlo: esto corre como dueño.
  if not exists (
    select 1 from public.warehouses
    where id = p_origen and tenant_id = v_tenant and is_active
  ) then
    raise exception 'El almacen de origen no es de esta cuenta.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.warehouses
    where id = p_destino and tenant_id = v_tenant and is_active
  ) then
    raise exception 'El almacen de destino no es de esta cuenta.' using errcode = '42501';
  end if;

  -- `active` y no `deleted_at`: products no usa borrado suave, usa una
  -- bandera. Comprobado contra el esquema, no supuesto.
  if not exists (
    select 1 from public.products
    where id = p_producto and tenant_id = v_tenant and active
  ) then
    raise exception 'Ese producto no es de esta cuenta.' using errcode = '42501';
  end if;

  -- No se puede mover lo que no esta. Ver la cabecera de 0111: aqui no
  -- hay ningun trigger que lo impida.
  if coalesce((
    select sl.qty_on_hand from public.stock_levels sl
    where sl.tenant_id = v_tenant and sl.warehouse_id = p_origen
      and sl.product_id = p_producto
  ), 0) < p_cantidad then
    raise exception 'No hay suficiente en el almacen de origen.' using errcode = '23514';
  end if;

  v_id := coalesce(p_ref, gen_random_uuid());

  -- ── Las cuatro escrituras, juntas ─────────────────────────────────
  --
  -- El bloque con `exception` existe por la carrera de verdad: dos
  -- copias del mismo reintento saliendo a la vez. La segunda se queda
  -- esperando en la clave primaria hasta que la primera confirma, y
  -- entonces choca. Sin este bloque, esa la veria el usuario como un
  -- error cuando en realidad su transferencia SI se hizo.
  begin
    insert into public.stock_transfers
      (id, tenant_id, from_warehouse_id, to_warehouse_id, status, created_by, completed_at)
    values (v_id, v_tenant, p_origen, p_destino, 'completed', v_uid, now());

    insert into public.stock_transfer_lines (transfer_id, tenant_id, product_id, qty)
    values (v_id, v_tenant, p_producto, p_cantidad);

    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty,
       reference_type, reference_id, created_by)
    values (v_tenant, p_origen, p_producto, 'transfer_out', -p_cantidad,
            'stock_transfer', v_id, v_uid);

    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty,
       reference_type, reference_id, created_by)
    values (v_tenant, p_destino, p_producto, 'transfer_in', p_cantidad,
            'stock_transfer', v_id, v_uid);
  exception when unique_violation then
    -- Solo se perdona si lo que choco es NUESTRA transferencia con esta
    -- referencia. Cualquier otra violacion de unicidad es un problema de
    -- verdad y tiene que verse.
    if p_ref is not null and exists (
      select 1 from public.stock_transfers
      where id = p_ref and tenant_id = v_tenant
    ) then
      return p_ref;
    end if;
    raise;
  end;

  return v_id;
end;
$$;

comment on function public.transferir(uuid, uuid, uuid, numeric, uuid) is
  'Transferencia completa en UNA transaccion, para el movil. `p_ref` es el id que el telefono decide antes de mandar: al reintentar desde la cola, la clave primaria impide que la mercancia se mueva dos veces (0111, 0114).';

revoke all on function public.transferir(uuid, uuid, uuid, numeric, uuid) from public;
grant execute on function public.transferir(uuid, uuid, uuid, numeric, uuid) to authenticated;

-- ───────────────────────────────────────────────────────────────────────
--  Reportar un gasto (0113 + referencia)
-- ───────────────────────────────────────────────────────────────────────

create function public.reportar_gasto(
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

  -- Reintento de la cola: este gasto ya entro. Un gasto duplicado se
  -- reembolsa dos veces y entra dos veces en la 606, y nadie lo nota
  -- hasta que cuadran el mes.
  if p_ref is not null and exists (
    select 1 from public.expenses where id = p_ref and tenant_id = v_tenant
  ) then
    return p_ref;
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

  -- Ojo con la cola: la fecha que se compara es la del GASTO, que viene
  -- guardada desde que ocurrio. Un gasto encolado ayer y subido hoy
  -- sigue siendo pasado, asi que esto no lo rechaza.
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
      -- Solo digitos, como en toda la 606. Que lo haga la base evita que
      -- el telefono guarde '131-22334-5' y la web '131223345'.
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

comment on function public.reportar_gasto(text, date, numeric, text, text, text, text, uuid) is
  'Gasto reportado desde el movil. El empleado sale del token, nunca de un parametro. `p_ref` es el id que decide el telefono: al reintentar desde la cola el gasto no se reembolsa dos veces ni entra dos veces en la 606 (0113, 0114).';

revoke all on function public.reportar_gasto(text, date, numeric, text, text, text, text, uuid) from public;
grant execute on function public.reportar_gasto(text, date, numeric, text, text, text, text, uuid) to authenticated;

-- ───────────────────────────────────────────────────────────────────────
--  Pedir vacaciones (0112 + referencia)
-- ───────────────────────────────────────────────────────────────────────

create function public.pedir_vacaciones(
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

  -- Reintento de la cola. Dos solicitudes iguales no son un duplicado
  -- inofensivo: le descuentan al empleado el doble de dias de su saldo.
  if p_ref is not null and exists (
    select 1 from public.time_off_requests where id = p_ref and tenant_id = v_tenant
  ) then
    return p_ref;
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

comment on function public.pedir_vacaciones(date, date, text, text, uuid) is
  'Solicitud de ausencia para el movil. El empleado sale del token y los dias laborables se cuentan aqui. `p_ref` es el id que decide el telefono: al reintentar desde la cola no se le descuenta el doble de dias (0112, 0114).';

revoke all on function public.pedir_vacaciones(date, date, text, text, uuid) from public;
grant execute on function public.pedir_vacaciones(date, date, text, text, uuid) to authenticated;
