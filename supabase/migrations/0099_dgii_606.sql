-- ═══════════════════════════════════════════════════════════════════════
--  0099 — Reporte 606: compras de bienes y servicios
--
--  El 606 es obligatorio, mensual, y vence el dia 15. El repo ya tenia
--  el 607 (ventas, 0026) y el 608 (anulados), pero NO el 606 -y sin el
--  un cliente no puede declarar, por muy bien que funcione el mostrador-.
--
--  Las facturas de proveedor (0042) tienen casi todo lo que el 606 pide,
--  pero les faltan tres cosas que la DGII exige y que NO se pueden
--  adivinar:
--
--   1. La clasificacion del gasto (codigo 01-11). Se deja NULA a
--      proposito y sin default: ponerle '09' a todo seria declarar como
--      costo de venta el alquiler del local. Una factura sin clasificar
--      se ve en pantalla como "sin clasificar" y bloquea el TXT con el
--      NCF exacto -mejor no generar el archivo que generarlo mal-.
--   2. Cuanto del monto fue SERVICIOS. Aqui si hay default razonable
--      (cero: todo bienes), que es el caso de un colmado o una
--      ferreteria; quien compre servicios lo corrige.
--   3. Cuanto de lo retenido fue ISR. `retention_amount` ya existia pero
--      es el TOTAL retenido, y el 606 pide ITBIS retenido e ISR retenido
--      en campos distintos. Se agrega el desglose en vez de duplicar el
--      total: ITBIS retenido = retention_amount - isr_retained.
--
--  La forma de pago (campo 23) SI se deriva -de los pagos reales al
--  proveedor-, porque ese dato ya existe y pedirselo otra vez al usuario
--  seria pedirle que repita lo que el sistema ya sabe.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.supplier_invoices
  add column expense_type       text check (expense_type in
    ('01','02','03','04','05','06','07','08','09','10','11')),
  add column services_amount    numeric(12,2) not null default 0 check (services_amount >= 0),
  add column isr_retention_type text check (isr_retention_type in
    ('01','02','03','04','05','06','07','08','09')),
  add column isr_retained       numeric(12,2) not null default 0 check (isr_retained >= 0),
  add column modified_ncf       text;

-- Lo retenido por ISR no puede pasar del total retenido: si pasara, el
-- ITBIS retenido del 606 saldria negativo y el archivo rebota.
alter table public.supplier_invoices
  add constraint isr_dentro_de_retencion check (isr_retained <= retention_amount);

-- La parte de servicios no puede pasar del subtotal: bienes saldria
-- negativo y los campos 8 y 9 no cuadrarian con el 10.
alter table public.supplier_invoices
  add constraint servicios_dentro_del_subtotal check (services_amount <= subtotal);

comment on column public.supplier_invoices.expense_type is
  'Clasificacion de costos y gastos del 606 (codigo 01-11, Norma 07-18). Sin default a proposito: clasificar mal es declarar mal.';
comment on column public.supplier_invoices.services_amount is
  'Parte del subtotal que corresponde a SERVICIOS (campo 8 del 606). El resto son bienes (campo 9).';
comment on column public.supplier_invoices.isr_retained is
  'Cuanto del retention_amount fue retencion de ISR. El resto se declara como ITBIS retenido en el 606.';
comment on column public.supplier_invoices.modified_ncf is
  'NCF que esta factura modifica, solo en notas de credito o debito (campo 5 del 606).';

-- ── Reporte 606: compras del periodo ────────────────────────────────────
--  Misma forma que dgii_607 (0026): una vista que el exportador solo
--  tiene que serializar, no recalcular.
--
--  La forma de pago se deriva de los pagos reales:
--    sin pagos            -> '04' compra a credito
--    un solo metodo       -> el codigo de ese metodo
--    mas de un metodo     -> '07' mixto
--  El 606 pide UN codigo, no columnas de monto como el 607: una compra
--  pagada mitad efectivo y mitad transferencia no se puede partir.
create view public.dgii_606 as
select
  si.tenant_id,
  to_char(si.issue_date, 'YYYYMM')                        as periodo,
  regexp_replace(coalesce(s.tax_id, ''), '\D', '', 'g')   as rnc_proveedor,
  case when length(regexp_replace(coalesce(s.tax_id, ''), '\D', '', 'g')) = 9  then '1'
       when length(regexp_replace(coalesce(s.tax_id, ''), '\D', '', 'g')) = 11 then '2'
       else '3' end                                       as tipo_identificacion,
  s.name                                                  as proveedor,
  si.expense_type                                         as tipo_gasto,
  si.supplier_ncf                                         as ncf,
  si.modified_ncf                                         as ncf_modificado,
  to_char(si.issue_date, 'YYYYMMDD')                      as fecha_comprobante,
  to_char(p.ultimo_pago, 'YYYYMMDD')                      as fecha_pago,
  si.services_amount                                      as monto_servicios,
  si.subtotal - si.services_amount                        as monto_bienes,
  si.subtotal                                             as monto_facturado,
  si.tax                                                  as itbis_facturado,
  si.retention_amount - si.isr_retained                   as itbis_retenido,
  si.isr_retention_type                                   as tipo_retencion_isr,
  si.isr_retained                                         as retencion_renta,
  case
    when p.metodos is null           then '04'
    when array_length(p.metodos, 1) > 1 then '07'
    when p.metodos[1] = 'cash'       then '01'
    when p.metodos[1] = 'check'      then '02'
    when p.metodos[1] = 'transfer'   then '02'
    when p.metodos[1] = 'card'       then '03'
    else '07'
  end                                                     as forma_pago
from public.supplier_invoices si
join public.suppliers s on s.id = si.supplier_id
left join lateral (
  select max(sp.paid_at)               as ultimo_pago,
         array_agg(distinct sp.method) as metodos
  from public.supplier_payments sp
  where sp.invoice_id = si.id
) p on true
where si.supplier_ncf is not null
  and si.status <> 'void';

comment on view public.dgii_606 is
  'Compras del periodo en el formato del 606. tipo_gasto viene NULO cuando la factura no se ha clasificado: el exportador debe negarse a generar el TXT en ese caso, no inventar un codigo.';

-- ── La leccion de la 0030, aplicada de entrada ──────────────────────────
--  Una vista SIN `security_invoker` lee con los permisos de su DUEÑO, no
--  con los de quien consulta: se salta RLS y ensena las compras de todos
--  los clientes a cualquiera. Eso fue exactamente la fuga fiscal que la
--  0030 tuvo que tapar en `dgii_607` y `dgii_608`. Aqui va desde el
--  primer dia, no como parche.
alter view public.dgii_606 set (security_invoker = true);
