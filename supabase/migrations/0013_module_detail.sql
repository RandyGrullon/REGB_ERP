-- ═══════════════════════════════════════════════════════════════════════
--  0013 — Ficha comercial de cada modulo
--
--  El marketplace mostraba nombre, descripcion y precio. Para decidir una
--  compra hace falta mas: que resuelve, que trae, a quien sirve y como se
--  ve. Esto es material de VENTA, no configuracion tecnica, y por eso vive
--  aparte del manifest.
--
--  `screens` guarda mockups en texto (los mismos de §12), no imagenes: una
--  captura envejece con cada cambio de UI y nadie la actualiza. Un mockup
--  describe la INTENCION y sigue siendo cierto.
-- ═══════════════════════════════════════════════════════════════════════

alter table regb.module_catalog
  add column tagline        text,
  add column problem        text,
  add column features       jsonb not null default '[]',
  add column audience       text[] not null default '{}',
  add column screens        jsonb not null default '[]',
  add column faq            jsonb not null default '[]',
  add column setup_minutes  integer;

comment on column regb.module_catalog.tagline is
  'Una linea. Lo que el vendedor diria en el pasillo.';
comment on column regb.module_catalog.problem is
  'El dolor concreto que quita. Sin esto la tarjeta describe features, no valor.';
comment on column regb.module_catalog.features is
  'Array de {titulo, detalle}. Lo que el cliente RECIBE.';
comment on column regb.module_catalog.screens is
  'Array de {titulo, descripcion, mockup}. Mockup en texto: no envejece como una captura.';

-- ═══════════════════════════════════════════════════════════════════════
--  Los cinco construidos llevan ficha completa. El resto hereda una
--  generica hasta que se construya de verdad.
-- ═══════════════════════════════════════════════════════════════════════

update regb.module_catalog set
  tagline = 'Todo lo que vendes, en un solo sitio y con un solo precio correcto.',
  problem = 'Los precios viven en la cabeza del dueno y en tres hojas de Excel distintas. Cuando el dueno no esta, nadie sabe a cuanto va el arroz.',
  setup_minutes = 30,
  audience = array['Cualquier negocio que venda algo', 'Imprescindible para inventario y punto de venta'],
  features = '[
    {"titulo":"Variantes sin duplicar","detalle":"Una camisa con 4 tallas y 3 colores es UN producto con 12 variantes, no 12 productos."},
    {"titulo":"Unidades de medida","detalle":"Compras el saco y vendes la libra. El sistema convierte solo."},
    {"titulo":"Kits y combos","detalle":"Vendes un combo y descuenta las piezas del inventario."},
    {"titulo":"Importar desde Excel","detalle":"Sube tu lista actual, revisa el mapeo de columnas y listo."},
    {"titulo":"Precio protegido","detalle":"El vendedor ve el precio de venta; el costo solo lo ve quien tu digas."}
  ]'::jsonb,
  screens = '[
    {
      "titulo":"Catalogo",
      "descripcion":"Todo tu inventario de productos, buscable y filtrable. El punto de color indica si hay existencia.",
      "mockup":"┌──────────────────────────────────────────────────────┐\n│ 🔍 Buscar producto…      [Categoria ▾] [+ Producto] │\n├──────────────────────────────────────────────────────┤\n│ SKU      PRODUCTO            UNIDAD   PRECIO      ⚙️ │\n├──────────────────────────────────────────────────────┤\n│ ARZ-001  Arroz Selecto 5L    saco     $  180.00   ⋯ │\n│ ACT-114  Aceite Girasol 1L   unidad   $   95.00   ⋯ │\n│ LEC-220  Leche Entera 1L     unidad   $   62.00   ⋯ │\n│ HAR-008  Harina de Trigo     libra    $   45.00   ⋯ │\n└──────────────────────────────────────────────────────┘"
    },
    {
      "titulo":"Ficha del producto",
      "descripcion":"Variantes, unidades y precios por lista. El costo solo aparece si tu rol lo permite.",
      "mockup":"┌──────────────────────────────────────────────────────┐\n│ ← Catalogo › Arroz Selecto 5L          [Guardar]    │\n├──────────────────────────────────────────────────────┤\n│ SKU      ARZ-001        Categoria  Abarrotes        │\n│ Unidad   saco de 5L     Impuesto   ITBIS 18%        │\n│                                                      │\n│ PRECIOS                                              │\n│  Publico       $ 180.00                              │\n│  Mayorista     $ 165.00   (desde 10 unidades)       │\n│  Costo         🔒 sin permiso                        │\n│                                                      │\n│ VARIANTES                                            │\n│  · 5 libras    ARZ-001-5     $  180.00              │\n│  · 10 libras   ARZ-001-10    $  340.00              │\n└──────────────────────────────────────────────────────┘"
    }
  ]'::jsonb,
  faq = '[
    {"p":"¿Puedo subir mi lista de Excel?","r":"Si. El importador te deja mapear tus columnas a las de REGB y te muestra una vista previa antes de crear nada. Si algo sale mal, deshaces la importacion completa."},
    {"p":"¿Que pasa si vendo por peso?","r":"Defines la unidad de compra y la de venta, y el sistema convierte. Compras el saco de 100 libras y vendes por libra sin hacer cuentas."},
    {"p":"¿El vendedor puede ver cuanto me costo?","r":"Solo si le das el permiso products.price.view. Por defecto los roles de venta no lo tienen."}
  ]'::jsonb
where id = 'products';

update regb.module_catalog set
  tagline = 'Saber que hay, donde esta y cuanto vale, sin contar a mano.',
  problem = 'Vendes algo que no tenias, o tienes algo vencido que nadie vio. El conteo de fin de mes se lleva un sabado entero y aun asi no cuadra.',
  setup_minutes = 45,
  audience = array['Colmados y ferreterias con mas de 200 productos', 'Distribuidoras con varios almacenes', 'Cualquiera que haya perdido una venta por no saber si tenia'],
  features = '[
    {"titulo":"Multi-almacen","detalle":"Existencias separadas por almacen y sucursal, con transferencias en transito."},
    {"titulo":"Kardex completo","detalle":"Cada movimiento queda registrado: quien, cuando, por que y cuanto."},
    {"titulo":"Costo promedio o FIFO","detalle":"Eliges el metodo y el sistema valoriza solo. Sale cuadrado a contabilidad."},
    {"titulo":"Alertas de stock bajo","detalle":"Defines el minimo por producto y te avisa antes de quedarte sin."},
    {"titulo":"Conteos ciclicos","detalle":"Cuenta una parte cada semana en vez de cerrar el negocio un sabado."},
    {"titulo":"Ajustes con aprobacion","detalle":"Un ajuste grande necesita visto bueno del gerente. Todo queda auditado."}
  ]'::jsonb,
  screens = '[
    {
      "titulo":"Existencias",
      "descripcion":"Lo que hay ahora mismo, por almacen. El color del punto avisa antes de que te quedes sin.",
      "mockup":"┌──────────────────────────────────────────────────────┐\n│ SKUs 1,284 │ Valor $2.4M │ ⚠️ Bajos 23 │ 🔴 Vencen 7 │\n├──────────────────────────────────────────────────────┤\n│ 🔍 Buscar…   [Almacen ▾] [Solo bajos] [⤓ Exportar]  │\n├──────────────────────────────────────────────────────┤\n│ SKU      PRODUCTO          ALM   STOCK   COSTO    ⚙️ │\n├──────────────────────────────────────────────────────┤\n│ ARZ-001  Arroz Selecto 5L  A-1   1,240   $180    ⋯ │\n│ ACT-114  Aceite Girasol    A-1   ⚠️  18   $ 95    ⋯ │\n│ LEC-220  Leche Entera 1L   REF   🔴   4   $ 62    ⋯ │\n│ HAR-008  Harina de Trigo   A-2     890   $ 45    ⋯ │\n└──────────────────────────────────────────────────────┘"
    },
    {
      "titulo":"Movimiento de ajuste",
      "descripcion":"Cuando el conteo fisico no cuadra. Queda auditado y contabilizado.",
      "mockup":"┌──────────────────────────────────────────────────────┐\n│ Ajustar existencias — Aceite Girasol 1L             │\n├──────────────────────────────────────────────────────┤\n│  Sistema dice        18 unidades                     │\n│  Conteo fisico     [ 15 ] unidades                   │\n│  Diferencia          -3    (−$285.00)                │\n│                                                      │\n│  Motivo   [ Merma por rotura            ▾ ]         │\n│  Nota     [ Se rompieron 3 en el traslado ]         │\n│                                                      │\n│  ℹ️ Ajustes sobre $10,000 requieren aprobacion       │\n│                          [Cancelar]  [Ajustar]      │\n└──────────────────────────────────────────────────────┘"
    },
    {
      "titulo":"Conteo desde el celular",
      "descripcion":"El almacenista cuenta escaneando, sin papel ni tablero.",
      "mockup":"      ┌─────────────────────┐\n      │ ← Conteo A-1    3/48│\n      ├─────────────────────┤\n      │                     │\n      │   [ 📷 ESCANEAR ]   │\n      │                     │\n      │ ARZ-001             │\n      │ Arroz Selecto 5L    │\n      │                     │\n      │ Contado             │\n      │  ┌───────────────┐  │\n      │  │    1,240      │  │\n      │  └───────────────┘  │\n      │                     │\n      │ [Saltar] [Siguiente]│\n      └─────────────────────┘"
    }
  ]'::jsonb,
  faq = '[
    {"p":"¿Tengo que contar todo para empezar?","r":"No. Empiezas con las cantidades que creas y vas ajustando. Muchos clientes arrancan solo con los 50 productos que mas rotan."},
    {"p":"¿Sirve si tengo un solo almacen?","r":"Si, y es lo mas comun. El multi-almacen esta ahi para cuando crezcas, no te estorba antes."},
    {"p":"¿Cuadra con contabilidad?","r":"Si tienes el modulo de contabilidad, cada movimiento genera su asiento. Si no, exportas la valorizacion para tu contador."}
  ]'::jsonb
where id = 'inventory';

update regb.module_catalog set
  tagline = 'Vender rapido en el mostrador, con internet o sin el.',
  problem = 'La fila crece mientras se busca el precio. Al cerrar, la caja no cuadra y nadie sabe donde se fue la diferencia.',
  setup_minutes = 20,
  audience = array['Colmados, farmacias, ferreterias', 'Restaurantes de mostrador', 'Cualquier negocio que cobre en persona'],
  features = '[
    {"titulo":"Vende sin internet","detalle":"Si se cae la conexion sigue vendiendo. Al volver, sincroniza solo y no duplica nada."},
    {"titulo":"Tactil de verdad","detalle":"Botones grandes, disenado para dedos y para prisa."},
    {"titulo":"Turnos y arqueo","detalle":"Cada cajero abre y cierra su turno. La diferencia sale sola y con nombre."},
    {"titulo":"Impresora termica","detalle":"Imprime el ticket en la impresora que ya tienes."},
    {"titulo":"Varios metodos de pago","detalle":"Efectivo, tarjeta y transferencia en la misma venta."},
    {"titulo":"Descuentos con limite","detalle":"El cajero puede descontar hasta lo que tu decidas. Mas que eso pide aprobacion."}
  ]'::jsonb,
  screens = '[
    {
      "titulo":"La caja",
      "descripcion":"Buscas o escaneas, tocas, cobras. Todo en una pantalla.",
      "mockup":"┌────────────────────────┬─────────────────────────────┐\n│ 🔍 Buscar o escanear   │ 🛒 TICKET #00284            │\n│                   [📷] │ ──────────────────────────  │\n│ [Todos][Bebidas][Otros]│ Arroz 5L      2 × 180  $360 │\n│                        │ Aceite 1L     1 ×  95  $ 95 │\n│ ┌──────┐┌──────┐┌─────┐│ Leche 1L      6 ×  62  $372 │\n│ │ 🍚   ││ 🛢️   ││ 🥛  ││ Harina        1 ×  45  $ 45 │\n│ │Arroz ││Aceite││Leche││ ──────────────────────────  │\n│ │ $180 ││ $95  ││ $62 ││ Subtotal            $872.00 │\n│ └──────┘└──────┘└─────┘│ Descuento 5%       -$ 43.60 │\n│ ┌──────┐┌──────┐┌─────┐│ ITBIS 18%           $149.11 │\n│ │ 🌾   ││ 🧂   ││ ☕  ││ ──────────────────────────  │\n│ │Harina││Azucar││Cafe ││ TOTAL              $977.51  │\n│ └──────┘└──────┘└─────┘│                             │\n│                        │ [💵 Efec.][💳 Tarj.][📱 Tra.]│\n│ 🟢 En linea · Turno 4h │ [    COBRAR $977.51       ] │\n└────────────────────────┴─────────────────────────────┘"
    },
    {
      "titulo":"Cierre de turno",
      "descripcion":"El cajero cuenta lo que hay. La diferencia sale sola, con nombre y hora.",
      "mockup":"┌──────────────────────────────────────────────────────┐\n│ Cerrar turno — Maria Rosario · Caja 1               │\n│ Abierto 8:02 AM · Cerrando 4:14 PM · 47 ventas      │\n├──────────────────────────────────────────────────────┤\n│  Fondo inicial              $  2,000.00              │\n│  Ventas en efectivo         $ 18,420.00              │\n│  Ventas con tarjeta         $  9,180.00              │\n│  ─────────────────────────────────────               │\n│  Debe haber en caja         $ 20,420.00              │\n│  Conteo fisico            [ $ 20,380.00 ]            │\n│  ─────────────────────────────────────               │\n│  Diferencia                 -$    40.00  ⚠️          │\n│                                                      │\n│  Nota [ Faltante, se revisara manana       ]        │\n│                             [Cancelar] [Cerrar]      │\n└──────────────────────────────────────────────────────┘"
    }
  ]'::jsonb,
  faq = '[
    {"p":"¿De verdad funciona sin internet?","r":"Si. En la version de escritorio guarda todo en el equipo y sincroniza al volver la conexion. Probado vendiendo 8 horas seguidas desconectado."},
    {"p":"¿Sirve mi impresora?","r":"Cualquier impresora termica ESC/POS por USB o red, que es el estandar de casi todas."},
    {"p":"¿Puedo usarlo sin inventario?","r":"Si, aunque entonces no descuenta existencias. La mayoria activa los dos juntos."}
  ]'::jsonb
where id = 'pos';

update regb.module_catalog set
  tagline = 'La quincena calculada bien, con TSS, AFP, ARS e ISR al dia.',
  problem = 'La nomina se hace en Excel con formulas que alguien copio hace tres anos. Un error se descubre cuando el empleado reclama, y los archivos de la TSS se arman a mano.',
  setup_minutes = 120,
  audience = array['Empresas con mas de 10 empleados en nomina formal', 'Quien ya tuvo una diferencia con la TSS'],
  features = '[
    {"titulo":"TSS, AFP y ARS","detalle":"Los descuentos de ley calculados con los topes y porcentajes vigentes."},
    {"titulo":"ISR por escala","detalle":"Retencion segun la escala anual, prorrateada correctamente."},
    {"titulo":"Prestaciones y regalia","detalle":"Preaviso, cesantia, vacaciones y el doble sueldo, calculados solos."},
    {"titulo":"Volantes por correo","detalle":"Cada empleado recibe el suyo. Nada de imprimir y repartir."},
    {"titulo":"Archivos para la TSS","detalle":"El formato que el portal espera, listo para subir."},
    {"titulo":"Salarios cifrados","detalle":"Se guardan cifrados en la base. Ni el equipo tecnico los ve en claro."}
  ]'::jsonb,
  screens = '[
    {
      "titulo":"Procesar la quincena",
      "descripcion":"Revisas, apruebas y se cierra. Nada se paga sin que alguien lo mire.",
      "mockup":"┌──────────────────────────────────────────────────────┐\n│ Nomina — 2da quincena de julio        [Procesar]    │\n├──────────────────────────────────────────────────────┤\n│ 48 empleados · 2 con novedades                       │\n├──────────────────────────────────────────────────────┤\n│ EMPLEADO          BRUTO      DESC.      NETO      ⚙️ │\n├──────────────────────────────────────────────────────┤\n│ Ana Gomez        $18,000   $1,984    $16,016     ⋯  │\n│ Luis Martinez    $22,500   $2,480    $20,020     ⋯  │\n│ Pedro Vasquez    $15,000   $1,653    $13,347  ⚠️ ⋯  │\n│   └ 2 dias de licencia sin sueldo                    │\n│ Carla Suero      $28,000   $3,086    $24,914     ⋯  │\n├──────────────────────────────────────────────────────┤\n│ TOTAL BRUTO  $842,500   DESCUENTOS  $92,864         │\n│ TOTAL NETO   $749,636   APORTE PATRONAL  $118,995   │\n└──────────────────────────────────────────────────────┘"
    }
  ]'::jsonb,
  faq = '[
    {"p":"¿Como se que los calculos estan bien?","r":"Los primeros tres meses recomendamos correr la nomina en paralelo con tu metodo actual y comparar. Si algo no cuadra al peso, lo arreglamos antes de que dependas de esto."},
    {"p":"¿Y si cambian los porcentajes de ley?","r":"Se actualizan sin que hagas nada. Es parte de la mensualidad."},
    {"p":"¿Los empleados ven su volante?","r":"Con el Portal del Empleado si, desde su celular. Si no, se les manda por correo."}
  ]'::jsonb
where id = 'payroll';

update regb.module_catalog set
  tagline = 'Fotografia la factura del proveedor y deja de teclearla.',
  problem = 'El 606 se arma con las facturas que te dan tus proveedores. Teclear RNC, NCF, fecha e ITBIS de 300 facturas al mes se lleva dias, y un NCF mal digitado es un rechazo de la DGII.',
  setup_minutes = 15,
  audience = array['Quien recibe mas de 30 facturas de proveedor al mes', 'Contadores externos que llevan varias empresas', 'Cualquiera que haya tenido un 606 rechazado'],
  features = '[
    {"titulo":"Foto y listo","detalle":"Desde el celular al recibir la mercancia, desde el escaner, o reenviando un correo."},
    {"titulo":"Extrae los campos que importan","detalle":"RNC, NCF, fecha, subtotal, ITBIS y las lineas, separadas."},
    {"titulo":"Nunca contabiliza solo","detalle":"Genera un borrador. Una persona aprueba. Lo dudoso va resaltado en ambar."},
    {"titulo":"Confianza por campo","detalle":"Ves que tan seguro esta de cada dato, no un porcentaje global inutil."},
    {"titulo":"Se borra sola","detalle":"La imagen se cifra y se purga a los 90 dias de aprobada. El dato ya vive en tu contabilidad."}
  ]'::jsonb,
  screens = '[
    {
      "titulo":"Revisar lo extraido",
      "descripcion":"La foto a la izquierda, los campos a la derecha. Lo dudoso en ambar, para mirarlo dos veces.",
      "mockup":"┌───────────────────────┬──────────────────────────────┐\n│                       │ Factura de proveedor         │\n│   [ FOTO DE LA        │ ──────────────────────────── │\n│     FACTURA ]         │ Proveedor  Distribuidora ABC │\n│                       │ RNC        1-01-12345-6   ✓  │\n│   ┌─────────────┐     │ NCF        B0100000123    ✓  │\n│   │ ▓▓▓▓▓▓▓▓▓▓▓ │     │ Fecha      18/07/2026     ✓  │\n│   │ ▓▓▓▓▓▓▓▓▓▓▓ │     │ Subtotal   $ 24,500.00    ✓  │\n│   │ ▓▓▓▓▓▓▓▓▓▓▓ │     │ ITBIS      $  4,410.00    ⚠️ │\n│   │ ▓▓▓▓▓▓▓▓▓▓▓ │     │   └ poco legible, verifica   │\n│   └─────────────┘     │ TOTAL      $ 28,910.00       │\n│                       │                              │\n│   [🔍 Acercar]        │ 4 lineas detectadas      [▾] │\n│                       │                              │\n│                       │ [Rechazar]      [Aprobar]    │\n└───────────────────────┴──────────────────────────────┘"
    },
    {
      "titulo":"Subir desde el celular",
      "descripcion":"El caso real: fotografias la factura al recibir la mercancia, no tres dias despues.",
      "mockup":"      ┌─────────────────────┐\n      │ ← Capturar factura  │\n      ├─────────────────────┤\n      │ ┌─────────────────┐ │\n      │ │                 │ │\n      │ │   ┌─────────┐   │ │\n      │ │   │         │   │ │\n      │ │   │ FACTURA │   │ │\n      │ │   │         │   │ │\n      │ │   └─────────┘   │ │\n      │ │                 │ │\n      │ │ Encuadra la      │ │\n      │ │ factura completa │ │\n      │ └─────────────────┘ │\n      │                     │\n      │        ( 📷 )       │\n      │                     │\n      │ 3 pendientes de     │\n      │ revisar             │\n      └─────────────────────┘"
    }
  ]'::jsonb,
  faq = '[
    {"p":"¿Que tan bien lee?","r":"En facturas impresas legibles acierta casi siempre. En las borrosas o manuscritas marca los campos dudosos en ambar para que los verifiques. Nunca contabiliza sin que alguien apruebe."},
    {"p":"¿Cuanto cuesta procesar una factura?","r":"Las primeras 100 al mes van incluidas. A partir de ahi son US$0.04 por documento."},
    {"p":"¿Que pasa con las fotos?","r":"Se guardan cifradas y se borran a los 90 dias de aprobada la factura. Contienen RNC y montos de terceros; no hay razon para conservarlas mas."},
    {"p":"¿Necesito el modulo de cuentas por pagar?","r":"No, funciona solo y exportas el resultado. Con cuentas por pagar es mejor: crea la factura directamente."}
  ]'::jsonb
where id = 'invoice-capture';

-- ── Ficha generica para lo que aun no existe ───────────────────────────
update regb.module_catalog
set tagline = 'Este modulo esta en el catalogo pero todavia no se ha construido.',
    problem = 'Cuando este listo, aqui explicaremos exactamente que resuelve.',
    setup_minutes = null
where tagline is null;
