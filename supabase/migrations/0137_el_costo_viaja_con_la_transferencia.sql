-- ═══════════════════════════════════════════════════════════════════════
--  0137 — El costo viaja con la mercancia en una transferencia
--
--  ── El fallo ──────────────────────────────────────────────────────────
--
--  Ninguno de los tres caminos que trasladan mercancia entre almacenes le
--  ponia costo al movimiento:
--
--    * /transferencias (0067): despachar y recibir, con transito.
--    * /inventory/transfers (0019): el traslado simple de un paso.
--    * `public.transferir()` (0111): el del telefono.
--
--  Los tres insertan `transfer_out` y `transfer_in` sin `unit_cost`, y el
--  trigger del kardex (`apply_inventory_movement`, 0019) trata una entrada
--  sin costo como "el promedio no cambia". En un almacen que no tenia ese
--  producto, "no cambia" es CERO.
--
--  Encontrado usando la app con la distribuidora de la demo: 8 sacos de
--  cemento pasaron de Santo Domingo (promedio 411.50) a Santiago y en
--  Santiago quedaron a 0.0000. Cada venta de caja en Santiago contabilizaba
--  costo de ventas cero -margen del 100%- y el inventario de Santiago no
--  valia nada. Al entrar despues una compra a 399, el promedio quedo en
--  331.58: ni lo uno ni lo otro.
--
--  ── Como ─────────────────────────────────────────────────────────────
--
--  En la BASE y no en cada pantalla, por la misma razon que 0111: son tres
--  caminos, uno de ellos por PostgREST, y el cuarto que alguien agregue
--  manana tambien se olvidaria. Un `before insert` en el kardex completa
--  el costo cuando falta:
--
--    * `transfer_out`: el costo promedio del ORIGEN en ese instante. Es
--      informativo para la salida (una salida no mueve el promedio), pero
--      queda escrito para la entrada.
--    * `transfer_in`: el costo de SU salida -mismo documento, mismo
--      producto-. Asi la mercancia en transito entra al destino con el
--      costo con el que salio, aunque el promedio del origen cambie
--      mientras viaja.
--
--  Si el que llama ya trae costo, se respeta. Un costo de CERO en el
--  origen se trata como "no se sabe" (null): mezclar ceros en el promedio
--  del destino lo hundiria, que es justo el fallo que esto viene a cerrar.
--
--  `authenticated` no puede leer `stock_levels.avg_cost` (0109): por eso
--  esto es `security definer` y no una consulta desde la accion. No
--  devuelve nada a quien inserta; solo escribe el costo en la fila.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.costo_de_transferencia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_costo   numeric(12,4);
  v_origen  uuid;
begin
  if new.unit_cost is not null then
    return new;
  end if;

  if new.movement_type = 'transfer_out' then
    select nullif(sl.avg_cost, 0) into v_costo
    from public.stock_levels sl
    where sl.tenant_id = new.tenant_id
      and sl.warehouse_id = new.warehouse_id
      and sl.product_id = new.product_id;
    new.unit_cost := v_costo;
    return new;
  end if;

  if new.movement_type = 'transfer_in' and new.reference_id is not null then
    -- La salida del MISMO documento y producto. Filtra por tenant: esto
    -- corre como dueño y la RLS no esta para hacerlo.
    select m.unit_cost, m.warehouse_id into v_costo, v_origen
    from public.inventory_movements m
    where m.tenant_id = new.tenant_id
      and m.reference_type is not distinct from new.reference_type
      and m.reference_id = new.reference_id
      and m.product_id = new.product_id
      and m.movement_type = 'transfer_out'
    order by m.created_at desc
    limit 1;

    -- Una salida despachada ANTES de esta migracion no tiene costo: se
    -- usa el promedio de hoy de su almacen, que es lo mas cercano que hay.
    if v_costo is null and v_origen is not null then
      select nullif(sl.avg_cost, 0) into v_costo
      from public.stock_levels sl
      where sl.tenant_id = new.tenant_id
        and sl.warehouse_id = v_origen
        and sl.product_id = new.product_id;
    end if;

    new.unit_cost := v_costo;
  end if;

  return new;
end;
$$;

comment on function public.costo_de_transferencia() is
  'Completa unit_cost de transfer_out (promedio del origen) y transfer_in (el de su salida) cuando falta. Sin esto la mercancia trasladada entraba al destino a costo cero (0137).';

drop trigger if exists costo_de_transferencia on public.inventory_movements;
create trigger costo_de_transferencia
  before insert on public.inventory_movements
  for each row
  when (new.movement_type in ('transfer_out', 'transfer_in') and new.unit_cost is null)
  execute function public.costo_de_transferencia();

-- ── Lo que ya quedo a costo cero ─────────────────────────────────────
--
--  Existencias con cantidad y promedio CERO cuya unica entrada con costo
--  conocido es una transferencia: se les pone el promedio actual del
--  almacen de donde salieron. Es una estimacion -el promedio de hoy del
--  origen, no el del dia del traslado-, pero cero es seguro falso.
--
--  Solo cuando el promedio es exactamente cero: si despues entro una
--  compra y el promedio ya se mezclo, no hay forma honesta de separarlo y
--  se deja como esta (hay que corregirlo con un conteo o un ajuste).
--  El kardex NO se toca: es inmutable, y sus filas viejas quedan como se
--  escribieron.
with origen as (
  select distinct on (ti.tenant_id, ti.warehouse_id, ti.product_id)
         ti.tenant_id, ti.warehouse_id, ti.product_id, sl_o.avg_cost as costo
  from public.inventory_movements ti
  join public.inventory_movements tout
    on tout.tenant_id = ti.tenant_id
   and tout.reference_type is not distinct from ti.reference_type
   and tout.reference_id = ti.reference_id
   and tout.product_id = ti.product_id
   and tout.movement_type = 'transfer_out'
  join public.stock_levels sl_o
    on sl_o.tenant_id = tout.tenant_id
   and sl_o.warehouse_id = tout.warehouse_id
   and sl_o.product_id = tout.product_id
  where ti.movement_type = 'transfer_in'
    and ti.unit_cost is null
    and sl_o.avg_cost > 0
  order by ti.tenant_id, ti.warehouse_id, ti.product_id, ti.created_at desc
)
update public.stock_levels sl
set avg_cost = o.costo, updated_at = now()
from origen o
where sl.tenant_id = o.tenant_id
  and sl.warehouse_id = o.warehouse_id
  and sl.product_id = o.product_id
  and sl.avg_cost = 0
  and sl.qty_on_hand > 0;
