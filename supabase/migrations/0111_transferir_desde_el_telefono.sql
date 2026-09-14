-- ═══════════════════════════════════════════════════════════════════════
--  0111 — Transferir en un solo acto
--
--  ── Por que no se puede hacer desde el movil sin esto ─────────────────
--
--  Una transferencia son CUATRO inserciones que tienen que ocurrir
--  juntas: la cabecera, la linea, el movimiento de salida y el de
--  entrada. La app web las hace dentro de una transaccion y no hay
--  problema.
--
--  El telefono habla por PostgREST, donde cada peticion es su propia
--  transaccion. Cuatro llamadas sueltas significan que si la tercera
--  falla —se cae la señal en un almacen, que es donde peor se cae— la
--  mercancia SALE de un almacen y no LLEGA al otro. Y el kardex es
--  inmutable: para arreglarlo hay que registrar un movimiento contrario,
--  a mano, sabiendo que paso.
--
--  Una funcion es una sola transaccion. O pasan las cuatro o no pasa
--  ninguna.
--
--  ── Lo que hay que comprobar A MANO ───────────────────────────────────
--
--  `security definer` significa que la RLS NO aplica dentro. Eso es lo
--  que la hace util -puede escribir el kardex- y lo que la hace
--  peligrosa: si no se comprueba el tenant de cada id que llega por
--  parametro, alguien mueve mercancia de otro contribuyente.
--
--  Los tres ids -dos almacenes y un producto- vienen del cliente. Los
--  tres se validan contra `rls.tenant_id()`. Es exactamente el caso
--  contra el que existe la puerta F0.
--
--  El PERMISO tambien se comprueba aqui: `inventory.transfer`. Sin esto,
--  cualquier usuario del tenant mueve inventario por PostgREST — ver
--  `docs/PERMISOS-Y-RLS.md`.
--
--  ── Y si comprueba que haya stock ─────────────────────────────────────
--
--  Se dio por hecho que de eso se encargaba `no_mover_sin_stock`. NO es
--  asi: ese trigger impide mover un producto que no lleva control de
--  existencias -un servicio-, no uno del que no queda. Se descubrio
--  porque la prueba de atomicidad, que pedia 999.999 unidades esperando
--  que fallara, PASO.
--
--  En este sistema el stock puede quedar negativo: el trigger del kardex
--  suma y resta sin mirar. Para una venta eso hasta puede defenderse -la
--  mercancia esta en el mostrador aunque el sistema no la haya recibido-.
--  Para una TRANSFERENCIA no: estarias creando existencia de la nada en
--  el destino y un faltante inventado en el origen, las dos cosas falsas.
--
--  Se comprueba sobre la cantidad FISICA y no sobre la disponible: lo
--  reservado esta en el almacen y se puede mover; lo que no esta, no.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.transferir(
  p_origen   uuid,
  p_destino  uuid,
  p_producto uuid,
  p_cantidad numeric
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

  -- No se puede mover lo que no esta. Ver la cabecera: aqui no hay
  -- ningun trigger que lo impida.
  if coalesce((
    select sl.qty_on_hand from public.stock_levels sl
    where sl.tenant_id = v_tenant and sl.warehouse_id = p_origen
      and sl.product_id = p_producto
  ), 0) < p_cantidad then
    raise exception 'No hay suficiente en el almacen de origen.' using errcode = '23514';
  end if;

  -- ── Las cuatro escrituras, juntas ─────────────────────────────────
  insert into public.stock_transfers
    (tenant_id, from_warehouse_id, to_warehouse_id, status, created_by, completed_at)
  values (v_tenant, p_origen, p_destino, 'completed', v_uid, now())
  returning id into v_id;

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

  return v_id;
end;
$$;

comment on function public.transferir(uuid, uuid, uuid, numeric) is
  'Transferencia completa en UNA transaccion, para el movil: por PostgREST cada peticion es su propia transaccion y cuatro llamadas sueltas dejan la mercancia a medio camino. Valida el tenant de los tres ids a mano porque corre como dueño (0111).';

revoke all on function public.transferir(uuid, uuid, uuid, numeric) from public;
grant execute on function public.transferir(uuid, uuid, uuid, numeric) to authenticated;
