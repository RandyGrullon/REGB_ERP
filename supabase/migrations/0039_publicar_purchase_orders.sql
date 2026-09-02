-- ═══════════════════════════════════════════════════════════════════════
--  0039 — Publicar ordenes de compra
--
--  `purchase-orders` ya existia como fila muda en el catalogo desde la
--  siembra original (0009): la categoria y el precio ya estaban correctos,
--  solo faltaba la ficha comercial y is_published = true. Mismo patron que
--  la 0024 con sales-orders/ar: sin tagline/problem/features la tarjeta del
--  marketplace no dice nada y nadie la activa.
-- ═══════════════════════════════════════════════════════════════════════

update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{products}',
    recommends   = '{inventory}',
    tagline      = 'Pide al proveedor y recibe con el costo real de verdad',
    problem      = 'El pedido al proveedor vive en una nota de WhatsApp o en la memoria del encargado, y cuando llega el camion nadie sabe si vino completo ni a que precio quedo esta vez —asi que el costo del catalogo se atrasa meses.',
    features     = '[
      {"titulo":"Confirmar no mueve nada","detalle":"Confirmar una orden es la promesa del proveedor, no tuya: el inventario no cambia hasta que de verdad entra mercancia."},
      {"titulo":"Recepcion parcial","detalle":"El camion trae 80 de 100 pedidos: recibe esos 80 hoy y el resto cuando llegue, sin perder la cuenta de lo que todavia falta."},
      {"titulo":"Costo real al recibir","detalle":"El costo cotizado al pedir y el costo real al recibir se guardan por separado, y avisa la diferencia si el proveedor lo entrego mas caro o mas barato."},
      {"titulo":"Promedio ponderado automatico","detalle":"Cada recepcion actualiza el costo promedio del producto con el mismo calculo que ya usa el resto del inventario, sin tocar nada a mano."},
      {"titulo":"Proveedores con dias de credito","detalle":"Cada proveedor guarda su RNC y sus dias de pago, listos para cuando entre cuentas por pagar."}
    ]'::jsonb,
    audience     = '{Colmados,Ferreterias,Distribuidoras,"Negocios que compran para revender"}',
    faq          = '[
      {"p":"¿Necesito inventario activo para usarlo?","r":"Puedes crear y confirmar ordenes sin el, mas recibir mercancia no va a entrar a ningun almacen hasta que actives inventario."},
      {"p":"¿Que pasa si el proveedor cobra distinto a lo pedido?","r":"Se declara el costo real al momento de recibir, y ese es el que promedia el inventario. El sistema te avisa la diferencia contra lo cotizado, no la esconde."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'purchase-orders';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'purchase-orders'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'purchase-orders no tiene precio en los 3 tiers';
  end if;
end $$;
