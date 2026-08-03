-- ═══════════════════════════════════════════════════════════════════════
--  0028 · Normalizar RNC/cedula a digitos
-- ═══════════════════════════════════════════════════════════════════════
--
--  El 607 decide el tipo de identificacion por la LONGITUD: 9 = RNC,
--  11 = cedula. Guardado con guiones, un RNC de 9 digitos mide 11
--  caracteres y se reportaba como cedula.
--
--  Ese error no se ve en pantalla —la UI formatea igual— y no aparece
--  hasta que la DGII rechaza el archivo. Se ataca por los dos lados:
--
--  1. Los datos ya guardados se normalizan a digitos.
--  2. Las vistas cuentan digitos, no caracteres, para que un dato viejo o
--     importado con guiones tampoco pueda torcer el reporte.
--
--  La UI sigue mostrandolo formateado (`formatTaxId`): el guion es
--  presentacion, no dato.
-- ═══════════════════════════════════════════════════════════════════════

update public.customers
set tax_id = regexp_replace(tax_id, '\D', '', 'g')
where tax_id is not null and tax_id ~ '\D';

update public.companies
set tax_id = regexp_replace(tax_id, '\D', '', 'g')
where tax_id is not null and tax_id ~ '\D';

update public.customer_invoices
set buyer_tax_id = regexp_replace(buyer_tax_id, '\D', '', 'g')
where buyer_tax_id is not null and buyer_tax_id ~ '\D';

-- ── Vistas: contar digitos, no caracteres ───────────────────────────────
drop view if exists public.dgii_607;

create view public.dgii_607 as
with base as (
  select
    i.tenant_id,
    'factura'                                                    as origen,
    to_char(i.issue_date, 'YYYYMM')                              as periodo,
    regexp_replace(coalesce(i.buyer_tax_id, c.tax_id), '\D', '', 'g') as rnc,
    i.ncf,
    i.ncf_type,
    to_char(i.issue_date, 'YYYYMMDD')                            as fecha_comprobante,
    i.subtotal - i.discount                                      as monto_facturado,
    i.tax                                                        as itbis_facturado,
    i.total
  from public.customer_invoices i
  left join public.customers c on c.id = i.customer_id
  where i.ncf is not null and i.status <> 'void'

  union all

  select
    s.tenant_id,
    'caja',
    to_char(s.created_at, 'YYYYMM'),
    regexp_replace(c.tax_id, '\D', '', 'g'),
    s.ncf,
    s.ncf_type,
    to_char(s.created_at, 'YYYYMMDD'),
    s.subtotal - s.discount,
    s.tax,
    s.total
  from public.pos_sales s
  left join public.customers c on c.id = s.customer_id
  where s.ncf is not null and not s.voided
)
select
  tenant_id, origen, periodo,
  nullif(rnc, '')                            as rnc_comprador,
  case when length(rnc) = 9  then '1'
       when length(rnc) = 11 then '2'
       else '3' end                          as tipo_identificacion,
  ncf, ncf_type, fecha_comprobante,
  monto_facturado, itbis_facturado, total
from base;

comment on view public.dgii_607 is
  'Ventas del periodo (607): facturas a credito Y ventas de caja, con NCF, sin las anuladas. El RNC se cuenta en digitos: con guiones, uno de 9 medía 11 y se reportaba como cedula.';
