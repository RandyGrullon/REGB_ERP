-- ═══════════════════════════════════════════════════════════════════════
--  0172 — «Tienda en línea», sin prometer una integración que no existe
--
--  El marketplace vendía `ecommerce` como «E-commerce sync», con una
--  descripción de catálogo, stock y pedidos bidireccionales con Shopify,
--  WooCommerce y Tiendanube. Esa conexión no existe: el módulo registra los
--  pedidos que llegan por la tienda web -con el total que cobró la tienda,
--  sin recalcularlo-, vincula cada producto de la tienda con el catálogo y
--  convierte el pedido en un pedido de venta después de revisarlo. La
--  pantalla ya se llama «Tienda en línea»; el catálogo decía otra cosa.
--
--  Lo que cambia es SOLO texto de la ficha: nombre, descripción, lema,
--  problema, funciones, a quién le sirve y preguntas. Ni el id, ni la
--  categoría, ni el precio, ni las dependencias, ni los dibujos de
--  pantalla (`screens`).
-- ═══════════════════════════════════════════════════════════════════════

update regb.module_catalog
set name        = 'Tienda en línea',
    description = 'Registra los pedidos de tu tienda web con el total que cobró la tienda y conviértelos en pedidos de venta. Todavía no se conecta sola con Shopify, WooCommerce ni Tiendanube.',
    tagline     = 'Los pedidos de tu tienda web, con su total tal cual, listos para despachar',
    problem     = 'Cada pedido que entra por la tienda web se copia a mano a una libreta o a una hoja de Excel, y nadie sabe cuál ya se despachó ni si el total que se cobró es el mismo que se facturó.',
    features    = jsonb_build_array(
      jsonb_build_object(
        'titulo', 'El total no se reinventa',
        'detalle', 'El pedido se guarda con el total que calculó la tienda. Nunca se recalcula con otra fórmula: el cliente ve en su factura lo mismo que pagó.'),
      jsonb_build_object(
        'titulo', 'Cada producto de la tienda apunta a tu catálogo',
        'detalle', 'Vinculas el producto de la tienda con el tuyo una vez. Así el pedido sabe qué mercancía sale, con su precio y su existencia de verdad.'),
      jsonb_build_object(
        'titulo', 'De pedido de la tienda a pedido de venta',
        'detalle', 'Lo revisas y lo importas como pedido de venta para despacharlo y facturarlo como cualquier otro. Importado o cancelado, ya no se edita.')),
    audience    = array['Negocios que venden por su tienda web (Shopify, WooCommerce o Tiendanube) y hoy copian los pedidos a mano'],
    faq         = jsonb_build_array(
      jsonb_build_object(
        'p', '¿Se conecta sola con mi tienda Shopify?',
        'r', 'Todavía no. Por ahora registras aquí cada pedido que llega por tu tienda, con el total que calculó la tienda, y lo importas como pedido de venta cuando lo revisas.'),
      jsonb_build_object(
        'p', '¿Recalcula el total de un pedido?',
        'r', 'No. El total se guarda tal cual llegó de la tienda, para que nunca aparezca un número distinto al que el cliente pagó.'))
where id = 'ecommerce';
