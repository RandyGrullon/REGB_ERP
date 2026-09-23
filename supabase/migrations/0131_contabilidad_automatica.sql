-- ═══════════════════════════════════════════════════════════════════════
--  0131 — Contabilidad automatica por eventos (y devoluciones que solo
--         sacan del inventario lo que de verdad entro)
--
--  ── El hallazgo ───────────────────────────────────────────────────────
--
--  Ninguna operacion generaba un asiento. `journal_entries.source_type`
--  solo admitia 'manual' (0041) y los handlers del despachador solo
--  mandaban avisos. Una distribuidora con RD$61K por cobrar y RD$43K por
--  pagar tenia CERO asientos: la balanza mostraba una venta de demo.
--  (Hallazgo 5 del analisis de flujo del 23 sep 2026.)
--
--  ── La decision (ADR 0001) ────────────────────────────────────────────
--
--  Contabilidad ESCUCHA eventos del outbox y escribe su propio asiento.
--  Ninguna accion de venta, cobro o compra llama a contabilidad -eso la
--  obligaria a importar un modulo ajeno y a fallar la venta si el asiento
--  falla-. El despachador (apps/web/src/lib/despachador.ts) lee el
--  documento de origen, `@regb/operations/asientos.ts` decide las lineas
--  por PROPOSITO, y `registrar_asiento_automatico()` (aqui) las traduce
--  con el mapa del cliente y las contabiliza en una sola transaccion:
--
--   · idempotente: un indice unico (tenant, source_type, source_id). El
--     outbox entrega at-least-once; el segundo intento devuelve el
--     asiento que ya existe.
--   · cuadrado: `exigir_partida_doble()` impide pasar a 'posted' un
--     asiento con menos de dos lineas o que no cuadre, por CUALQUIER
--     camino -la accion, esta funcion o un UPDATE a mano-, y que un
--     asiento nazca ya contabilizado (sin lineas, que despues no se le
--     pueden agregar).
--   · inmutable: nace 'posted', y los triggers de 0041 ya no lo dejan
--     tocar.
--   · con degradacion elegante: si el cliente no tiene `accounting`
--     activo, devuelve null y el evento se da por atendido.
--
--  ── Mapa contable ─────────────────────────────────────────────────────
--
--  `accounting_account_map`: para cada PROPOSITO (caja, banco, cxc, ITBIS
--  por pagar...) la cuenta del catalogo de ESE cliente. No habia plantilla
--  dominicana en el repo: `cuentas_contables_por_defecto()` trae un
--  catalogo minimo (14 usos, 13 cuentas) con los codigos que ya usa la
--  demo, y `asegurar_mapa_contable()` crea lo que falte la primera vez que
--  hace falta. La misma tabla vive en TypeScript (PROPOSITOS_CONTABLES);
--  una prueba compara las dos.
--
--  ── Eventos que faltaban ──────────────────────────────────────────────
--
--  Para que contabilidad escuche hace falta que alguien hable. Tres hechos
--  no emitian nada:
--
--   · anular un ticket de caja (`pos.sale.voided` estaba DECLARADO en el
--     manifiesto de pos y nadie lo emitia);
--   · cada cobro y cada pago: `ar.invoice.paid` / `ap.invoice.paid` solo
--     salen cuando la factura queda saldada, y un abono parcial no dejaba
--     rastro;
--   · anular una factura de cliente o de proveedor;
--   · aplicar un cargo por mora (desde 0130 la mora se cobra, y sin su
--     asiento la cartera del mayor quedaba en negativo por ese monto).
--
--  `ar.payment.reversed` y `ar.credit-note.issued` ya los emite la accion
--  de cobrar (0130): se escuchan tal cual.
--
--  Se emiten DESDE LA TABLA, con un trigger AFTER en la misma transaccion
--  del cambio: el evento existe si y solo si el cambio se confirmo, que es
--  la garantia del outbox -y ademas cubre todo camino que escriba la fila
--  (la accion, el movil, una importacion), no solo una pantalla-. No se
--  tocan las acciones de venta/cobro: tienen otro dueno.
--
--  ── Recepciones (hallazgos 2 y 11) ────────────────────────────────────
--
--  `supplier_returns.origin`: una devolucion de lo RECHAZADO no mueve
--  inventario (nunca entro al on_hand); una de lo ACEPTADO si, y solo
--  hasta lo aceptado. `limitar_devolucion()` pone el tope tambien en la
--  base.
--
--  ── Reversion ─────────────────────────────────────────────────────────
--
--  drop trigger emite_pos_sale_voided on public.pos_sales;
--  drop trigger emite_ar_payment_received on public.customer_payments;
--  drop trigger emite_ar_invoice_voided on public.customer_invoices;
--  drop trigger emite_ap_payment_recorded on public.supplier_payments;
--  drop trigger emite_ap_invoice_voided on public.supplier_invoices;
--  drop trigger emite_ar_late_fee_applied on public.invoice_late_fees;
--  drop function public.emitir_evento_de_documento();
--  drop function public.registrar_asiento_automatico(uuid,text,uuid,date,text,jsonb,bigint);
--  drop function public.asegurar_mapa_contable(uuid);
--  drop table public.accounting_account_map;
--  drop function public.validar_mapa_contable();
--  drop function public.cuentas_contables_por_defecto();
--  drop trigger avisar_contabilizado on public.journal_entries;
--  drop function public.avisar_asiento_contabilizado();
--  drop trigger partida_doble_obligatoria on public.journal_entries;
--  drop function public.exigir_partida_doble();
--  (next_journal_entry_number: restaurar el cuerpo de 0041; drop
--   function public.numerar_asiento(uuid).)
--  delete from public.journal_entries where source_type <> 'manual'
--    -- con session_replication_role = replica: estan contabilizados.
--  drop index public.journal_entries_origen_uk;
--  alter table public.journal_entries drop column source_event,
--    drop constraint journal_entries_origen_check,
--    drop constraint journal_entries_source_type_check,
--    add constraint journal_entries_source_type_check check (source_type in ('manual'));
--  drop trigger tope_de_devolucion on public.supplier_returns;
--  drop function public.limitar_devolucion();
--  alter table public.supplier_returns drop column origin;
--  No hay _down aparte: migrate.mjs aplica todo .sql de la carpeta en
--  orden (mismo criterio que 0121).
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  1. El origen de un asiento
-- ═══════════════════════════════════════════════════════════════════════

--  Formato y no lista cerrada: contabilidad no conoce los ids de los
--  modulos (§2.2). Hoy: manual, pos_sale, pos_sale_void, ar_invoice,
--  ar_invoice_void, ar_payment, ar_payment_reversal, ar_credit_note,
--  ar_late_fee, ap_invoice, ap_invoice_void, ap_payment.
alter table public.journal_entries
  drop constraint journal_entries_source_type_check;
alter table public.journal_entries
  add constraint journal_entries_source_type_check
    check (source_type ~ '^[a-z][a-z0-9_]*$');
alter table public.journal_entries
  add constraint journal_entries_origen_check
    check (source_type = 'manual' or source_id is not null);

-- Que evento del outbox lo genero. Sin FK: el outbox se purga, el asiento
-- no.
alter table public.journal_entries add column source_event bigint;

comment on column public.journal_entries.source_type is
  'manual o el documento que lo origino (pos_sale, ar_invoice, ar_payment, ar_credit_note, ar_late_fee, ap_invoice, ap_payment; *_void y ar_payment_reversal para los reversos). Ver 0131.';
comment on column public.journal_entries.source_event is
  'Id del event_outbox que lo genero (asientos automaticos). Sin FK: el outbox se purga.';

--  UN asiento por origen. Es la idempotencia: el outbox entrega
--  at-least-once, y el reintento de un evento ya atendido no puede
--  duplicar una venta en el mayor.
create unique index journal_entries_origen_uk
  on public.journal_entries (tenant_id, source_type, source_id)
  where source_type <> 'manual';

-- ═══════════════════════════════════════════════════════════════════════
--  2. La partida doble, en la base y por cualquier camino
-- ═══════════════════════════════════════════════════════════════════════
--  post_journal_entry() ya validaba, pero solo si se la llamaba. Un
--  `update ... set status = 'posted'` directo, o un insert que nace
--  'posted' (sin lineas, y despues ya no se le pueden agregar), se la
--  saltaban. Ahora la regla vive en la tabla.
create function public.exigir_partida_doble() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lineas   integer;
  v_debitos  numeric(14,2);
  v_creditos numeric(14,2);
begin
  if tg_op = 'INSERT' then
    if new.status = 'posted' then
      raise exception 'Un asiento nace en borrador: se contabiliza despues, cuando sus lineas cuadran.'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if old.status = 'draft' and new.status = 'posted' then
    select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
      into v_lineas, v_debitos, v_creditos
    from public.journal_entry_lines where entry_id = new.id;

    if v_lineas < 2 then
      raise exception 'Un asiento necesita al menos dos lineas.' using errcode = '55000';
    end if;
    if v_debitos <> v_creditos then
      raise exception 'El asiento no cuadra: debito % vs credito %', v_debitos, v_creditos
        using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.exigir_partida_doble() is
  'Nadie contabiliza un asiento que no cuadre o con menos de 2 lineas, por ningun camino; y ninguno nace contabilizado. (0131)';

--  El nombre del TRIGGER importa: Postgres dispara los BEFORE del mismo
--  evento por orden alfabetico, y las guardas de cliente ajeno
--  (`no_empresa_ajena`) y de inmutabilidad (`no_editar_contabilizado`)
--  tienen que hablar primero -su mensaje es el que corresponde-. "p" va
--  despues de "n".
create trigger partida_doble_obligatoria
  before insert or update of status on public.journal_entries
  for each row execute function public.exigir_partida_doble();

--  `accounting.entry.posted` estaba declarado en el manifiesto y nadie lo
--  emitia. Desde la tabla cubre el asiento manual y el automatico.
create function public.avisar_asiento_contabilizado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- security definer: el despachador escribe sin JWT, y la RLS del outbox
  -- compara contra rls.tenant_id(). El tenant sale de la fila, no del
  -- que llama.
  insert into public.event_outbox (tenant_id, type, payload, emitted_by)
  values (new.tenant_id, 'accounting.entry.posted',
          jsonb_build_object('entryId', new.id, 'number', new.number,
                             'sourceType', new.source_type, 'sourceId', new.source_id),
          'accounting');
  return null;
end;
$$;

create trigger avisar_contabilizado
  after update of status on public.journal_entries
  for each row when (old.status = 'draft' and new.status = 'posted')
  execute function public.avisar_asiento_contabilizado();

-- ── Numeracion: una sola implementacion ─────────────────────────────────
--  next_journal_entry_number() es la puerta del usuario (comprueba tenant
--  y modulo contra su JWT). El despachador no tiene JWT: usa la misma
--  cuenta de contador por dentro, sin repetirla.
create function public.numerar_asiento(p_tenant uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from now())::smallint;
  v_n    integer;
begin
  insert into public.journal_entry_counters as c (tenant_id, year, last_n)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;

  return format('AS-%s-%s', v_year, lpad(v_n::text, 5, '0'));
end;
$$;

revoke all on function public.numerar_asiento(uuid) from public, anon, authenticated;

create or replace function public.next_journal_entry_number(p_tenant uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant is distinct from rls.tenant_id() then
    raise exception 'No puedes numerar asientos de otro cliente.' using errcode = '42501';
  end if;
  if not rls.module_active('accounting') then
    raise exception 'El modulo de contabilidad no esta activo: no se entregan numeros.'
      using errcode = '42501';
  end if;
  return public.numerar_asiento(p_tenant);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  3. Mapa contable por cliente
-- ═══════════════════════════════════════════════════════════════════════

--  Espejo de PROPOSITOS_CONTABLES (packages/operations/src/asientos.ts).
--  Un trigger no puede leer TypeScript; una prueba compara las dos.
create function public.cuentas_contables_por_defecto()
returns table (purpose text, code text, name text, type text, orden integer)
language sql
immutable
set search_path = ''
as $$
  values
    ('caja',             '1101', 'Caja general',                  'asset',      1),
    ('cxc',              '1102', 'Cuentas por cobrar clientes',   'asset',      2),
    ('banco',            '1103', 'Bancos',                        'asset',      3),
    ('inventario',       '1104', 'Inventario de mercancias',      'asset',      4),
    ('itbis_adelantado', '1105', 'ITBIS adelantado en compras',   'asset',      5),
    ('itbis_por_pagar',  '2101', 'ITBIS por pagar',               'liability',  6),
    ('cxp',              '2102', 'Cuentas por pagar proveedores', 'liability',  7),
    ('itbis_retenido',   '2103', 'ITBIS retenido por pagar',      'liability',  8),
    ('isr_retenido',     '2104', 'ISR retenido por pagar',        'liability',  9),
    ('ventas',           '4101', 'Ventas de mercancias',          'revenue',   10),
    ('costo_ventas',     '5101', 'Costo de ventas',               'expense',   11),
    ('compras',          '1104', 'Inventario de mercancias',      'asset',     12),
    ('gastos',           '6101', 'Gastos generales',              'expense',   13),
    ('ingresos_mora',    '4201', 'Recargos por mora',             'revenue',   14)
$$;

comment on function public.cuentas_contables_por_defecto() is
  'Catalogo minimo por defecto de los asientos automaticos: uso -> codigo, nombre y tipo exigido. Espejo de PROPOSITOS_CONTABLES en @regb/operations. (0131)';

grant execute on function public.cuentas_contables_por_defecto() to authenticated;

create table public.accounting_account_map (
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  purpose    text not null,
  -- no action (no restrict): una cuenta asignada no se puede borrar
  -- sola, pero al borrar el tenant la cascada se lleva las dos filas en
  -- la misma sentencia.
  account_id uuid not null references public.accounts(id) on delete no action,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, purpose)
);

create index on public.accounting_account_map (tenant_id, account_id);

comment on table public.accounting_account_map is
  'Que cuenta del catalogo del cliente usa cada asiento automatico (caja, banco, cxc, ventas...). El tipo de la cuenta tiene que ser el del uso. (0131)';

alter table public.accounting_account_map enable row level security;
alter table public.accounting_account_map force row level security;

create policy tenant_module on public.accounting_account_map for all
  using (tenant_id = rls.tenant_id() and rls.module_active('accounting'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('accounting'));
create policy provider_impersonating on public.accounting_account_map for select
  using (rls.impersonating(tenant_id));

--  El uso tiene que existir, la cuenta tiene que ser del MISMO cliente
--  (la FK se comprueba sin RLS: el agujero de 0121) y de su tipo: mapear
--  "Bancos" a una cuenta de ingreso haria que cada cobro con tarjeta
--  "vendiera" otra vez.
--
--  SECURITY DEFINER: la cuenta ajena es invisible bajo la RLS de quien
--  escribe, y un select con sus permisos no distinguiria "de otro" de "no
--  existe". Solo lee; no escribe nada con los privilegios prestados.
create function public.validar_mapa_contable() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_esperado text;
  v_tipo     text;
  v_tenant   uuid;
  v_code     text;
begin
  select d.type into v_esperado
  from public.cuentas_contables_por_defecto() d where d.purpose = new.purpose;
  if v_esperado is null then
    raise exception 'El uso "%" no existe en el mapa contable.', new.purpose using errcode = '22023';
  end if;

  select a.type, a.tenant_id, a.code into v_tipo, v_tenant, v_code
  from public.accounts a where a.id = new.account_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'accounting_account_map.account_id apunta a un registro de accounts que no pertenece a ese cliente.'
      using errcode = '42501';
  end if;
  if v_tipo <> v_esperado then
    raise exception 'El uso "%" necesita una cuenta de tipo %; la cuenta % es de tipo %.',
      new.purpose, v_esperado, v_code, v_tipo using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger validar_mapa_contable
  before insert or update on public.accounting_account_map
  for each row execute function public.validar_mapa_contable();

create trigger audit_me after insert or update or delete on public.accounting_account_map
  for each row execute function audit.record('accounting');

--  Crea las cuentas del catalogo minimo que falten y asigna los usos
--  vacios. Nunca pisa una asignacion hecha por el cliente, y si el codigo
--  por defecto ya existe con OTRO tipo deja ese uso sin asignar: el
--  asiento que lo necesite fallara con el nombre del uso, y el evento se
--  reintenta hasta que alguien lo asigne en /contabilidad/mapa.
--
--  SECURITY INVOKER a proposito: desde la pantalla corre con la RLS del
--  usuario (modulo activo, su tenant); desde registrar_asiento_automatico
--  hereda al dueno.
create function public.asegurar_mapa_contable(p_tenant uuid) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r      record;
  v_id   uuid;
  v_tipo text;
  v_n    integer := 0;
begin
  if rls.tenant_id() is not null and p_tenant is distinct from rls.tenant_id() then
    raise exception 'No puedes tocar el mapa contable de otro cliente.' using errcode = '42501';
  end if;

  for r in select d.* from public.cuentas_contables_por_defecto() d order by d.orden loop
    continue when exists (
      select 1 from public.accounting_account_map m
      where m.tenant_id = p_tenant and m.purpose = r.purpose);

    v_id := null;
    v_tipo := null;
    select a.id, a.type into v_id, v_tipo
    from public.accounts a where a.tenant_id = p_tenant and a.code = r.code;

    if v_id is null then
      insert into public.accounts (tenant_id, code, name, type)
      values (p_tenant, r.code, r.name, r.type)
      returning id, type into v_id, v_tipo;
    end if;

    continue when v_tipo <> r.type;

    insert into public.accounting_account_map (tenant_id, purpose, account_id)
    values (p_tenant, r.purpose, v_id)
    on conflict (tenant_id, purpose) do nothing;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

grant execute on function public.asegurar_mapa_contable(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  4. El asiento automatico
-- ═══════════════════════════════════════════════════════════════════════
--  p_lineas: [{"purpose":"caja","debit":236,"credit":0,"memo":"..."},
--             {"accountId":"<uuid>","debit":0,"credit":236}, ...]
--  `purpose` se traduce con el mapa; `accountId` es solo para reversos,
--  que tienen que tocar exactamente las cuentas del original.
--
--  Devuelve el id del asiento (el nuevo o el que ya existia para ese
--  origen), o null si el cliente no tiene `accounting` activo o no hay
--  lineas: los dos casos son "nada que hacer", no un error.
--
--  SECURITY DEFINER y SIN grant a authenticated: la llama el despachador
--  (sin JWT, sin RLS que aplicar). Si un usuario pudiera llamarla, podria
--  fabricar asientos "automaticos" contabilizados saltandose
--  accounting.entry.post. Toda referencia se resuelve DENTRO del tenant
--  que recibe -el mapa, y las cuentas via la guarda de 0041-.
create function public.registrar_asiento_automatico(
  p_tenant      uuid,
  p_source_type text,
  p_source_id   uuid,
  p_fecha       date,
  p_descripcion text,
  p_lineas      jsonb,
  p_evento      bigint default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_linea  jsonb;
  v_cuenta uuid;
  v_uso    text;
  v_debe   numeric(12,2);
  v_haber  numeric(12,2);
  v_code   text;
  v_name   text;
  v_activa boolean;
begin
  if p_source_type is null or p_source_type = 'manual' or p_source_id is null then
    raise exception 'Un asiento automatico necesita su origen (tipo e id).' using errcode = '22023';
  end if;

  -- Degradacion elegante: sin contabilidad no hay nada que asentar.
  if not exists (
    select 1 from regb.tenant_modules tm
    where tm.tenant_id = p_tenant and tm.module_id = 'accounting'
      and tm.status in ('trial', 'active') and tm.enabled
  ) then
    return null;
  end if;

  -- Dos entregas del mismo evento a la vez (dos despachadores, o el
  -- reintento de uno que se creyo muerto): la segunda espera aqui y
  -- encuentra el asiento de la primera, sin gastar un numero.
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant::text || ':' || p_source_type || ':' || p_source_id::text, 0));

  select e.id into v_id from public.journal_entries e
  where e.tenant_id = p_tenant and e.source_type = p_source_type and e.source_id = p_source_id;
  if v_id is not null then
    return v_id;
  end if;

  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    return null;
  end if;

  perform public.asegurar_mapa_contable(p_tenant);

  insert into public.journal_entries
    (tenant_id, number, entry_date, description, source_type, source_id, source_event)
  values (p_tenant, public.numerar_asiento(p_tenant), coalesce(p_fecha, current_date),
          p_descripcion, p_source_type, p_source_id, p_evento)
  returning id into v_id;

  for v_linea in select value from jsonb_array_elements(p_lineas) loop
    v_debe  := coalesce((v_linea ->> 'debit')::numeric, 0);
    v_haber := coalesce((v_linea ->> 'credit')::numeric, 0);
    continue when v_debe = 0 and v_haber = 0;

    v_cuenta := null;
    if v_linea ->> 'accountId' is not null then
      v_cuenta := (v_linea ->> 'accountId')::uuid;
    else
      v_uso := v_linea ->> 'purpose';
      select m.account_id into v_cuenta from public.accounting_account_map m
      where m.tenant_id = p_tenant and m.purpose = v_uso;
      if v_cuenta is null then
        raise exception 'Falta asignar la cuenta de "%" en el mapa contable (Contabilidad > Mapa de cuentas).', v_uso
          using errcode = 'P0002';
      end if;
    end if;

    v_code := null;
    select a.code, a.name, a.is_active into v_code, v_name, v_activa
    from public.accounts a where a.id = v_cuenta and a.tenant_id = p_tenant;
    if v_code is null then
      raise exception 'Esa cuenta no pertenece a este cliente.' using errcode = '42501';
    end if;
    if not v_activa then
      raise exception 'La cuenta % % esta desactivada: reactivala o asigna otra en el mapa contable.',
        v_code, v_name using errcode = '55000';
    end if;

    insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit, memo)
    values (v_id, p_tenant, v_cuenta, v_debe, v_haber, v_linea ->> 'memo');
  end loop;

  -- exigir_partida_doble() valida aqui: si no cuadra, nada de esto queda.
  update public.journal_entries set status = 'posted', posted_at = now() where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.registrar_asiento_automatico(uuid, text, uuid, date, text, jsonb, bigint)
  from public, anon, authenticated;

comment on function public.registrar_asiento_automatico(uuid, text, uuid, date, text, jsonb, bigint) is
  'Asiento automatico contabilizado, idempotente por (tenant, source_type, source_id). Null si el cliente no tiene accounting. Solo el despachador (sin grant a authenticated). (0131)';

-- ═══════════════════════════════════════════════════════════════════════
--  5. Los eventos que faltaban, emitidos desde la tabla
-- ═══════════════════════════════════════════════════════════════════════
--  AFTER, en la misma transaccion del cambio: si el cambio se revierte, el
--  evento tampoco existe. SECURITY DEFINER por la misma razon que
--  0123/0125: `emit_event()` exige tenant en el JWT y una importacion o un
--  script no lo traen; el tenant sale de la fila.
create function public.emitir_evento_de_documento() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'pos_sales' then
    insert into public.event_outbox (tenant_id, type, payload, emitted_by)
    values (new.tenant_id, 'pos.sale.voided',
            jsonb_build_object('saleId', new.id, 'number', new.number), 'pos');

  elsif tg_table_name = 'customer_payments' then
    insert into public.event_outbox (tenant_id, type, payload, emitted_by)
    values (new.tenant_id, 'ar.payment.received',
            jsonb_build_object('paymentId', new.id, 'invoiceId', new.invoice_id,
                               'amount', new.amount, 'method', new.method), 'ar');

  elsif tg_table_name = 'customer_invoices' then
    insert into public.event_outbox (tenant_id, type, payload, emitted_by)
    values (new.tenant_id, 'ar.invoice.voided',
            jsonb_build_object('invoiceId', new.id, 'number', new.number), 'ar');

  elsif tg_table_name = 'supplier_payments' then
    insert into public.event_outbox (tenant_id, type, payload, emitted_by)
    values (new.tenant_id, 'ap.payment.recorded',
            jsonb_build_object('paymentId', new.id, 'invoiceId', new.invoice_id,
                               'amount', new.amount, 'method', new.method), 'ap');

  elsif tg_table_name = 'supplier_invoices' then
    insert into public.event_outbox (tenant_id, type, payload, emitted_by)
    values (new.tenant_id, 'ap.invoice.voided',
            jsonb_build_object('invoiceId', new.id), 'ap');

  elsif tg_table_name = 'invoice_late_fees' then
    insert into public.event_outbox (tenant_id, type, payload, emitted_by)
    values (new.tenant_id, 'ar.late-fee.applied',
            jsonb_build_object('lateFeeId', new.id, 'invoiceId', new.invoice_id,
                               'amount', new.amount), 'ar');
  end if;

  return null;
end;
$$;

comment on function public.emitir_evento_de_documento() is
  'Outbox desde la tabla para los hechos que ninguna accion emitia: ticket anulado, cobro, pago, factura anulada. (0131)';

create trigger emite_pos_sale_voided
  after update of voided on public.pos_sales
  for each row when (new.voided and not old.voided)
  execute function public.emitir_evento_de_documento();

create trigger emite_ar_payment_received
  after insert on public.customer_payments
  for each row execute function public.emitir_evento_de_documento();

create trigger emite_ar_invoice_voided
  after update of status on public.customer_invoices
  for each row when (new.status = 'void' and old.status is distinct from 'void')
  execute function public.emitir_evento_de_documento();

create trigger emite_ap_payment_recorded
  after insert on public.supplier_payments
  for each row execute function public.emitir_evento_de_documento();

create trigger emite_ap_invoice_voided
  after update of status on public.supplier_invoices
  for each row when (new.status = 'void' and old.status is distinct from 'void')
  execute function public.emitir_evento_de_documento();

create trigger emite_ar_late_fee_applied
  after insert on public.invoice_late_fees
  for each row execute function public.emitir_evento_de_documento();

-- ═══════════════════════════════════════════════════════════════════════
--  6. Recepciones: devolver solo lo que entro
-- ═══════════════════════════════════════════════════════════════════════
alter table public.supplier_returns
  add column origin text not null default 'rejected'
    check (origin in ('rejected', 'accepted'));

comment on column public.supplier_returns.origin is
  'rejected: lo rechazado en la inspeccion, que NUNCA entro al inventario -devolverlo no mueve kardex-. accepted: algo aceptado que salio malo -sale del almacen, hasta lo aceptado-. (0131)';

--  El tope por origen, tambien en la base. Toma el candado de la linea de
--  recepcion para que dos devoluciones simultaneas no pasen las dos el
--  mismo cupo. (La linea es inmutable: `for update` bloquea, no edita, y
--  no dispara el trigger de 0065.)
create function public.limitar_devolucion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base numeric(14,3);
  v_ya   numeric(14,3);
begin
  -- El tope solo mira devoluciones vivas (pending/sent) con cantidad
  -- positiva. Una cancelada no ocupa cupo; un estado inventado o una
  -- cantidad <= 0 los rechazan los CHECK de la tabla, que Postgres evalua
  -- DESPUES de los triggers BEFORE: si el tope hablara primero, taparia el
  -- motivo real con un "no hay cupo" que no es el problema.
  if new.status not in ('pending', 'sent') or new.qty is null or new.qty <= 0 then
    return new;
  end if;

  select case when new.origin = 'accepted' then l.qty_accepted else l.qty_rejected end
    into v_base
  from public.goods_receipt_lines l where l.id = new.goods_receipt_line_id
  for update;

  select coalesce(sum(r.qty), 0) into v_ya
  from public.supplier_returns r
  where r.goods_receipt_line_id = new.goods_receipt_line_id
    and r.origin = new.origin and r.status <> 'cancelled' and r.id <> new.id;

  if v_ya + new.qty > coalesce(v_base, 0) then
    raise exception 'Solo hay % unidades % disponibles para devolver.',
      trim_scale(greatest(coalesce(v_base, 0) - v_ya, 0)),
      case when new.origin = 'accepted' then 'aceptadas' else 'rechazadas' end
      using errcode = '23514';
  end if;

  return new;
end;
$$;

--  Nombre con "t" a proposito: los BEFORE se disparan por orden
--  alfabetico, y la guarda de cliente ajeno (`no_devolucion_ajena`) y la
--  de devolucion ya resuelta (`no_editar_devolucion_resuelta`) tienen que
--  ir antes que el tope -una linea de otro cliente es "no es tuya", no
--  "no hay cupo"-.
create trigger tope_de_devolucion
  before insert or update of qty, origin, status, goods_receipt_line_id on public.supplier_returns
  for each row execute function public.limitar_devolucion();

-- ═══════════════════════════════════════════════════════════════════════
--  7. El marketplace deja de prometer lo que no pasaba (o de callar lo
--     que ahora si pasa)
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set features = '[
      {"titulo":"Se contabiliza sola","detalle":"Cada venta de caja, factura a credito, cobro, factura de proveedor y pago genera su asiento ya contabilizado. Anular genera el reverso. Tu solo escribes los ajustes."},
      {"titulo":"Mapa de cuentas a tu medida","detalle":"Arranca con un catalogo minimo dominicano (caja, bancos, CxC, inventario, ITBIS, CxP, retenciones, ventas, costo). Cambia a que cuenta va cada cosa cuando quieras."},
      {"titulo":"El asiento no cuadra, no se contabiliza","detalle":"Ni desde la pantalla ni por ningun otro camino: la base rechaza un asiento con el debe distinto al haber."},
      {"titulo":"Contabilizado es contabilizado","detalle":"Un asiento contabilizado no se edita ni se borra -ni una linea, ni un monto-. Si algo estuvo mal, se hace un asiento de reverso, nunca se toca el original."},
      {"titulo":"Mayor y balanza","detalle":"El historial de cada cuenta con su saldo corriendo, y la balanza de comprobacion con solo lo contabilizado -los borradores no suman-."}
    ]'::jsonb,
    faq = '[
      {"p":"¿Necesito cuentas por cobrar o por pagar para usar contabilidad?","r":"No. Contabilidad funciona sola con asientos manuales. Si tienes caja, cuentas por cobrar o por pagar, sus movimientos generan el asiento automaticamente."},
      {"p":"¿Que pasa con mis ventas si desactivo contabilidad?","r":"Nada: se siguen vendiendo y cobrando igual. Mientras este apagada no se generan asientos."},
      {"p":"¿Puedo corregir un asiento que ya contabilice?","r":"No directamente: esa es la garantia del modulo. Se hace un asiento de reverso que anula el efecto y uno nuevo con el monto correcto, y los dos quedan en el mayor."}
    ]'::jsonb
where id = 'accounting';

update regb.module_catalog
set features = '[
      {"titulo":"Inspeccion, no solo conteo","detalle":"Cada linea recibida se divide en aceptado y rechazado, con la razon del rechazo -no basta con anotar cuanto llego-."},
      {"titulo":"La discrepancia se detecta sola","detalle":"Si lo que llego no coincide con lo esperado, el documento entero queda marcado -nadie tiene que comparar dos numeros a mano-."},
      {"titulo":"Devolucion que no descuadra el inventario","detalle":"Lo rechazado se devuelve sin tocar tu existencia, porque nunca entro. Si devuelves algo que ya habias aceptado, eso si sale del almacen, y nunca mas de lo aceptado."}
    ]'::jsonb
where id = 'receipts';
