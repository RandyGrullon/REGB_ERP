-- ═══════════════════════════════════════════════════════════════════════
--  0100 — Cobrar lo que no es mercancia (envio, instalacion, mano de obra)
--
--  Segundo hueco de FACTUSOL: alli se cobra "ENVIO" con un codigo aparte.
--  Aqui toda linea de venta exige un producto del catalogo, y todo
--  producto del catalogo mueve inventario. Cobrar un envio obligaba a
--  inventar un producto fantasma que despues aparecia en existencias con
--  numeros negativos creciendo para siempre.
--
--  LO QUE NO SE HIZO, y por que: la solucion evidente era volver
--  `product_id` nulo en `sales_order_lines` y `pos_sale_lines` y poner
--  una descripcion libre. Se descarto. Esa columna la usan el kardex, el
--  607, la rentabilidad por producto y media docena de reportes con JOIN
--  normal; volverla nula convierte todos esos JOIN en LEFT JOIN y cada
--  uno es una oportunidad nueva de contar mal. Ademas el catalogo dejaria
--  de ser la unica lista de lo que el negocio vende.
--
--  Lo que se hizo: un producto puede NO llevar control de stock. Sigue
--  teniendo codigo, nombre, precio e ITBIS -se cotiza, se factura, se
--  reporta y entra al 607 como cualquier otro-, pero no tiene existencias
--  ni genera movimientos. Es como lo resuelve la mayoria de los ERP, y no
--  toca ni una linea de venta.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.products
  add column tracks_stock boolean not null default true;

comment on column public.products.tracks_stock is
  'false = concepto vendible sin existencias (envio, instalacion, mano de obra). Se factura igual; no mueve inventario ni se reserva.';

create index on public.products (tenant_id, tracks_stock) where not tracks_stock;

-- ── La invariante de verdad ─────────────────────────────────────────────
--  Nada puede mover inventario de algo que no lleva inventario. Sin esta
--  guarda, un camino que alguien agregue manana -una devolucion, un
--  ajuste, una importacion- volveria a crear existencias fantasma de un
--  envio, que es exactamente el problema que este cambio viene a quitar.
create function public.impedir_movimiento_sin_stock() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lleva boolean;
  v_sku   text;
begin
  select tracks_stock, sku into v_lleva, v_sku
  from public.products where id = new.product_id;

  if v_lleva is false then
    raise exception 'El producto % no lleva control de existencias: no puede tener movimientos de inventario.', v_sku
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger no_mover_sin_stock
  before insert on public.inventory_movements
  for each row execute function public.impedir_movimiento_sin_stock();

-- Lo mismo para las existencias: un concepto sin stock no tiene un nivel
-- que contar. Sin esto, un conteo ciclico le pediria al almacenista que
-- contara cuantos "envios" hay en el estante.
create function public.impedir_existencia_sin_stock() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lleva boolean;
  v_sku   text;
begin
  select tracks_stock, sku into v_lleva, v_sku
  from public.products where id = new.product_id;

  if v_lleva is false then
    raise exception 'El producto % no lleva control de existencias.', v_sku
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger no_existencia_sin_stock
  before insert on public.stock_levels
  for each row execute function public.impedir_existencia_sin_stock();

-- ── Y al reves: no apagar el stock de algo que ya tiene ─────────────────
--  Marcar como "sin stock" un producto con existencias o con kardex
--  borraria su historia de un plumazo: el kardex dejaria de cuadrar con
--  las existencias y nadie sabria por que.
create function public.impedir_apagar_stock_con_historia() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.tracks_stock and not new.tracks_stock then
    if exists (select 1 from public.inventory_movements where product_id = new.id) then
      raise exception 'El producto % ya tiene movimientos de inventario: no se le puede quitar el control de existencias.', new.sku
        using errcode = '23514';
    end if;
    delete from public.stock_levels where product_id = new.id and qty_on_hand = 0;
    if exists (select 1 from public.stock_levels where product_id = new.id) then
      raise exception 'El producto % todavia tiene existencias: ajustalas a cero antes de quitarle el control.', new.sku
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_apagar_stock_con_historia
  before update on public.products
  for each row execute function public.impedir_apagar_stock_con_historia();
