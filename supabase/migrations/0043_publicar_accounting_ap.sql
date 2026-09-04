-- ═══════════════════════════════════════════════════════════════════════
--  0043 — Publicar contabilidad y cuentas por pagar
--
--  `accounting` y `ap` se construyeron y probaron en las migraciones 0041
--  y 0042, pero ninguna de las dos toco regb.module_catalog: seguian con
--  is_published = false desde la siembra original (0009), o sea invisibles
--  en el marketplace. Mismo error que 0024/0039 ya habian corregido para
--  otros modulos -no se repite, se sistematiza aqui-.
--
--  De paso se corrige un `requires`/`recommends` desincronizado: 0009 trae
--  ap con requires='{}' y accounting con recommends='{cost-centers}', pero
--  los manifest.ts reales dicen otra cosa (ap.requires=['purchase-orders'],
--  accounting.recommends=['ar','purchase-orders']). El catalogo es una
--  copia de exhibicion, no la fuente de verdad -pero una copia que miente
--  en el marketplace es peor que no publicar nada-.
-- ═══════════════════════════════════════════════════════════════════════

update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{}',
    recommends   = '{ar,purchase-orders}',
    tagline      = 'Partida doble de verdad: lo contabilizado no se toca',
    problem      = 'Las ventas y las compras quedan cada una en su modulo, pero nadie las traduce a partida doble. Al cerrar el mes no hay mayor ni balanza, y el contador arma todo desde cero en una hoja de calculo, casi siempre tarde.',
    features     = '[
      {"titulo":"Catalogo de cuentas jerarquico","detalle":"Activo, pasivo, capital, ingreso y gasto, con cuentas padre e hijas. El tipo decide solo si la cuenta crece por debito o por credito."},
      {"titulo":"El asiento no cuadra, no se contabiliza","detalle":"Un asiento con el debe distinto al haber se queda en borrador. El boton de contabilizar esta apagado hasta que cuadre al centavo."},
      {"titulo":"Contabilizado es contabilizado","detalle":"Un asiento contabilizado no se edita ni se borra -ni una linea, ni un monto-. Si algo estuvo mal, se hace un asiento de reverso, nunca se toca el original."},
      {"titulo":"Mayor por cuenta","detalle":"El historial completo de cada cuenta, con su saldo corriendo, sin armar nada a mano."},
      {"titulo":"Balanza de comprobacion","detalle":"Total debe contra total haber de todas las cuentas activas, lista para exportar al cierre del mes."}
    ]'::jsonb,
    audience     = '{Contadores,Distribuidoras,"Medianas empresas","Negocios que ya facturan y necesitan estados financieros"}',
    faq          = '[
      {"p":"¿Necesito cuentas por cobrar o por pagar para usar contabilidad?","r":"No. Contabilidad funciona sola con asientos manuales. Cuando actives ar o ap, lo natural es que sus movimientos generen el asiento automaticamente -eso llega despues-."},
      {"p":"¿Puedo corregir un asiento que ya contabilice?","r":"No directamente: esa es la garantia del modulo. Se hace un asiento de reverso que anula el efecto y uno nuevo con el monto correcto, y los dos quedan en el mayor."}
    ]'::jsonb,
    setup_minutes = 20
where id = 'accounting';

update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{purchase-orders}',
    recommends   = '{accounting}',
    tagline      = 'Sabe a quien le debes, cuanto y cuando toca pagar',
    problem      = 'Las facturas de los proveedores llegan por WhatsApp, correo y papel, y se pagan por orden de quien llama primero a reclamar. Nadie sabe el total real que se debe hasta que el proveedor amenaza con dejar de despachar.',
    features     = '[
      {"titulo":"El numero es del proveedor, no tuyo","detalle":"Se registra el numero de factura tal como lo escribio el proveedor -no uno que el sistema invente-, y no deja repetir el mismo numero con el mismo proveedor dos veces."},
      {"titulo":"Retencion capturada, nunca inventada","detalle":"Si la factura lleva retencion, se escribe el monto a mano: el sistema no adivina una formula de la DGII que no le corresponde decidir."},
      {"titulo":"Pagos parciales con limite real","detalle":"Registra abonos y el saldo baja solo, contando la retencion como si fuera un pago mas. No deja pagar de mas por error."},
      {"titulo":"Vencimiento por los dias del proveedor","detalle":"La fecha de pago sale de los dias de credito que tenga ese proveedor, igual que ya calcula cuentas por cobrar con el cliente."},
      {"titulo":"Una factura pagada no se anula","detalle":"Anular solo esta disponible mientras no tenga ningun pago encima -para eso existe la nota de credito del proveedor, no borrar el historial-."}
    ]'::jsonb,
    audience     = '{Distribuidoras,Ferreterias,Colmados,"Negocios que compran a credito a sus proveedores"}',
    faq          = '[
      {"p":"¿Necesito ordenes de compra para usarlo?","r":"Si -comparten la misma ficha de proveedor-. Sin ordenes de compra activo no hay a quien facturarle."},
      {"p":"¿Calcula el monto de la retencion por mi?","r":"No. La retencion depende del tipo de servicio y del proveedor, algo que la DGII no reduce a una formula fija. El sistema la registra y la descuenta del pago; el monto lo decide quien conoce esa factura."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'ap';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id in ('accounting', 'ap')
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'accounting o ap sin precio en los 3 tiers';
  end if;
end $$;
