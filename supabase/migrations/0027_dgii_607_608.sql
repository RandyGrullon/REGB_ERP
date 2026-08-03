-- ═══════════════════════════════════════════════════════════════════════
--  0027 · Reportes DGII: 607 completo y 608 de anulados
-- ═══════════════════════════════════════════════════════════════════════
--
--  Dos correcciones a la base fiscal de 0026.
--
--  1. El 607 solo miraba `customer_invoices`. Desde que la caja emite NCF,
--     un colmado que vende solo por mostrador reportaria CERO ventas a la
--     DGII teniendo cientos de comprobantes emitidos. El 607 declara las
--     ventas del periodo, no las facturas a credito: tiene que unir ambas
--     fuentes.
--
--  2. Faltaba el 608. Un NCF consumido nunca vuelve, ni aunque se anule la
--     venta — la DGII espera verlo declarado como anulado, no
--     desaparecido. Sin el 608 un comprobante anulado queda como un hueco
--     en la secuencia, y un hueco es exactamente lo que dispara una
--     fiscalizacion.
--
--  Ambos se exponen como vistas para que `e-invoice` (F6) solo tenga que
--  serializar, no recalcular. Heredan la RLS de sus tablas base.
-- ═══════════════════════════════════════════════════════════════════════

drop view if exists public.dgii_607;

-- ── 607 · Ventas del periodo ────────────────────────────────────────────
--  Las anuladas SALEN de aqui: van al 608. Declarar una venta anulada como
--  venta es declarar ingresos que no existieron.
create view public.dgii_607 as
select
  i.tenant_id,
  'factura'                                           as origen,
  to_char(i.issue_date, 'YYYYMM')                     as periodo,
  coalesce(i.buyer_tax_id, c.tax_id)                  as rnc_comprador,
  case when length(coalesce(i.buyer_tax_id, c.tax_id)) = 9 then '1'
       when length(coalesce(i.buyer_tax_id, c.tax_id)) = 11 then '2'
       else '3' end                                   as tipo_identificacion,
  i.ncf,
  i.ncf_type,
  to_char(i.issue_date, 'YYYYMMDD')                   as fecha_comprobante,
  i.subtotal - i.discount                             as monto_facturado,
  i.tax                                               as itbis_facturado,
  i.total
from public.customer_invoices i
left join public.customers c on c.id = i.customer_id
where i.ncf is not null
  and i.status <> 'void'

union all

-- El mostrador. `customer_id` es opcional: el consumidor final no tiene
-- RNC y va con tipo de identificacion 3, que es lo correcto para un B02.
select
  s.tenant_id,
  'caja'                                              as origen,
  to_char(s.created_at, 'YYYYMM')                     as periodo,
  c.tax_id                                            as rnc_comprador,
  case when length(c.tax_id) = 9 then '1'
       when length(c.tax_id) = 11 then '2'
       else '3' end                                   as tipo_identificacion,
  s.ncf,
  s.ncf_type,
  to_char(s.created_at, 'YYYYMMDD')                   as fecha_comprobante,
  s.subtotal - s.discount                             as monto_facturado,
  s.tax                                               as itbis_facturado,
  s.total
from public.pos_sales s
left join public.customers c on c.id = s.customer_id
where s.ncf is not null
  and not s.voided;

comment on view public.dgii_607 is
  'Ventas del periodo (607): facturas a credito Y ventas de caja, ambas con NCF, sin las anuladas. Las anuladas van al 608.';

-- ── 608 · Comprobantes anulados ─────────────────────────────────────────
--  Un NCF consumido no vuelve. Si se anula la venta, el numero se declara
--  aqui: para la DGII un hueco en la secuencia es una alerta, un anulado
--  declarado es un tramite normal.
create view public.dgii_608 as
select
  i.tenant_id,
  'factura'                            as origen,
  to_char(i.issue_date, 'YYYYMM')      as periodo,
  i.ncf,
  i.ncf_type,
  to_char(i.issue_date, 'YYYYMMDD')    as fecha_comprobante,
  coalesce(i.void_reason, 'anulada')   as motivo
from public.customer_invoices i
where i.ncf is not null
  and i.status = 'void'

union all

select
  s.tenant_id,
  'caja'                               as origen,
  to_char(s.created_at, 'YYYYMM')      as periodo,
  s.ncf,
  s.ncf_type,
  to_char(s.created_at, 'YYYYMMDD')    as fecha_comprobante,
  coalesce(s.void_reason, 'anulada')   as motivo
from public.pos_sales s
where s.ncf is not null
  and s.voided;

comment on view public.dgii_608 is
  'Comprobantes anulados (608). Se declara el NCF, no se omite: un hueco en la secuencia dispara fiscalizacion.';
