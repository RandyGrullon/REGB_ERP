-- ═══════════════════════════════════════════════════════════════════════
--  0129 — Lo fiscal se declara con el dia de RD, la base neta y sin `ar`
--
--  Cinco cosas que salian mal SIN que nada fallara. El 607 se generaba,
--  el IT-1 cuadraba consigo mismo, y el error lo encontraba la DGII.
--
--  1. El 607 restaba el descuento DOS veces. `documentTotals()`
--     (packages/operations/src/documents.ts) guarda el `subtotal` YA neto
--     de descuento, y la vista hacia `subtotal - discount`: un ticket de
--     1,000 con 10% (subtotal 900, ITBIS 162) se declaraba con 800 de
--     base. El seed usa la convencion contraria (subtotal bruto), y por eso
--     la demo no lo enseñaba. La base declarable es `total - tax` en LAS
--     DOS convenciones: es lo que se cobro menos el ITBIS, y no depende de
--     como se haya guardado el subtotal.
--
--  2. Las fechas iban en UTC. La base corre en `Etc/UTC` y RD en UTC-4:
--     una venta del 30 a las 9 p. m. caia el 1, en el 607 y el IT-1 del mes
--     siguiente. Y la caja se fechaba con `created_at`, que en una venta
--     offline es la hora de SINCRONIZAR, no la de vender (`sold_at`).
--     `public.fecha_fiscal()` es la unica regla; `hoy_fiscal()` reemplaza
--     a `current_date` donde la fecha decide un periodo o una vigencia.
--
--  3. Las secuencias NCF (hallazgo 19). Registrar una nueva desactivaba la
--     anterior aunque le quedaran numeros, no se validaban cruces y no se
--     podia corregir el vencimiento sin volver a cargar el rango -que
--     reiniciaba el proximo numero y trancaba la caja con NCF repetidos-.
--     Ahora conviven, se consumen en orden, un rango que pisa a otro se
--     rechaza, y el vencimiento o la baja se cambian con motivo y quedan
--     en la bitacora.
--
--  4. Un colmado con solo `pos` podia ESCRIBIR secuencias por la politica
--     `tenant_pos`... cualquier usuario suyo: la politica no miraba el
--     permiso, asi que un cajero con su token de PostgREST cargaba,
--     apagaba o reiniciaba rangos. La carga pide ahora el permiso de quien
--     administra comprobantes en cualquiera de los dos modulos que emiten:
--     `ar.invoice.create` o el nuevo `pos.ncf.manage`.
--
--  5. El 606 aceptaba ISR retenido sin su tipo (campo 17), que el archivo
--     no puede declarar.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. La fecha fiscal ──────────────────────────────────────────────────
--  Santo Domingo y no la zona del tenant: esto decide periodos ante la
--  DGII, que es dominicana por definicion. RD no cambia de hora, pero se
--  usa el nombre de la zona y no un -4 fijo para que el dia que cambie lo
--  resuelva la base de zonas horarias y no una migracion.
--
--  Es la MISMA regla que `fechaFiscal()` en packages/operations/src/dgii.ts.
create or replace function public.fecha_fiscal(p_momento timestamptz)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (p_momento at time zone 'America/Santo_Domingo')::date
$$;

comment on function public.fecha_fiscal(timestamptz) is
  'El dia calendario en Santo Domingo. Una venta del 30 a las 9 p. m. es del 30 aunque en UTC ya sea el 1 (0129).';

create or replace function public.hoy_fiscal()
returns date
language sql
stable
set search_path = ''
as $$
  select public.fecha_fiscal(now())
$$;

comment on function public.hoy_fiscal() is
  'Hoy en Santo Domingo. Sustituye a current_date donde la fecha decide un periodo fiscal o una vigencia: current_date es el dia de UTC y desde las 8 p. m. de RD ya es mañana.';

grant execute on function public.fecha_fiscal(timestamptz) to authenticated;
grant execute on function public.hoy_fiscal() to authenticated;

-- Una factura que se emite sin fecha explicita es de HOY en RD.
alter table public.customer_invoices alter column issue_date set default public.hoy_fiscal();
alter table public.supplier_invoices alter column issue_date set default public.hoy_fiscal();

-- ── 2. 607: base neta y fecha de RD ─────────────────────────────────────
--  Mismas columnas y en el mismo orden que la 0028, para que `create or
--  replace` conserve permisos y dependencias. Cambian dos cosas:
--    · monto_facturado = total - tax (ver cabecera, punto 1),
--    · la caja se fecha con `sold_at` en hora de RD (punto 2).
create or replace view public.dgii_607
with (security_invoker = true) as
with base as (
  select
    i.tenant_id,
    'factura'                                                    as origen,
    to_char(i.issue_date, 'YYYYMM')                              as periodo,
    regexp_replace(coalesce(i.buyer_tax_id, c.tax_id), '\D', '', 'g') as rnc,
    i.ncf,
    i.ncf_type,
    to_char(i.issue_date, 'YYYYMMDD')                            as fecha_comprobante,
    i.total - i.tax                                              as monto_facturado,
    i.tax                                                        as itbis_facturado,
    i.total
  from public.customer_invoices i
  left join public.customers c on c.id = i.customer_id
  where i.ncf is not null and i.status <> 'void'

  union all

  select
    s.tenant_id,
    'caja',
    to_char(public.fecha_fiscal(s.sold_at), 'YYYYMM'),
    regexp_replace(c.tax_id, '\D', '', 'g'),
    s.ncf,
    s.ncf_type,
    to_char(public.fecha_fiscal(s.sold_at), 'YYYYMMDD'),
    s.total - s.tax,
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
  'Ventas del periodo (607): facturas a credito Y ventas de caja, con NCF, sin las anuladas. monto_facturado = total - ITBIS (el subtotal ya viene neto de descuento: restarlo otra vez declaraba de menos). La caja se fecha con sold_at en hora de RD (0129).';

-- ── 3. 608: la misma fecha que el 607 ───────────────────────────────────
create or replace view public.dgii_608
with (security_invoker = true) as
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
  to_char(public.fecha_fiscal(s.sold_at), 'YYYYMM'),
  s.ncf,
  s.ncf_type,
  to_char(public.fecha_fiscal(s.sold_at), 'YYYYMMDD'),
  s.void_type,
  coalesce(s.void_reason, 'anulada')
from public.pos_sales s
where s.ncf is not null
  and s.voided;

comment on view public.dgii_608 is
  'Comprobantes anulados (608). `motivo` es el CODIGO que se declara -nulo si nadie lo clasifico- y `explicacion` el texto para humanos. Fecha del comprobante en hora de RD, igual que el 607 (0129).';

-- ── 4. 606: la fecha de pago tambien es de RD ───────────────────────────
--  `paid_at` es un instante: un pago del 30 a las 9:30 p. m. se declaraba
--  el 1. Igual que la 0099 en todo lo demas.
create or replace view public.dgii_606
with (security_invoker = true) as
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
  to_char(public.fecha_fiscal(p.ultimo_pago), 'YYYYMMDD') as fecha_pago,
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
  'Compras del periodo en el formato del 606. tipo_gasto viene NULO cuando la factura no se ha clasificado: el exportador debe negarse a generar el TXT en ese caso, no inventar un codigo. itbis_retenido y retencion_renta son columnas distintas: el IT-1 solo suma la primera (0129).';

-- ISR retenido sin su tipo no se puede declarar: el campo 17 del 606 es
-- obligatorio cuando el 18 trae monto. NOT VALID: lo que ya existe se ve
-- en pantalla y se corrige a mano; lo que entra desde hoy, entra completo.
alter table public.supplier_invoices drop constraint if exists isr_con_tipo;
alter table public.supplier_invoices
  add constraint isr_con_tipo check (isr_retained = 0 or isr_retention_type is not null) not valid;

-- ═══════════════════════════════════════════════════════════════════════
--  5. Secuencias NCF
-- ═══════════════════════════════════════════════════════════════════════

-- Varias del mismo tipo pueden estar vigentes a la vez: la DGII autoriza
-- un rango nuevo ANTES de que se acabe el anterior, y apagar el viejo
-- tiraba los numeros que le quedaban.
drop index if exists public.ncf_sequences_one_active_idx;

create index if not exists ncf_sequences_orden_idx
  on public.ncf_sequences (tenant_id, ncf_type, range_from) where is_active;

-- El rastro de un ajuste a mano. La historia completa (antes y despues)
-- la guarda audit.log; aqui queda el ultimo motivo, que es el que se ve
-- en pantalla junto a la secuencia.
alter table public.ncf_sequences
  add column if not exists adjusted_reason text,
  add column if not exists adjusted_at     timestamptz,
  add column if not exists adjusted_by     uuid;

comment on column public.ncf_sequences.adjusted_reason is
  'Motivo del ultimo ajuste a mano (vencimiento corregido o baja). Solo lo escribe ajustar_secuencia_ncf(); el historial completo esta en audit.log (0129).';

-- ── Un rango no pisa a otro ─────────────────────────────────────────────
--  Dos reglas, porque son dos riesgos distintos:
--    · contra una VIGENTE del mismo tipo: ningun cruce. Con dos rangos que
--      se pisan, el mismo NCF saldria de las dos.
--    · contra cualquier otra, vigente o no: los numeros YA EMITIDOS
--      (range_from .. next_number - 1) no se vuelven a cargar. Lo que una
--      desactivada nunca uso si se puede volver a cargar -es la forma de
--      corregir un rango mal digitado-.
--
--  Trigger y no un EXCLUDE: la segunda regla depende de `next_number`, y
--  la primera sola necesitaria btree_gist. El candado por tipo serializa
--  dos altas simultaneas, que de otro modo no se verian entre si.
--
--  SECURITY DEFINER porque tiene que ver TODAS las secuencias del cliente,
--  no solo las que la RLS de quien carga le deja ver. El `where` fija el
--  tenant de la fila nueva, que la politica de insert ya comprobo.
create or replace function public.ncf_rango_sin_cruce()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_otro public.ncf_sequences;
begin
  if not new.is_active then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ncf:' || new.tenant_id::text || ':' || coalesce(new.company_id, new.tenant_id)::text
      || ':' || new.ncf_type, 0));

  select o.* into v_otro
  from public.ncf_sequences o
  where o.tenant_id = new.tenant_id
    and coalesce(o.company_id, o.tenant_id) = coalesce(new.company_id, new.tenant_id)
    and o.ncf_type = new.ncf_type
    and o.id <> new.id
    and o.is_active
    and o.range_from <= new.range_to and new.range_from <= o.range_to
  order by o.range_from
  limit 1;

  if found then
    raise exception 'El rango % - % de % se cruza con el % - % que ya esta vigente. Con dos rangos que se pisan, el mismo NCF saldria dos veces.',
      new.range_from, new.range_to, new.ncf_type, v_otro.range_from, v_otro.range_to
      using errcode = '23P01';
  end if;

  select o.* into v_otro
  from public.ncf_sequences o
  where o.tenant_id = new.tenant_id
    and coalesce(o.company_id, o.tenant_id) = coalesce(new.company_id, new.tenant_id)
    and o.ncf_type = new.ncf_type
    and o.id <> new.id
    and o.next_number > o.range_from
    and o.range_from <= new.range_to and new.range_from <= o.next_number - 1
  order by o.range_from
  limit 1;

  if found then
    raise exception 'Los numeros % - % de % ya se emitieron con otra secuencia: volver a cargarlos repetiria NCF. Carga solo lo que no se ha usado.',
      greatest(v_otro.range_from, new.range_from), least(v_otro.next_number - 1, new.range_to),
      new.ncf_type
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

drop trigger if exists ncf_rango_sin_cruce on public.ncf_sequences;
create trigger ncf_rango_sin_cruce
  before insert or update of range_from, range_to, is_active, ncf_type, company_id
  on public.ncf_sequences
  for each row execute function public.ncf_rango_sin_cruce();

-- ── El proximo numero solo lo mueve la emision ──────────────────────────
--  Hacia atras repite NCF (y la caja se tranca contra el indice unico);
--  hacia adelante deja huecos, que es lo que dispara una fiscalizacion.
--  `assign_ncf` levanta una marca de transaccion antes de avanzar; un
--  UPDATE directo -desde la app o con un token por PostgREST- no la trae.
--  Sin tenant en los claims es el sistema (seed, migraciones, pruebas).
create or replace function public.ncf_proximo_solo_avanza()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if rls.tenant_id() is null then
    return new;
  end if;

  if new.next_number is distinct from old.next_number
     and (coalesce(current_setting('regb.ncf_emitiendo', true), '') <> 'si'
          or new.next_number <> old.next_number + 1) then
    raise exception 'El proximo numero de una secuencia NCF solo lo avanza la emision de un comprobante, de uno en uno: moverlo a mano repite NCF o deja huecos.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists ncf_proximo_solo_avanza on public.ncf_sequences;
create trigger ncf_proximo_solo_avanza
  before update of next_number on public.ncf_sequences
  for each row execute function public.ncf_proximo_solo_avanza();

-- ── Privilegios: leer, cargar y avanzar. Nada mas ───────────────────────
--  El UPDATE de columna sobre `next_number` es lo que deja al cajero hacer
--  `select ... for update` antes de vender (pos/actions.ts): sin UPDATE en
--  al menos una columna, Postgres no deja bloquear la fila. El resto de
--  los cambios -vencimiento, baja- van por ajustar_secuencia_ncf(), que
--  pide motivo. Borrar no: su historial es de auditoria.
revoke update, delete on public.ncf_sequences from authenticated;
grant update (next_number) on public.ncf_sequences to authenticated;

-- ── RLS: la politica mira el permiso, no solo el modulo ─────────────────
--  Leer: cualquiera de los dos modulos que emiten, como hasta hoy -el
--  cajero tiene que saber si hay NCF antes de cobrar-.
--  Cargar: quien administra comprobantes en ese modulo.
--  Avanzar: lo mismo que leer; el trigger de arriba decide COMO.
drop policy if exists tenant_ar on public.ncf_sequences;
drop policy if exists tenant_pos on public.ncf_sequences;
drop policy if exists registrar_ar on public.ncf_sequences;
drop policy if exists registrar_pos on public.ncf_sequences;
drop policy if exists avanzar_ar on public.ncf_sequences;
drop policy if exists avanzar_pos on public.ncf_sequences;

create policy tenant_ar on public.ncf_sequences
  for select
  using (tenant_id = rls.tenant_id() and rls.module_active('ar'));

create policy tenant_pos on public.ncf_sequences
  for select
  using (tenant_id = rls.tenant_id() and rls.module_active('pos'));

create policy registrar_ar on public.ncf_sequences
  for insert
  with check (tenant_id = rls.tenant_id() and rls.module_active('ar')
              and rls.has_perm('ar.invoice.create'));

create policy registrar_pos on public.ncf_sequences
  for insert
  with check (tenant_id = rls.tenant_id() and rls.module_active('pos')
              and rls.has_perm('pos.ncf.manage'));

create policy avanzar_ar on public.ncf_sequences
  for update
  using (tenant_id = rls.tenant_id() and rls.module_active('ar'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('ar'));

create policy avanzar_pos on public.ncf_sequences
  for update
  using (tenant_id = rls.tenant_id() and rls.module_active('pos'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('pos'));

-- ── Emitir: la vigente mas antigua con numeros, de a una ────────────────
--  "Mas antigua" es la de rango mas bajo -la DGII autoriza rangos
--  crecientes- y, a igualdad, la que se cargo primero. Asi el NCF sigue
--  subiendo aunque haya dos autorizaciones vivas.
--
--  Si dos cajas agotan a la vez la primera, a la segunda el `for update`
--  le devuelve cero filas (la fila ya no cumple el `where`) aunque haya
--  otra vigente: por eso se reintenta con una foto nueva.
create or replace function public.assign_ncf(
  p_tenant  uuid,
  p_type    text,
  p_company uuid default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq     public.ncf_sequences;
  v_hoy     date := public.hoy_fiscal();
  v_numero  integer;
  v_digitos integer;
  v_intento integer;
  -- Variable propia y no FOUND: al terminar, un FOR deja FOUND en true
  -- aunque ninguna vuelta encontrara nada, y la funcion devolvia NULL
  -- como si fuera un NCF.
  v_hay     boolean := false;
begin
  -- Lo primero, antes de tocar nada: esta funcion elude la RLS por
  -- definicion, asi que el chequeo de pertenencia lo tiene que hacer ella.
  if p_tenant is distinct from rls.tenant_id() then
    raise exception 'No puedes emitir comprobantes de otro cliente.'
      using errcode = '42501';
  end if;

  for v_intento in 1 .. 3 loop
    select * into v_seq
    from public.ncf_sequences
    where tenant_id = p_tenant
      and ncf_type = p_type
      and is_active
      and (company_id = p_company or (company_id is null and p_company is null))
      and expires_on >= v_hoy
      and next_number <= range_to
    order by range_from, created_at
    limit 1
    for update;

    v_hay := found;
    exit when v_hay;
  end loop;

  if not v_hay then
    -- El motivo que se puede ACTUAR: cargar una autorizacion, pedir una
    -- nueva porque vencio, o porque se acabaron los numeros.
    select * into v_seq
    from public.ncf_sequences
    where tenant_id = p_tenant and ncf_type = p_type and is_active
      and (company_id = p_company or (company_id is null and p_company is null))
      and expires_on < v_hoy and next_number <= range_to
    order by expires_on desc
    limit 1;

    if found then
      raise exception 'La secuencia de % vencio el %. Pide una autorizacion nueva a la DGII.',
        p_type, v_seq.expires_on using errcode = 'P0003';
    end if;

    select * into v_seq
    from public.ncf_sequences
    where tenant_id = p_tenant and ncf_type = p_type and is_active
      and (company_id = p_company or (company_id is null and p_company is null))
    order by range_to desc
    limit 1;

    if found then
      raise exception 'Se agotaron los NCF de % (rango % - %). Pide una autorizacion nueva.',
        p_type, v_seq.range_from, v_seq.range_to using errcode = 'P0004';
    end if;

    raise exception 'No hay secuencia activa de % para este cliente. Registra la autorizacion de la DGII.', p_type
      using errcode = 'P0002';
  end if;

  v_numero := v_seq.next_number;

  perform set_config('regb.ncf_emitiendo', 'si', true);
  update public.ncf_sequences
  set next_number = next_number + 1
  where id = v_seq.id;
  perform set_config('regb.ncf_emitiendo', '', true);

  -- La serie E lleva 10 digitos; la B, 8. Igual que formatNcf() en
  -- packages/operations/src/dgii.ts.
  v_digitos := case when left(p_type, 1) = 'E' then 10 else 8 end;
  return p_type || lpad(v_numero::text, v_digitos, '0');
end;
$$;

comment on function public.assign_ncf(uuid, text, uuid) is
  'Consume el proximo NCF de forma atomica, solo del cliente que llama, de la vigente mas antigua con numeros (0129). Vigente = no vencida en hora de RD. Irreversible: un numero usado no vuelve, ni aunque se anule la factura (va al 608).';

-- ── Ajustar a mano: vencimiento o baja, con motivo ──────────────────────
--  La unica puerta para cambiar una secuencia ya cargada. No toca rangos
--  ni el proximo numero: lo emitido, emitido esta.
--
--  SECURITY DEFINER porque authenticated ya no tiene UPDATE sobre esas
--  columnas (ver arriba). Por eso mismo comprueba ella el tenant y el
--  permiso: la RLS no la protege.
create or replace function public.ajustar_secuencia_ncf(
  p_id     uuid,
  p_vence  date,
  p_activa boolean,
  p_motivo text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := rls.tenant_id();
  v_seq    public.ncf_sequences;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_tenant is null then
    raise exception 'Sesion no valida.' using errcode = '28000';
  end if;

  select * into v_seq
  from public.ncf_sequences
  where id = p_id and tenant_id = v_tenant
  for update;

  if not found then
    raise exception 'Esa secuencia no existe.' using errcode = 'P0002';
  end if;

  if not ((rls.module_active('ar') and rls.has_perm('ar.invoice.create'))
          or (rls.module_active('pos') and rls.has_perm('pos.ncf.manage'))) then
    raise exception 'Tu rol no puede administrar comprobantes fiscales.' using errcode = '42501';
  end if;

  if v_motivo is null or length(v_motivo) < 4 then
    raise exception 'Escribe el motivo del cambio: queda en la bitacora.' using errcode = '22023';
  end if;

  -- Reactivar no: una baja pudo dejar que se cargara otro rango en su
  -- tramo sin usar. Lo que quedo sin usar se carga como secuencia nueva.
  if coalesce(p_activa, v_seq.is_active) and not v_seq.is_active then
    raise exception 'Una secuencia desactivada no se reactiva. Carga el tramo que no se uso como una secuencia nueva.'
      using errcode = '22023';
  end if;

  if coalesce(p_vence, v_seq.expires_on) = v_seq.expires_on
     and coalesce(p_activa, v_seq.is_active) = v_seq.is_active then
    raise exception 'No cambiaste nada.' using errcode = '22023';
  end if;

  update public.ncf_sequences
  set expires_on      = coalesce(p_vence, expires_on),
      is_active       = coalesce(p_activa, is_active),
      adjusted_reason = v_motivo,
      adjusted_at     = now(),
      adjusted_by     = rls.regb_uid()
  where id = p_id;
end;
$$;

comment on function public.ajustar_secuencia_ncf(uuid, date, boolean, text) is
  'Corrige el vencimiento o da de baja una secuencia NCF, con motivo obligatorio que queda en audit.log. No toca rangos ni el proximo numero (0129).';

revoke all on function public.ajustar_secuencia_ncf(uuid, date, boolean, text) from public;
grant execute on function public.ajustar_secuencia_ncf(uuid, date, boolean, text) to authenticated;

-- Las que se archivaron antes de esta migracion no tienen motivo: se dice
-- de donde salieron en vez de dejarlas en blanco.
update public.ncf_sequences
set adjusted_reason = 'Archivada al registrar otra del mismo tipo (antes de 0129)'
where not is_active and adjusted_reason is null;

-- ═══════════════════════════════════════════════════════════════════════
--  6. Lo que un modulo apagado esconde de una declaracion
--
--  El 607 y el IT-1 suman bajo la RLS de `ar` y de `pos`. Con uno apagado
--  su mitad vuelve en cero y la declaracion sale corta PARECIENDO
--  correcta. Hasta hoy la liquidacion lo evitaba exigiendo `ar`, lo que
--  dejaba a un colmado con solo `pos` sin poder declarar.
--
--  La pregunta correcta no es "tienes `ar`" sino "hay ventas de este
--  periodo que no ves". Solo cuenta, del propio cliente: no devuelve
--  filas ni montos. SECURITY DEFINER porque la respuesta es justo lo que
--  la RLS esconde.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.ventas_fuera_de_vista(p_periodo text)
returns table (modulo text, documentos bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select 'ar'::text, count(*)
  from public.customer_invoices i
  where i.tenant_id = rls.tenant_id()
    and not rls.module_active('ar')
    and to_char(i.issue_date, 'YYYYMM') = p_periodo
  having count(*) > 0

  union all

  select 'pos'::text, count(*)
  from public.pos_sales s
  where s.tenant_id = rls.tenant_id()
    and not rls.module_active('pos')
    and to_char(public.fecha_fiscal(s.sold_at), 'YYYYMM') = p_periodo
  having count(*) > 0
$$;

comment on function public.ventas_fuera_de_vista(text) is
  'Cuantas ventas del periodo tiene el cliente en un modulo apagado. Si devuelve algo, el 607 y el IT-1 saldrian cortos: la app se niega a generarlos (0129).';

revoke all on function public.ventas_fuera_de_vista(text) from public;
grant execute on function public.ventas_fuera_de_vista(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  7. El catalogo conoce los dos permisos nuevos de la caja
--
--  `pos.ncf.manage` carga y ajusta secuencias desde la caja, sin `ar`.
--  `pos.export` baja el 607 y el 608, igual que `ar.export`.
--  Espejo del manifest (0010): lo lee el editor de roles.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set permissions = array(
      select distinct unnest(permissions || array['pos.ncf.manage', 'pos.export'])
      order by 1)
where id = 'pos';
