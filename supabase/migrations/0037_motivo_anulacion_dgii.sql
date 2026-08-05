-- ═══════════════════════════════════════════════════════════════════════
--  0037 · El motivo de anulacion que pide la DGII
-- ═══════════════════════════════════════════════════════════════════════
--
--  Al anular un ticket o una factura se guardaba el motivo EN PALABRAS
--  ("devolucion del cliente"). La DGII pide un CODIGO del 1 al 8 en el
--  campo 3 del 608, y un texto no se puede declarar.
--
--  El generador del archivo ya se niega a producirlo cuando el motivo no
--  es un codigo — mejor no entregar nada que entregar un 608 que la DGII
--  rechaza, porque el contribuyente cree que declaro. Esta migracion pone
--  el dato que faltaba para que si se pueda.
--
--  Los dos campos conviven a proposito:
--    - `void_type`   es lo que se declara.
--    - `void_reason` es lo que se explica en una auditoria interna, y
--      sigue siendo obligatorio: "codigo 6" no le dice nada a nadie
--      dentro de seis meses.
--
--  Las anulaciones que ya existen se quedan SIN codigo, no se les asigna
--  uno inventado. Aparecen en la pantalla como pendientes de clasificar y
--  el archivo del periodo afectado no se genera hasta arreglarlas — que es
--  lo correcto: nadie sabe hoy por que se anularon.
-- ═══════════════════════════════════════════════════════════════════════

drop domain if exists regb.motivo_anulacion cascade;
create domain regb.motivo_anulacion as text
  check (value in ('1', '2', '3', '4', '5', '6', '7', '8'));

comment on domain regb.motivo_anulacion is
  'Codigo de anulacion del 608 segun el instructivo de la DGII: 1 deterioro, 2 errores de impresion, 3 impresion defectuosa, 4 correccion de informacion, 5 cambio de productos, 6 devolucion, 7 omision de productos, 8 errores en secuencia de NCF.';

alter table public.pos_sales
  add column if not exists void_type regb.motivo_anulacion;

alter table public.customer_invoices
  add column if not exists void_type regb.motivo_anulacion;

comment on column public.pos_sales.void_type is
  'Codigo que se declara en el 608. Distinto de void_reason, que es la explicacion para humanos.';
comment on column public.customer_invoices.void_type is
  'Codigo que se declara en el 608. Distinto de void_reason, que es la explicacion para humanos.';

-- ── El 608 pasa a exponer el codigo ─────────────────────────────────────
--  `motivo` deja de ser texto libre y devuelve el codigo, que es lo que
--  espera el generador. Se conserva `explicacion` para la pantalla: un
--  contador mirando "6" a secas no sabe de que venta habla.
--
--  Se suelta antes de recrear: `create or replace view` no puede cambiar
--  el TIPO de una columna existente, y `motivo` pasa de texto libre al
--  dominio del codigo.
drop view if exists public.dgii_608;
create view public.dgii_608 as
select
  i.tenant_id,
  'factura'                            as origen,
  to_char(i.issue_date, 'YYYYMM')      as periodo,
  i.ncf,
  i.ncf_type,
  to_char(i.issue_date, 'YYYYMMDD')    as fecha_comprobante,
  i.void_type                          as motivo,
  coalesce(i.void_reason, 'anulada')   as explicacion
from public.customer_invoices i
where i.ncf is not null
  and i.status = 'void'

union all

select
  s.tenant_id,
  'caja',
  to_char(s.created_at, 'YYYYMM'),
  s.ncf,
  s.ncf_type,
  to_char(s.created_at, 'YYYYMMDD'),
  s.void_type,
  coalesce(s.void_reason, 'anulada')
from public.pos_sales s
where s.ncf is not null
  and s.voided;

alter view public.dgii_608 set (security_invoker = true);

comment on view public.dgii_608 is
  'Comprobantes anulados (608). `motivo` es el CODIGO que se declara —nulo si nadie lo clasifico— y `explicacion` el texto para humanos.';
