-- ═══════════════════════════════════════════════════════════════════════
--  0029 · La ficha de `pos` prometia lo que F4 no entrega
-- ═══════════════════════════════════════════════════════════════════════
--
--  El marketplace vendia "Vende sin internet" e "Impresora termica" como
--  si fueran de la version web. Las dos necesitan hablar con el sistema
--  operativo —guardar local, abrir un puerto— y eso es Electron: F5.
--
--  Un cliente que compra por esa ficha, instala, y no lo encuentra es
--  exactamente la friccion que mata la puerta F4. Cuesta menos corregir el
--  texto ahora que explicarlo despues en una llamada.
--
--  Lo que se puede prometer HOY, y esta probado, si entra: el lector de
--  codigo de barras (un lector USB es un teclado) y el ticket de 80 mm por
--  el dialogo de impresion.
-- ═══════════════════════════════════════════════════════════════════════

update regb.module_catalog set
  tagline = 'Vender rapido en el mostrador, con lector y ticket impreso.',
  features = '[
    {"titulo":"Lector de codigo de barras","detalle":"Conecta cualquier lector USB y listo: no hace falta instalar nada. Escanea y el producto entra al ticket."},
    {"titulo":"Tactil de verdad","detalle":"Botones grandes, disenado para dedos y para prisa."},
    {"titulo":"Turnos y arqueo","detalle":"Cada cajero abre y cierra su turno. La diferencia sale sola y con nombre."},
    {"titulo":"Ticket de 80 mm","detalle":"Imprime en tu termica USB como en cualquier impresora. En la app de escritorio sale directo, sin dialogo."},
    {"titulo":"Comprobante fiscal","detalle":"El NCF sale solo: B01 al cliente con RNC y B02 al de mostrador."},
    {"titulo":"Varios metodos de pago","detalle":"Efectivo, tarjeta y transferencia en la misma venta."},
    {"titulo":"Descuentos con limite","detalle":"El cajero puede descontar hasta lo que tu decidas. Mas que eso pide aprobacion."},
    {"titulo":"Sin internet, en escritorio","detalle":"La app de escritorio sigue vendiendo con la conexion caida y sincroniza al volver."}
  ]'::jsonb,
  faq = '[
    {"p":"¿Funciona sin internet?","r":"En la app de escritorio, si: guarda todo en el equipo y sincroniza al volver la conexion. En el navegador hace falta conexion."},
    {"p":"¿Sirve mi impresora?","r":"Cualquier termica de 80 mm que Windows reconozca. Desde el navegador se imprime por el dialogo normal; desde la app de escritorio sale directo y abre la gaveta."},
    {"p":"¿Necesito una impresora fiscal certificada?","r":"No. La DGII no la exige: lo que exige es el NCF en el comprobante y los reportes 606, 607 y 608. Eso ya lo hace el sistema con una termica comun."},
    {"p":"¿Que lector de codigo de barras compro?","r":"Cualquiera USB en modo teclado, que es el de fabrica en casi todos. Se conecta y funciona: el lector teclea el codigo y manda Enter."},
    {"p":"¿Puedo usarlo sin inventario?","r":"Si, aunque entonces no descuenta existencias. La mayoria activa los dos juntos."}
  ]'::jsonb
where id = 'pos';
