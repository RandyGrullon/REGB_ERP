-- ═══════════════════════════════════════════════════════════════════════
--  0024 — Publicar los modulos de la Fase 4
--
--  `sales-orders` y `ar` ya estan construidos y probados, pero seguian
--  con is_published = false, o sea invisibles en el marketplace. Un modulo
--  terminado que nadie puede contratar no genera un peso.
--
--  Se publican con su ficha comercial completa: sin `tagline`, `problem` y
--  `features` la tarjeta del marketplace queda muda y nadie la activa.
-- ═══════════════════════════════════════════════════════════════════════

update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{products}',
    recommends   = '{inventory}',
    tagline      = 'Vende formal, aparta lo que hay y entrega por partes',
    problem      = 'Anotas el pedido en una libreta, y cuando el cliente viene a buscarlo resulta que vendiste esa mercancia en el mostrador. O le prometes 25 sacos sabiendo que tienes 20 y despues nadie recuerda cuantos quedaron debiendo.',
    features     = '[
      {"titulo":"Confirmar aparta, no saca","detalle":"Al confirmar, la mercancia queda reservada para ese cliente pero sigue fisicamente en el almacen. El conteo del almacenista cuadra igual."},
      {"titulo":"Reserva parcial y backorder","detalle":"Si pides 25 y hay 20, aparta 20 y deja 5 debiendo. No rechaza el pedido entero por faltar unas unidades."},
      {"titulo":"Entregas por partes","detalle":"Despacha lo que hay hoy y el resto cuando llegue. El pedido lleva la cuenta de lo pedido, lo apartado y lo entregado."},
      {"titulo":"Cancelar devuelve","detalle":"Cancelar un pedido libera lo apartado al instante. Lo ya entregado no se toca."},
      {"titulo":"Precios del catalogo","detalle":"El precio y el ITBIS salen del producto, no se escriben a mano. El descuento es un permiso aparte: el cajero vende, el gerente rebaja."}
    ]'::jsonb,
    audience     = '{Distribuidoras,Ferreterias,Mayoristas,"Negocios que venden a credito"}',
    faq          = '[
      {"p":"¿Puedo vender sin tener inventario activo?","r":"Si, pero el pedido no aparta nada: queda como un documento de papel. Con inventario activo si reserva."},
      {"p":"¿Que pasa si vendo en caja algo ya apartado?","r":"La caja te avisa mostrando cero disponible, pero te deja vender —un mostrador no se detiene—. Existencias marca el producto como sobre-apartado para que sepas que un pedido no se podra despachar completo."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'sales-orders';

update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{sales-orders}',
    recommends   = '{accounting}',
    tagline      = 'Sabe quien te debe, cuanto y desde cuando',
    problem      = 'Vendes a credito y llevas la cuenta en una libreta o en la cabeza. Cuando llega fin de mes no sabes a quien llamar, y lo que tiene mas de 90 dias ya casi nunca se cobra.',
    features     = '[
      {"titulo":"Factura desde el pedido","detalle":"Un pedido entregado se factura de un clic. El vencimiento sale de los dias de credito que tenga ese cliente."},
      {"titulo":"Cobros parciales","detalle":"Registra abonos. El saldo se calcula solo y no deja cobrar mas de lo que se debe."},
      {"titulo":"Cartera por antiguedad","detalle":"Reparte lo que te deben en tramos —al dia, 1-30, 31-60, 61-90, mas de 90— y te dice a quien llamar hoy."},
      {"titulo":"Avisa lo sin facturar","detalle":"Lista los pedidos entregados que todavia no facturaste: el hueco por donde se escapa el dinero."},
      {"titulo":"Nada se borra","detalle":"Una factura con cobros no se anula: se emite nota de credito. El dinero recibido siempre tiene documento que lo respalde."}
    ]'::jsonb,
    audience     = '{"Negocios que venden a credito",Distribuidoras,Mayoristas,Ferreterias}',
    faq          = '[
      {"p":"¿Necesito contabilidad para usarlo?","r":"No. Cuentas por cobrar funciona solo; contabilidad la recomendamos para que los cobros se asienten automaticamente cuando llegue la Fase 6."},
      {"p":"¿Y si un cliente paga de mas?","r":"El sistema lo rechaza en vez de aceptarlo callado: un sobrepago silencioso deja la cartera cuadrando con dinero que no existe."}
    ]'::jsonb,
    setup_minutes = 20
where id = 'ar';

-- El precio ya estaba cargado en module_pricing desde 0009 (derivado de la
-- categoria "standard"), asi que no hace falta tocarlo. Se verifica:
do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id in ('products','inventory','pos','sales-orders','ar')
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'Hay % modulo(s) de F4 sin precio en los 3 tiers', v_faltan;
  end if;
end $$;
