-- ═══════════════════════════════════════════════════════════════════════
--  0033 · Ventas offline (F5 · S23)
-- ═══════════════════════════════════════════════════════════════════════
--
--  La puerta de F5 no la pasa una UI bonita: la pasa desconectar el cable
--  de verdad, vender ocho horas y que al reconectar cuadre sin duplicar ni
--  una venta. Eso se decide aqui, no en la app de escritorio.
--
--  El mecanismo es el mismo que ya usa la facturacion desde la 0014: una
--  clave de idempotencia generada por el CLIENTE. La caja crea un uuid al
--  cobrar —esté online o no— y lo manda siempre. Si la venta ya entro, el
--  insert choca contra el indice unico y la sincronizacion devuelve la que
--  ya existe en vez de crear otra.
--
--  Por que del cliente y no del servidor: cuando la respuesta se pierde
--  por un corte, la caja NO SABE si la venta entro. Reintentar es lo unico
--  que puede hacer, y sin una clave suya el reintento crea un duplicado.
--  Es exactamente el caso que provoca el descuadre a las 6 de la tarde.
--
--  ── Lo que NO se resuelve offline, y hay que decirlo ──────────────────
--
--  El NUMERO de ticket y el NCF salen de secuencias en la base, asi que
--  una venta offline no puede tener ninguno de los dos hasta sincronizar.
--  El ticket que sale del papel en ese momento lleva su referencia local y
--  dice que el comprobante fiscal esta pendiente.
--
--  Para un colmado que vende a consumidor final esto es aceptable: el
--  cliente se lleva su ticket y el NCF entra al 607 al reconectar. Para
--  quien factura a credito fiscal offline hace falta reservar bloques de
--  NCF por terminal — eso es el paso siguiente, no este.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.pos_sales
  add column if not exists client_ref uuid,
  add column if not exists sold_at timestamptz,
  add column if not exists synced_at timestamptz;

-- La hora REAL de la venta, no la de sincronizacion. Sin esto, ocho horas
-- de ventas offline aparecen todas juntas al reconectar y el arqueo por
-- turno deja de tener sentido.
update public.pos_sales set sold_at = created_at where sold_at is null;
alter table public.pos_sales alter column sold_at set default now();
alter table public.pos_sales alter column sold_at set not null;

-- Parcial: las ventas hechas online no llevan referencia y no deben
-- ocupar espacio en el indice.
create unique index if not exists pos_sales_client_ref_uk
  on public.pos_sales (tenant_id, client_ref)
  where client_ref is not null;

comment on column public.pos_sales.client_ref is
  'Clave de idempotencia generada por la caja. Un reintento tras un corte reusa la misma y no duplica la venta.';
comment on column public.pos_sales.sold_at is
  'Cuando se cobro de verdad. Distinto de created_at cuando la venta se hizo sin conexion.';
comment on column public.pos_sales.synced_at is
  'Cuando llego al servidor. Nulo = nacio online.';

-- ── Consulta de reconciliacion ──────────────────────────────────────────
--  Lo primero que se pregunta al reconectar no es "¿cuantas subieron?"
--  sino "¿cual NO subio?". Esta vista responde eso: ventas que llegaron
--  desde una caja offline, con el desfase entre cobro y sincronizacion.
create or replace view public.pos_ventas_offline as
select
  s.tenant_id,
  s.id,
  s.number,
  s.client_ref,
  s.sold_at,
  s.synced_at,
  extract(epoch from (s.synced_at - s.sold_at))::int as desfase_segundos,
  s.total,
  s.ncf,
  s.voided
from public.pos_sales s
where s.client_ref is not null;

alter view public.pos_ventas_offline set (security_invoker = true);

comment on view public.pos_ventas_offline is
  'Ventas que nacieron sin conexion, con el desfase entre el cobro y su llegada al servidor. Para cuadrar despues de un corte.';
