-- ═══════════════════════════════════════════════════════════════════════
--  0021 — Una sola convencion para la tasa de impuesto: FRACCION
--
--  `products.tax_rate` es numeric(5,4) con check 0..1 (0.18 = 18%), pero
--  `sales_order_lines.tax_rate` nacio en 0020 como numeric(5,2) con default
--  18, o sea porcentaje. Dos convenciones para el mismo concepto en tablas
--  que se copian una a la otra.
--
--  El sintoma: un pedido de RD$5,375 mostraba RD$9.68 de ITBIS en vez de
--  RD$967.50. La linea copiaba 0.18 de products y el codigo, creyendo que
--  la columna estaba en porcentaje, volvia a dividir entre 100 → 0.0018.
--
--  Se unifica en FRACCION porque es lo que ya usa el catalogo, lo que
--  espera @regb/operations/documents.ts y lo que hace imposible el error de
--  "18 vs 0.18": el check 0..1 rechaza un 18 mal puesto en vez de cobrarlo.
-- ═══════════════════════════════════════════════════════════════════════

-- Los datos existentes ya venian copiados de products, o sea ya en fraccion.
-- Se convierte solo lo que este fuera de rango por haberse escrito como
-- porcentaje antes de este arreglo.
update public.sales_order_lines
set tax_rate = tax_rate / 100
where tax_rate > 1;

alter table public.sales_order_lines
  alter column tax_rate type numeric(5,4),
  alter column tax_rate set default 0.18,
  add constraint sales_order_lines_tax_rate_fraccion
    check (tax_rate >= 0 and tax_rate <= 1);

comment on column public.sales_order_lines.tax_rate is
  'ITBIS en FRACCION (0.18 = 18%), igual que products.tax_rate. El check 0..1 convierte el clasico error de escribir 18 en un fallo ruidoso, no en un cobro de 1800%.';

-- Recalcula los totales de los pedidos que se guardaron con la tasa mal
-- interpretada. Se hace en SQL para no depender de que alguien reabra cada
-- pedido en la interfaz.
update public.sales_order_lines l
set line_total = round(
      (l.qty_ordered * l.unit_price) * (1 - l.discount_pct / 100) * (1 + l.tax_rate), 2)
where true;

update public.sales_orders o
set subtotal = t.subtotal,
    discount = t.discount,
    tax      = t.tax,
    total    = t.subtotal - t.discount + t.tax
from (
  select order_id,
         round(sum(qty_ordered * unit_price), 2)                              as subtotal,
         round(sum(qty_ordered * unit_price * discount_pct / 100), 2)          as discount,
         round(sum(qty_ordered * unit_price * (1 - discount_pct / 100) * tax_rate), 2) as tax
  from public.sales_order_lines
  group by order_id
) t
where t.order_id = o.id;
