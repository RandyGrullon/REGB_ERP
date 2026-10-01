-- ═══════════════════════════════════════════════════════════════════════
--  Datos de demostración del área de Ventas y clientes
--
--  La demo de `demo.sql` dejaba cada pantalla de ventas con UN registro
--  (o con ninguno): la caja de la distribuidora sin turnos ni tickets, el
--  607 en cero, dos clientes sin teléfono y con el RNC mal digitado, un
--  solo pedido, una sola cotización, un embudo con tres columnas vacías.
--  Así no se puede enseñar a nadie cómo se ve un día de trabajo.
--
--  Aquí se llena lo que falta, con datos creíbles de RD: RNC y cédulas que
--  pasan el dígito verificador, montos en RD$, ITBIS del 18 %, nombres y
--  teléfonos dominicanos.
--
--  Reglas de este archivo:
--   · Idempotente. Cada bloque tiene su ancla (un número, un código, un
--     `client_ref` fijo) y no hace nada si ya corrió. Se puede aplicar las
--     veces que haga falta.
--   · Los documentos se crean por el MISMO camino que la pantalla: los
--     números salen de los contadores del cliente, los NCF de
--     `assign_ncf()`, la mercancía se mueve con `inventory_movements` y se
--     emiten los mismos eventos que emite la acción. Así nada queda
--     "huérfano" para inventario, el 607 o la contabilidad automática.
--   · No toca las anclas de `demo.sql` (nombres de clientes, asuntos):
--     cambiarlas duplicaría esos registros en la próxima corrida.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Ayudantes de esta sesión (pg_temp: desaparecen al terminar) ─────────

-- Actúa como el cliente indicado: las funciones de numeración, NCF y
-- eventos exigen que el JWT diga de qué cliente es el documento.
create or replace function pg_temp.como(p_tenant uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000000001',
                      'app_metadata', json_build_object('tenant_id', p_tenant, 'is_provider', false))::text,
    true);
end $$;

-- Un cliente, si no existe ya con ese nombre. Devuelve su id.
create or replace function pg_temp.cliente(
  p_tenant uuid, p_nombre text, p_rnc text, p_tel text, p_correo text, p_dir text,
  p_plazo int, p_limite numeric, p_notas text default null
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.customers where tenant_id = p_tenant and name = p_nombre;
  if v_id is null then
    insert into public.customers
      (tenant_id, name, tax_id, phone, email, address, payment_terms, credit_limit, notes)
    values (p_tenant, p_nombre, p_rnc, p_tel, p_correo, p_dir, p_plazo, p_limite, p_notas)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Un ticket de caja completo, igual que `cobrarVenta` (pos/actions.ts):
-- número del contador, NCF B01 si el cliente tiene RNC y B02 si no,
-- líneas, salida de almacén para lo que lleva existencias, pagos y el
-- evento `pos.sale.completed`. Si el `client_ref` ya existe, no hace nada.
--   p_items: [{"sku": "CEM-100", "qty": 3, "desc": 0}, ...]
--   p_pagos: [{"method": "cash", "amount": null}]  (null = el resto)
create or replace function pg_temp.ticket(
  p_tenant uuid, p_turno uuid, p_cliente uuid, p_hora timestamptz,
  p_items jsonb, p_pagos jsonb, p_ref text,
  p_anulado_motivo text default null, p_anulado_tipo text default null
) returns uuid language plpgsql as $$
declare
  v_ref     uuid := md5(p_ref)::uuid;
  v_id      uuid;
  v_alm     uuid;
  v_n       int;
  v_numero  text;
  v_rnc     text;
  v_tipo    text;
  v_ncf     text;
  v_sub     numeric := 0;
  v_desc    numeric := 0;
  v_tax     numeric := 0;
  v_total   numeric := 0;
  v_resto   numeric;
  v_monto   numeric;
  it        jsonb;
  pg        jsonb;
  p         record;
  l_bruto   numeric;
  l_sub     numeric;
  l_tax     numeric;
begin
  select id into v_id from public.pos_sales where tenant_id = p_tenant and client_ref = v_ref;
  if v_id is not null then return v_id; end if;

  perform pg_temp.como(p_tenant);
  select warehouse_id into v_alm from public.pos_shifts where id = p_turno;

  -- Totales primero: el pago "el resto" los necesita.
  for it in select * from jsonb_array_elements(p_items) loop
    select pr.price, pr.tax_rate into p from public.products pr
      where pr.tenant_id = p_tenant and pr.sku = it->>'sku';
    l_bruto := round((it->>'qty')::numeric * p.price, 2);
    l_sub   := round(l_bruto * (1 - coalesce((it->>'desc')::numeric, 0) / 100), 2);
    l_tax   := round(l_sub * p.tax_rate, 2);
    v_sub   := v_sub + l_bruto;
    v_desc  := v_desc + (l_bruto - l_sub);
    v_tax   := v_tax + l_tax;
  end loop;
  v_total := v_sub - v_desc + v_tax;

  insert into public.pos_sale_counters as c (tenant_id, year, last_n)
  values (p_tenant, extract(year from now())::smallint, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;
  v_numero := format('TK-%s-%s', extract(year from now())::int, lpad(v_n::text, 6, '0'));

  if p_cliente is not null then
    select tax_id into v_rnc from public.customers where id = p_cliente;
  end if;
  v_tipo := case when v_rnc is not null then 'B01' else 'B02' end;
  if exists (
    select 1 from public.ncf_sequences
    where tenant_id = p_tenant and ncf_type = v_tipo and is_active and company_id is null
      and expires_on >= public.hoy_fiscal() and next_number <= range_to
  ) then
    v_ncf := public.assign_ncf(p_tenant, v_tipo);
  end if;

  -- Un ticket anulado nace anulado: el trigger de anulación emite
  -- `pos.sale.voided` solo en un UPDATE, y este ticket nunca se contabilizó.
  insert into public.pos_sales
    (tenant_id, shift_id, number, customer_id, subtotal, discount, tax, total, cashier_id,
     ncf, ncf_type, client_ref, sold_at, created_at,
     voided, void_reason, void_type, voided_at)
  values (p_tenant, p_turno, v_numero, p_cliente, v_sub, v_desc, v_tax, v_total,
          '00000000-0000-0000-0000-000000000001',
          v_ncf, case when v_ncf is not null then v_tipo end, v_ref, p_hora, p_hora,
          p_anulado_motivo is not null, p_anulado_motivo, p_anulado_tipo,
          case when p_anulado_motivo is not null then p_hora + interval '12 minutes' end)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    select pr.id, pr.price, pr.tax_rate, pr.tracks_stock into p from public.products pr
      where pr.tenant_id = p_tenant and pr.sku = it->>'sku';
    l_sub := round(round((it->>'qty')::numeric * p.price, 2)
                   * (1 - coalesce((it->>'desc')::numeric, 0) / 100), 2);
    l_tax := round(l_sub * p.tax_rate, 2);
    insert into public.pos_sale_lines
      (sale_id, tenant_id, product_id, qty, unit_price, discount_pct, tax_rate, line_total)
    values (v_id, p_tenant, p.id, (it->>'qty')::numeric, p.price,
            coalesce((it->>'desc')::numeric, 0), p.tax_rate, l_sub + l_tax);
    -- Lo anulado vuelve al estante: aquí, simplemente, nunca sale.
    if p.tracks_stock and p_anulado_motivo is null then
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, movement_type, qty,
         reference_type, reference_id, created_by, created_at)
      values (p_tenant, v_alm, p.id, 'sale', -(it->>'qty')::numeric,
              'pos_sale', v_id, '00000000-0000-0000-0000-000000000001', p_hora);
    end if;
  end loop;

  v_resto := v_total;
  for pg in select * from jsonb_array_elements(p_pagos) loop
    v_monto := coalesce((pg->>'amount')::numeric, v_resto);
    if v_monto > 0 then
      insert into public.pos_payments (sale_id, tenant_id, method, amount, reference)
      values (v_id, p_tenant, pg->>'method', v_monto, pg->>'ref');
      v_resto := v_resto - v_monto;
    end if;
  end loop;

  if p_anulado_motivo is null then
    perform public.emit_event('pos.sale.completed',
      jsonb_build_object('saleId', v_id, 'total', v_total), 'pos');
  end if;
  return v_id;
end $$;

-- Cierra un turno con el arqueo que haría `cerrarTurno`: esperado = fondo
-- + efectivo vendido (sin anulados); contado = esperado + la diferencia.
create or replace function pg_temp.cerrar_turno(
  p_turno uuid, p_cierre timestamptz, p_diferencia numeric, p_notas text
) returns void language plpgsql as $$
declare v_esperado numeric; v_tenant uuid;
begin
  select s.tenant_id, s.opening_float + coalesce((
           select sum(pp.amount) from public.pos_payments pp
           join public.pos_sales ps on ps.id = pp.sale_id
           where ps.shift_id = s.id and not ps.voided and pp.method = 'cash'), 0)
    into v_tenant, v_esperado
  from public.pos_shifts s where s.id = p_turno;

  update public.pos_shifts
  set status = 'closed', closed_at = p_cierre, expected_cash = v_esperado,
      counted_cash = v_esperado + p_diferencia, variance = p_diferencia, notes = p_notas
  where id = p_turno and status = 'open';

  perform pg_temp.como(v_tenant);
  perform public.emit_event('pos.shift.closed',
    jsonb_build_object('shiftId', p_turno, 'variance', p_diferencia), 'pos');
end $$;

-- Totales de una línea de documento (pedido, cotización, factura), con el
-- mismo redondeo que `documentTotals()`: bruto, neto tras el descuento,
-- ITBIS sobre el neto y total.
create or replace function pg_temp.bruto(q numeric, pr numeric) returns numeric
language sql immutable as $$ select round(q * pr, 2) $$;
create or replace function pg_temp.neto(q numeric, pr numeric, d numeric) returns numeric
language sql immutable as $$ select round(pg_temp.bruto(q, pr) * (1 - d / 100), 2) $$;
create or replace function pg_temp.itbis(q numeric, pr numeric, d numeric, t numeric) returns numeric
language sql immutable as $$ select round(pg_temp.neto(q, pr, d) * t, 2) $$;
create or replace function pg_temp.total(q numeric, pr numeric, d numeric, t numeric) returns numeric
language sql immutable as $$ select pg_temp.neto(q, pr, d) + pg_temp.itbis(q, pr, d, t) $$;

-- ═══════════════════════════════════════════════════════════════════════
--  1. Clientes
--
--  La distribuidora vendía a dos clientes, sin teléfono ni correo, y los
--  dos con un RNC que no pasa el dígito verificador: la ficha los marcaba
--  "RNC inválido" y no se les podía emitir crédito fiscal (B01). Se
--  corrige el dígito (el nombre, que es el ancla de demo.sql, no se toca)
--  y se suman seis clientes más, de los que compra una distribuidora de
--  materiales: ferreterías, constructoras, un hotel, un maestro de obra.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med  uuid;
  v_pyme uuid;
begin
  select id into v_med  from regb.tenants where slug = 'distribuidora-caribe';
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  if v_med is null then return; end if;

  update public.customers
  set tax_id = '131-22334-6',
      phone = coalesce(phone, '809-565-2210'),
      email = coalesce(email, 'compras@elmartillo.do'),
      address = coalesce(address, 'Av. Duarte 214, Villa Francisca, Santo Domingo'),
      credit_limit = coalesce(credit_limit, 120000),
      updated_at = now()
  where tenant_id = v_med and name = 'Ferretería El Martillo SRL' and tax_id = '131-22334-5';

  update public.customers
  set tax_id = '131-99887-9',
      phone = coalesce(phone, '809-541-7788'),
      email = coalesce(email, 'ramon.duarte@constructoraduarte.do'),
      address = coalesce(address, 'C/ Rafael Augusto Sánchez 86, Piantini, Santo Domingo'),
      credit_limit = coalesce(credit_limit, 450000),
      updated_at = now()
  where tenant_id = v_med and name = 'Constructora Duarte SRL' and tax_id = '131-99887-6';

  perform pg_temp.cliente(v_med, 'Ferretería Los Hidalgos SRL', '131-04512-1', '809-582-3140',
    'ventas@loshidalgos.com.do', 'Av. 27 de Febrero 58, Santiago de los Caballeros', 30, 150000);
  perform pg_temp.cliente(v_med, 'Constructora Báez Guzmán SRL', '130-87654-1', '809-620-4455',
    'compras@baezguzman.do', 'Autopista San Isidro km 9, Santo Domingo Este', 45, 500000);
  perform pg_temp.cliente(v_med, 'Inversiones Tavárez & Asociados SRL', '131-22890-9', '809-476-9021',
    'administracion@tavarez.com.do', 'C/ Duarte 45, La Vega', 15, 80000);
  perform pg_temp.cliente(v_med, 'Hotel Playa Dorada Suites SRL', '101-50347-5', '809-320-1188',
    'mantenimiento@playadoradasuites.do', 'Complejo Playa Dorada, Puerto Plata', 30, 250000);
  perform pg_temp.cliente(v_med, 'José Miguel Almonte', '001-0456789-6', '829-344-7612',
    'jmalmonte.obras@gmail.com', 'C/ Primera 12, Los Alcarrizos', 0, null,
    'Maestro constructor. Paga de contado, casi siempre por transferencia.');
  perform pg_temp.cliente(v_med, 'Colmado Doña Ana', '031-0234567-9', '849-275-3308',
    null, 'C/ Colón esq. Sánchez, Bonao', 0, null,
    'Compra al detalle en el mostrador para revender.');

  if v_pyme is null then return; end if;

  -- El colmado vende casi todo a consumidor final; estos son los clientes
  -- de siempre, los que piden factura con su RNC o su cédula.
  perform pg_temp.cliente(v_pyme, 'Farmacia Villa Consuelo SRL', '130-61122-1', '809-684-2231',
    'farmaciavc@gmail.com', 'C/ Eusebio Manzueta 101, Villa Consuelo', 0, null);
  perform pg_temp.cliente(v_pyme, 'Pica Pollo Don Nando', '402-0987654-5', '829-551-0490',
    null, 'C/ Juana Saltitopa 33, Villa Consuelo', 0, null,
    'Compra aceite y arroz para el negocio dos veces por semana.');
  perform pg_temp.cliente(v_pyme, 'Yudelka Martínez', '001-1122334-3', '849-803-1175',
    null, 'C/ Josefa Brea 18, Villa Consuelo', 0, null);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  2. Caja de la distribuidora
--
--  Sin esto, Turnos, Cierres y el 607 salían vacíos. Tres turnos: dos
--  cerrados (uno cuadrado y otro con RD$ 25 de sobrante) y el de hoy
--  abierto, que es como amanece una caja un día normal. Un ticket anulado
--  con su motivo de la DGII, para que el 608 y "Anulados" tengan algo.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_alm       uuid;
  v_hidalgos  uuid;
  v_ana       uuid;
  v_almonte   uuid;
  v_duarte    uuid;
  v_t1        uuid;
  v_t2        uuid;
  v_t3        uuid;
  d1          timestamptz := date_trunc('day', now() at time zone 'America/Santo_Domingo') at time zone 'America/Santo_Domingo' - interval '2 days';
  d2          timestamptz := date_trunc('day', now() at time zone 'America/Santo_Domingo') at time zone 'America/Santo_Domingo' - interval '1 day';
  d3          timestamptz := date_trunc('day', now() at time zone 'America/Santo_Domingo') at time zone 'America/Santo_Domingo';
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  if exists (select 1 from public.pos_sales
             where tenant_id = v_med and client_ref = md5('ventas-med-t1-1')::uuid) then
    return;
  end if;

  select id into v_alm from public.warehouses
    where tenant_id = v_med and code = 'ALM-SD';
  select id into v_hidalgos from public.customers where tenant_id = v_med and name = 'Ferretería Los Hidalgos SRL';
  select id into v_ana      from public.customers where tenant_id = v_med and name = 'Colmado Doña Ana';
  select id into v_almonte  from public.customers where tenant_id = v_med and name = 'José Miguel Almonte';
  select id into v_duarte   from public.customers where tenant_id = v_med and name = 'Constructora Duarte SRL';
  if v_alm is null then return; end if;

  -- Turno 1: anteayer, cuadrado.
  insert into public.pos_shifts (tenant_id, warehouse_id, cashier_id, opening_float, status, opened_at)
  values (v_med, v_alm, '00000000-0000-0000-0000-000000000001', 3000, 'open', d1 + interval '8 hours')
  returning id into v_t1;
  perform pg_temp.ticket(v_med, v_t1, null, d1 + interval '8 hours 42 minutes',
    '[{"sku":"CEM-100","qty":2}]', '[{"method":"cash"}]', 'ventas-med-t1-1');
  perform pg_temp.ticket(v_med, v_t1, v_almonte, d1 + interval '9 hours 55 minutes',
    '[{"sku":"CEM-100","qty":3},{"sku":"ENVIO","qty":1}]', '[{"method":"transfer","ref":"BPD-448120"}]', 'ventas-med-t1-2');
  perform pg_temp.ticket(v_med, v_t1, null, d1 + interval '11 hours 20 minutes',
    '[{"sku":"PIN-300","qty":1}]', '[{"method":"card","ref":"AZUL 002931"}]', 'ventas-med-t1-3');
  perform pg_temp.ticket(v_med, v_t1, v_ana, d1 + interval '14 hours 5 minutes',
    '[{"sku":"PIN-300","qty":2}]', '[{"method":"cash"}]', 'ventas-med-t1-4');
  perform pg_temp.cerrar_turno(v_t1, d1 + interval '17 hours 35 minutes', 0, 'Cuadró exacto.');

  -- Turno 2: ayer, con un ticket anulado y un sobrante pequeño.
  insert into public.pos_shifts (tenant_id, warehouse_id, cashier_id, opening_float, status, opened_at)
  values (v_med, v_alm, '00000000-0000-0000-0000-000000000001', 3000, 'open', d2 + interval '8 hours')
  returning id into v_t2;
  perform pg_temp.ticket(v_med, v_t2, v_hidalgos, d2 + interval '9 hours 10 minutes',
    '[{"sku":"PIN-300","qty":1},{"sku":"CEM-100","qty":1}]', '[{"method":"transfer","ref":"BHD-77012"}]', 'ventas-med-t2-1');
  perform pg_temp.ticket(v_med, v_t2, null, d2 + interval '10 hours 34 minutes',
    '[{"sku":"ENVIO","qty":1}]', '[{"method":"cash"}]', 'ventas-med-t2-2',
    'El cliente decidió recoger la mercancía él mismo', '4');
  perform pg_temp.ticket(v_med, v_t2, null, d2 + interval '12 hours 2 minutes',
    '[{"sku":"CEM-100","qty":1}]', '[{"method":"cash"}]', 'ventas-med-t2-3');
  perform pg_temp.ticket(v_med, v_t2, v_duarte, d2 + interval '15 hours 48 minutes',
    '[{"sku":"INST","qty":1}]', '[{"method":"card","ref":"CARDNET 118340"}]', 'ventas-med-t2-4');
  perform pg_temp.cerrar_turno(v_t2, d2 + interval '17 hours 50 minutes', 25,
    'Sobrante de RD$ 25: vuelto que un cliente no esperó.');

  -- Turno 3: hoy, abierto desde las 8 (o el que ya esté abierto: solo
  -- puede haber uno por caja).
  select id into v_t3 from public.pos_shifts
    where tenant_id = v_med and warehouse_id = v_alm and status = 'open';
  if v_t3 is null then
    insert into public.pos_shifts (tenant_id, warehouse_id, cashier_id, opening_float, status, opened_at)
    values (v_med, v_alm, '00000000-0000-0000-0000-000000000001', 3000, 'open',
            least(d3 + interval '8 hours', now() - interval '2 hours'))
    returning id into v_t3;
  end if;
  perform pg_temp.ticket(v_med, v_t3, null, least(d3 + interval '8 hours', now() - interval '2 hours') + interval '25 minutes',
    '[{"sku":"CEM-100","qty":2}]', '[{"method":"cash"}]', 'ventas-med-t3-1');
  perform pg_temp.ticket(v_med, v_t3, v_almonte, least(d3 + interval '8 hours', now() - interval '2 hours') + interval '75 minutes',
    '[{"sku":"PIN-300","qty":1},{"sku":"ENVIO","qty":1}]',
    '[{"method":"cash","amount":1000},{"method":"card","ref":"AZUL 003117"}]', 'ventas-med-t3-2');
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  3. Caja del colmado
--
--  El turno de demo.sql ("Faltante, se revisará mañana") estaba cerrado
--  con RD$ 20,420 esperados y ningún ticket: un arqueo que no sale de
--  ninguna venta. Se le ponen sus ventas y se recalcula el arqueo con el
--  mismo faltante de RD$ 40. Y se agregan el turno de ayer y el de hoy.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_pyme     uuid;
  v_alm      uuid;
  v_farmacia uuid;
  v_nando    uuid;
  v_yudelka  uuid;
  v_t0       uuid;
  v_t1       uuid;
  v_t2       uuid;
  v_esperado numeric;
  v_abre     timestamptz;
  d0          timestamptz := date_trunc('day', now() at time zone 'America/Santo_Domingo') at time zone 'America/Santo_Domingo' - interval '2 days';
  d1          timestamptz := date_trunc('day', now() at time zone 'America/Santo_Domingo') at time zone 'America/Santo_Domingo' - interval '1 day';
  d2          timestamptz := date_trunc('day', now() at time zone 'America/Santo_Domingo') at time zone 'America/Santo_Domingo';
begin
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  if v_pyme is null then return; end if;
  if exists (select 1 from public.pos_sales
             where tenant_id = v_pyme and client_ref = md5('ventas-pyme-t0-1')::uuid) then
    return;
  end if;

  select id into v_alm from public.warehouses where tenant_id = v_pyme and code = 'ALM-VC';
  select id into v_farmacia from public.customers where tenant_id = v_pyme and name = 'Farmacia Villa Consuelo SRL';

  -- El colmado solo tenía B02: a la farmacia y a los negocios que piden
  -- factura con su RNC o su cédula les salía el ticket "sin NCF".
  if not exists (select 1 from public.ncf_sequences
                 where tenant_id = v_pyme and ncf_type = 'B01' and is_active) then
    insert into public.ncf_sequences
      (tenant_id, ncf_type, range_from, range_to, next_number, expires_on, authorization_ref)
    values (v_pyme, 'B01', 1, 500, 1, (current_date + interval '1 year')::date, 'DEMO-B01');
  end if;
  select id into v_nando    from public.customers where tenant_id = v_pyme and name = 'Pica Pollo Don Nando';
  select id into v_yudelka  from public.customers where tenant_id = v_pyme and name = 'Yudelka Martínez';
  if v_alm is null then return; end if;

  -- El turno de demo.sql, si todavía no tiene ventas.
  select id into v_t0 from public.pos_shifts
    where tenant_id = v_pyme and warehouse_id = v_alm and notes = 'Faltante, se revisará mañana'
      and not exists (select 1 from public.pos_sales s where s.shift_id = pos_shifts.id);
  -- Sus ventas caen dentro de su horario (abrió 8 horas antes de cerrar).
  select opened_at into v_abre from public.pos_shifts where id = v_t0;
  if v_t0 is not null then
    perform pg_temp.ticket(v_pyme, v_t0, null, v_abre + interval '15 minutes',
      '[{"sku":"ARZ-001","qty":2},{"sku":"HAB-003","qty":3}]', '[{"method":"cash"}]', 'ventas-pyme-t0-1');
    perform pg_temp.ticket(v_pyme, v_t0, v_nando, v_abre + interval '2 hours 40 minutes',
      '[{"sku":"ACE-002","qty":2},{"sku":"ARZ-001","qty":2}]', '[{"method":"cash"}]', 'ventas-pyme-t0-2');
    perform pg_temp.ticket(v_pyme, v_t0, null, v_abre + interval '5 hours 5 minutes',
      '[{"sku":"HAB-003","qty":2},{"sku":"DELIV","qty":1}]', '[{"method":"cash"}]', 'ventas-pyme-t0-3');
    perform pg_temp.ticket(v_pyme, v_t0, null, v_abre + interval '7 hours 30 minutes',
      '[{"sku":"ARZ-001","qty":1},{"sku":"ACE-002","qty":1}]', '[{"method":"card","ref":"AZUL 118"}]', 'ventas-pyme-t0-4');
    select opening_float + coalesce((
             select sum(pp.amount) from public.pos_payments pp
             join public.pos_sales ps on ps.id = pp.sale_id
             where ps.shift_id = v_t0 and not ps.voided and pp.method = 'cash'), 0)
      into v_esperado from public.pos_shifts where id = v_t0;
    update public.pos_shifts
    set expected_cash = v_esperado, counted_cash = v_esperado - 40, variance = -40
    where id = v_t0;
  end if;

  -- Ayer: cuadrado.
  insert into public.pos_shifts (tenant_id, warehouse_id, cashier_id, opening_float, status, opened_at)
  values (v_pyme, v_alm, '00000000-0000-0000-0000-000000000001', 2000, 'open', d1 + interval '7 hours')
  returning id into v_t1;
  perform pg_temp.ticket(v_pyme, v_t1, null, d1 + interval '7 hours 20 minutes',
    '[{"sku":"ARZ-001","qty":1},{"sku":"HAB-003","qty":2}]', '[{"method":"cash"}]', 'ventas-pyme-t1-1');
  perform pg_temp.ticket(v_pyme, v_t1, v_farmacia, d1 + interval '10 hours 5 minutes',
    '[{"sku":"ACE-002","qty":1}]', '[{"method":"transfer","ref":"BR-55310"}]', 'ventas-pyme-t1-2');
  perform pg_temp.ticket(v_pyme, v_t1, v_yudelka, d1 + interval '13 hours 45 minutes',
    '[{"sku":"HAB-003","qty":4},{"sku":"DELIV","qty":1}]', '[{"method":"cash"}]', 'ventas-pyme-t1-3');
  perform pg_temp.ticket(v_pyme, v_t1, null, d1 + interval '16 hours 10 minutes',
    '[{"sku":"ARZ-001","qty":1}]', '[{"method":"cash"}]', 'ventas-pyme-t1-4',
    'Se marcó arroz de 5 lb y el cliente quería el de 10 lb', '4');
  perform pg_temp.cerrar_turno(v_t1, d1 + interval '19 hours', 0, 'Cuadró exacto.');

  -- Hoy: abierto (o el que ya esté abierto).
  select id into v_t2 from public.pos_shifts
    where tenant_id = v_pyme and warehouse_id = v_alm and status = 'open';
  if v_t2 is null then
    insert into public.pos_shifts (tenant_id, warehouse_id, cashier_id, opening_float, status, opened_at)
    values (v_pyme, v_alm, '00000000-0000-0000-0000-000000000001', 2000, 'open',
            least(d2 + interval '7 hours', now() - interval '2 hours'))
    returning id into v_t2;
  end if;
  perform pg_temp.ticket(v_pyme, v_t2, null, least(d2 + interval '7 hours', now() - interval '2 hours') + interval '30 minutes',
    '[{"sku":"ARZ-001","qty":1},{"sku":"ACE-002","qty":1}]', '[{"method":"cash"}]', 'ventas-pyme-t2-1');
  perform pg_temp.ticket(v_pyme, v_t2, v_nando, least(d2 + interval '7 hours', now() - interval '2 hours') + interval '70 minutes',
    '[{"sku":"HAB-003","qty":3}]', '[{"method":"cash"}]', 'ventas-pyme-t2-2');
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  4. Pedidos, facturas y comisiones de la distribuidora
--
--  Un pedido en cada estado del ciclo: borrador, confirmado con la
--  mercancía apartada, entregado a medias, entregado sin facturar (lo que
--  enseña "Sin facturar" en Por cobrar), entregado y facturado con NCF
--  B01 (que llena el 607), y uno cancelado con su motivo.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_alm       uuid;
  v_cem       uuid;
  v_pin       uuid;
  v_envio     uuid;
  v_hotel     uuid;
  v_hidalgos  uuid;
  v_baez      uuid;
  v_tavarez   uuid;
  v_martillo  uuid;
  v_almonte   uuid;
  v_plan      uuid;
  v_fijo      uuid;
  v_o         uuid;
  v_l         uuid;
  v_inv       uuid;
  v_num       text;
  v_ncf       text;
  v_n         int;
  r           record;
  maria       constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  if exists (select 1 from public.sales_orders
             where tenant_id = v_med and notes = 'Pintura para remozar las habitaciones del bloque B.') then
    return;
  end if;

  select id into v_alm   from public.warehouses where tenant_id = v_med and code = 'ALM-SD';
  select id into v_cem   from public.products where tenant_id = v_med and sku = 'CEM-100';
  select id into v_pin   from public.products where tenant_id = v_med and sku = 'PIN-300';
  select id into v_envio from public.products where tenant_id = v_med and sku = 'ENVIO';
  select id into v_hotel    from public.customers where tenant_id = v_med and name = 'Hotel Playa Dorada Suites SRL';
  select id into v_hidalgos from public.customers where tenant_id = v_med and name = 'Ferretería Los Hidalgos SRL';
  select id into v_baez     from public.customers where tenant_id = v_med and name = 'Constructora Báez Guzmán SRL';
  select id into v_tavarez  from public.customers where tenant_id = v_med and name = 'Inversiones Tavárez & Asociados SRL';
  select id into v_martillo from public.customers where tenant_id = v_med and name = 'Ferretería El Martillo SRL';
  select id into v_almonte  from public.customers where tenant_id = v_med and name = 'José Miguel Almonte';
  select id into v_plan     from public.commission_plans where tenant_id = v_med order by created_at limit 1;
  if v_alm is null or v_cem is null or v_pin is null or v_hotel is null then return; end if;

  perform pg_temp.como(v_med);

  -- La comisión fija por pedido: la que se paga a quien consigue una obra.
  insert into public.commission_plans (tenant_id, name, basis, rate)
  values (v_med, 'Bono por obra nueva', 'fixed', 1500)
  returning id into v_fijo;
  update public.commission_plans set name = 'Plan estándar de ventas'
  where tenant_id = v_med and name = 'Plan estandar de ventas';

  -- Numeración: la del contador del cliente, como `next_sales_order_number`.
  -- Una función local para no repetir el insert del contador seis veces.
  create temp table if not exists _pedidos_demo (clave text primary key, id uuid, numero text) on commit drop;

  for r in
    select * from (values
      ('borrador',   v_hotel,    'draft',               10, 'Pintura para remozar las habitaciones del bloque B.', 1),
      ('confirmado', v_hidalgos, 'confirmed',            6, 'Despachar en el camión del jueves.', 2),
      ('parcial',    v_baez,     'partially_delivered', 12, 'Obra Residencial Los Prados. Entregar por tandas.', 3),
      ('entregado',  v_tavarez,  'delivered',            9, 'Recoge en almacén su chofer, Félix.', 4),
      ('facturado',  v_martillo, 'delivered',           18, 'Reposición de inventario de la ferretería.', 5),
      ('cancelado',  v_almonte,  'cancelled',            7, 'El cliente consiguió el material en otro suplidor.', 6)
    ) t(clave, cliente, estado, dias, notas, orden)
    order by orden
  loop
    insert into public.sales_order_counters as c (tenant_id, year, last_n)
    values (v_med, extract(year from now())::smallint, 1)
    on conflict (tenant_id, year) do update set last_n = c.last_n + 1
    returning last_n into v_n;
    v_num := format('PV-%s-%s', extract(year from now())::int, lpad(v_n::text, 5, '0'));
    insert into public.sales_orders
      (tenant_id, number, customer_id, warehouse_id, status, order_date, notes, created_by,
       confirmed_at, cancelled_at, created_at)
    values (v_med, v_num, r.cliente, v_alm, r.estado, current_date - r.dias, r.notas, maria,
            case when r.estado <> 'draft' then now() - make_interval(days => r.dias) + interval '2 hours' end,
            case when r.estado = 'cancelled' then now() - make_interval(days => r.dias - 1) end,
            now() - make_interval(days => r.dias))
    returning id into v_o;
    insert into _pedidos_demo values (r.clave, v_o, v_num);
  end loop;

  -- Líneas: (clave, producto, pedida, entregada, reservada, precio)
  for r in
    select d.id as orden, d.clave, t.* from (values
      ('borrador',   v_pin,   10::numeric,  0::numeric, 0::numeric, 1150::numeric),
      ('confirmado', v_pin,    4,  0, 4, 1150),
      ('confirmado', v_envio,  1,  0, 1,  350),
      ('parcial',    v_cem,   20, 12, 8,  465),
      ('entregado',  v_pin,    3,  3, 0, 1150),
      ('entregado',  v_envio,  1,  1, 0,  350),
      ('facturado',  v_cem,   10, 10, 0,  465),
      ('cancelado',  v_cem,   15,  0, 0,  465)
    ) t(clave2, producto, pedida, entregada, reservada, precio)
    join _pedidos_demo d on d.clave = t.clave2
  loop
    insert into public.sales_order_lines
      (order_id, tenant_id, product_id, qty_ordered, qty_reserved, qty_delivered,
       unit_price, discount_pct, tax_rate, line_total)
    select r.orden, v_med, r.producto, r.pedida, r.reservada, r.entregada, r.precio, 0, 0.18,
           pg_temp.total(r.pedida, r.precio, 0, 0.18);

    -- La mercancía: se aparta al confirmar y sale al entregar. Lo que no
    -- lleva existencias (el envío) no mueve el almacén.
    if (select tracks_stock from public.products where id = r.producto) then
      if r.reservada + r.entregada > 0 and r.clave <> 'borrador' then
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, created_by)
        values (v_med, v_alm, r.producto, 'reservation', r.reservada + r.entregada, 'sales_order', r.orden, maria);
      end if;
      if r.entregada > 0 then
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, created_by)
        values (v_med, v_alm, r.producto, 'reservation_release', r.entregada, 'sales_order', r.orden, maria),
               (v_med, v_alm, r.producto, 'sale', -r.entregada, 'sales_order', r.orden, maria);
      end if;
    end if;
  end loop;

  -- Totales del pedido desde sus líneas.
  update public.sales_orders o
  set subtotal = x.sub, tax = x.tax, total = x.sub + x.tax
  from (
    select l.order_id,
           sum(round(l.qty_ordered * l.unit_price, 2)) as sub,
           sum(round(round(l.qty_ordered * l.unit_price, 2) * l.tax_rate, 2)) as tax
    from public.sales_order_lines l
    where l.order_id in (select id from _pedidos_demo)
    group by l.order_id
  ) x
  where o.id = x.order_id;

  -- Los eventos que emite la pantalla en cada paso.
  for r in select d.*, o.total from _pedidos_demo d join public.sales_orders o on o.id = d.id loop
    if r.clave <> 'borrador' then
      perform public.emit_event('sales-orders.order.confirmed',
        jsonb_build_object('orderId', r.id, 'total', r.total), 'sales-orders');
    end if;
    if r.clave in ('entregado', 'facturado') then
      perform public.emit_event('sales-orders.order.delivered',
        jsonb_build_object('orderId', r.id), 'sales-orders');
    end if;
    if r.clave = 'cancelado' then
      perform public.emit_event('sales-orders.order.cancelled',
        jsonb_build_object('orderId', r.id), 'sales-orders');
    end if;
  end loop;

  -- La factura del pedido entregado a El Martillo, con NCF de crédito
  -- fiscal (B01) y abonada a la mitad por transferencia.
  select id into v_o from _pedidos_demo where clave = 'facturado';
  insert into public.customer_invoice_counters as c (tenant_id, year, last_n)
  values (v_med, extract(year from now())::smallint, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;
  v_num := format('FA-%s-%s', extract(year from now())::int, lpad(v_n::text, 5, '0'));
  v_ncf := public.assign_ncf(v_med, 'B01');
  insert into public.customer_invoices
    (tenant_id, number, customer_id, source_type, source_id, issue_date, due_date,
     subtotal, discount, tax, total, status, created_by, ncf, ncf_type, buyer_tax_id, created_at)
  select v_med, v_num, o.customer_id, 'sales_order', o.id, current_date - 16, current_date - 16 + 30,
         o.subtotal, 0, o.tax, o.total, 'partially_paid', maria, v_ncf, 'B01',
         replace(c.tax_id, '-', ''), now() - interval '16 days'
  from public.sales_orders o join public.customers c on c.id = o.customer_id
  where o.id = v_o
  returning id into v_inv;

  insert into public.customer_invoice_lines
    (invoice_id, tenant_id, order_line_id, product_id, description, unit, qty,
     unit_price, discount_pct, tax_rate, subtotal, tax, line_total)
  select v_inv, v_med, l.id, l.product_id, p.name, p.unit, l.qty_delivered, l.unit_price, 0, l.tax_rate,
         pg_temp.neto(l.qty_delivered, l.unit_price, 0),
         pg_temp.itbis(l.qty_delivered, l.unit_price, 0, l.tax_rate),
         pg_temp.total(l.qty_delivered, l.unit_price, 0, l.tax_rate)
  from public.sales_order_lines l join public.products p on p.id = l.product_id
  where l.order_id = v_o;

  perform public.emit_event('ar.invoice.issued',
    jsonb_build_object('orderId', v_o, 'number', v_num), 'ar');

  insert into public.customer_payments
    (tenant_id, invoice_id, amount, method, reference, received_by, received_at)
  values (v_med, v_inv, 2743.50, 'transfer', 'BPD-551902', maria, now() - interval '5 days');

  -- Comisiones: una aprobada, una pagada y una rechazada, además de la
  -- pendiente de demo.sql. La base es lo vendido sin ITBIS.
  if v_plan is not null then
    insert into public.commission_entries
      (tenant_id, plan_id, sales_order_id, salesperson_id, base_amount, commission_amount,
       status, approved_at, paid_at)
    select v_med, v_plan, o.id, maria, o.subtotal, round(o.subtotal * 0.05, 2),
           x.estado, x.aprobada, x.pagada
    from (values
      ('facturado', 'paid',     now() - interval '10 days', now() - interval '2 days'),
      ('entregado', 'approved', now() - interval '3 days',  null::timestamptz),
      ('parcial',   'pending',  null::timestamptz,          null::timestamptz)
    ) x(clave, estado, aprobada, pagada)
    join _pedidos_demo d on d.clave = x.clave
    join public.sales_orders o on o.id = d.id;
  end if;
  insert into public.commission_entries
    (tenant_id, plan_id, sales_order_id, salesperson_id, base_amount, commission_amount, status)
  select v_med, v_fijo, o.id, maria, o.subtotal, 1500, 'rejected'
  from _pedidos_demo d join public.sales_orders o on o.id = d.id where d.clave = 'cancelado';
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  5. Cotizaciones y firma electrónica
--
--  Una cotización en cada estado: enviada, aprobada lista para convertir
--  en pedido, rechazada con su motivo, vencida, y una revisada (v1
--  sustituida por la v2 enviada). La enviada al hotel tiene su firma
--  electrónica completa; la rechazada, su solicitud declinada.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med      uuid;
  v_cem      uuid;
  v_pin      uuid;
  v_inst     uuid;
  v_envio    uuid;
  v_hotel    uuid;
  v_baez     uuid;
  v_tavarez  uuid;
  v_almonte  uuid;
  v_hidalgos uuid;
  v_q        uuid;
  v_v1       uuid;
  v_sol      uuid;
  r          record;
  maria      constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  if exists (select 1 from public.quotes where tenant_id = v_med and quote_number = 'COT-0002') then
    return;
  end if;

  select id into v_cem   from public.products where tenant_id = v_med and sku = 'CEM-100';
  select id into v_pin   from public.products where tenant_id = v_med and sku = 'PIN-300';
  select id into v_inst  from public.products where tenant_id = v_med and sku = 'INST';
  select id into v_envio from public.products where tenant_id = v_med and sku = 'ENVIO';
  select id into v_hotel    from public.customers where tenant_id = v_med and name = 'Hotel Playa Dorada Suites SRL';
  select id into v_baez     from public.customers where tenant_id = v_med and name = 'Constructora Báez Guzmán SRL';
  select id into v_tavarez  from public.customers where tenant_id = v_med and name = 'Inversiones Tavárez & Asociados SRL';
  select id into v_almonte  from public.customers where tenant_id = v_med and name = 'José Miguel Almonte';
  select id into v_hidalgos from public.customers where tenant_id = v_med and name = 'Ferretería Los Hidalgos SRL';
  if v_cem is null or v_hotel is null then return; end if;

  update public.quotes set terms = 'Neto 45 días' where tenant_id = v_med and terms = 'Neto 45 dias';

  create temp table if not exists _cot_demo (numero text, version int, id uuid, estado text) on commit drop;

  for r in
    select * from (values
      ('COT-0002', 1, v_hotel,    'sent',       'Neto 30 días. Precios válidos por 15 días.', 3,  12, null),
      ('COT-0003', 1, v_baez,     'approved',   'Neto 45 días. Entrega en obra incluida.',    6,  24, null),
      ('COT-0004', 1, v_tavarez,  'rejected',   'Contado.',                                    9,  6,  'Consiguió un precio más bajo en otro suplidor de La Vega.'),
      ('COT-0005', 1, v_almonte,  'expired',    'Contado. Precios válidos por 7 días.',        20, -13, null),
      ('COT-0006', 1, v_hidalgos, 'superseded', 'Neto 30 días.',                               8,  22, null),
      ('COT-0006', 2, v_hidalgos, 'sent',       'Neto 30 días. Se ajustó la cantidad de pintura.', 2, 28, null)
    ) t(numero, version, cliente, estado, terminos, hace, vigencia, motivo)
  loop
    insert into public.quotes
      (tenant_id, quote_number, version, supersedes_id, customer_id, status, valid_until, terms,
       rejected_reason, created_by, sent_at, approved_at, created_at, updated_at)
    values (v_med, r.numero, r.version,
            case when r.version = 2 then v_v1 end,
            -- Nace en borrador: una cotización enviada ya no deja tocar su
            -- contenido (ni sus totales), igual que en la pantalla.
            r.cliente, 'draft', current_date + r.vigencia, r.terminos, r.motivo, maria,
            case when r.estado <> 'draft' then now() - make_interval(days => r.hace) + interval '1 hour' end,
            case when r.estado = 'approved' then now() - make_interval(days => r.hace - 2) end,
            now() - make_interval(days => r.hace), now() - make_interval(days => greatest(r.hace - 2, 0)))
    returning id into v_q;
    if r.numero = 'COT-0006' and r.version = 1 then v_v1 := v_q; end if;
    insert into _cot_demo values (r.numero, r.version, v_q, r.estado);
  end loop;

  -- Líneas (el total de la línea lleva el ITBIS, como en la pantalla).
  for r in
    select c.id as cot, t.* from (values
      ('COT-0002', 1, v_pin,  40::numeric, 1150::numeric, 5::numeric),
      ('COT-0002', 1, v_inst,  2, 900, 0),
      ('COT-0003', 1, v_cem, 200, 410, 0),
      ('COT-0003', 1, v_envio, 4, 350, 0),
      ('COT-0004', 1, v_cem,  60, 440, 0),
      ('COT-0005', 1, v_cem,  12, 465, 0),
      ('COT-0005', 1, v_pin,   2, 1150, 0),
      ('COT-0006', 1, v_pin,  12, 1150, 0),
      ('COT-0006', 2, v_pin,  18, 1150, 3),
      ('COT-0006', 2, v_envio, 1, 350, 0)
    ) t(numero, version, producto, cantidad, precio, descuento)
    join _cot_demo c on c.numero = t.numero and c.version = t.version
  loop
    insert into public.quote_lines
      (quote_id, tenant_id, product_id, quantity, unit_price, discount_pct, tax_rate, line_total)
    values (r.cot, v_med, r.producto, r.cantidad, r.precio, r.descuento, 0.18,
            pg_temp.total(r.cantidad, r.precio, r.descuento, 0.18));
  end loop;

  update public.quotes q
  set subtotal = x.sub, discount = x.descu, tax = x.tax, total = x.sub - x.descu + x.tax
  from (
    select l.quote_id,
           sum(pg_temp.bruto(l.quantity, l.unit_price)) as sub,
           sum(pg_temp.bruto(l.quantity, l.unit_price) - pg_temp.neto(l.quantity, l.unit_price, l.discount_pct)) as descu,
           sum(pg_temp.itbis(l.quantity, l.unit_price, l.discount_pct, l.tax_rate)) as tax
    from public.quote_lines l where l.quote_id in (select id from _cot_demo)
    group by l.quote_id
  ) x
  where q.id = x.quote_id;

  update public.quotes q set status = c.estado from _cot_demo c where q.id = c.id;

  -- Firma: el hotel firmó la cotización COT-0002 desde su teléfono.
  select id into v_q from _cot_demo where numero = 'COT-0002';
  insert into public.signature_requests
    (tenant_id, document_type, document_id, document_label, signer_name, signer_email, status,
     sent_at, signed_at, ip_address, signed_hash, created_by, created_at)
  values (v_med, 'quote', v_q, 'Cotización COT-0002 · Hotel Playa Dorada Suites SRL',
          'Carolina Vásquez', 'mantenimiento@playadoradasuites.do', 'signed',
          now() - interval '3 days', now() - interval '2 days 20 hours', '190.167.44.21',
          encode(sha256(convert_to('COT-0002|Carolina Vásquez|firma-demo', 'UTF8')), 'hex'),
          maria, now() - interval '3 days')
  returning id into v_sol;
  insert into public.signature_events (tenant_id, request_id, event_type, ip_address, occurred_at)
  values (v_med, v_sol, 'created', null, now() - interval '3 days'),
         (v_med, v_sol, 'sent', null, now() - interval '3 days'),
         (v_med, v_sol, 'viewed', '190.167.44.21', now() - interval '2 days 21 hours'),
         (v_med, v_sol, 'signed', '190.167.44.21', now() - interval '2 days 20 hours');

  -- Y Tavárez la declinó, con su motivo.
  select id into v_q from _cot_demo where numero = 'COT-0004';
  insert into public.signature_requests
    (tenant_id, document_type, document_id, document_label, signer_name, signer_email, status,
     sent_at, declined_reason, ip_address, created_by, created_at)
  values (v_med, 'quote', v_q, 'Cotización COT-0004 · Inversiones Tavárez & Asociados SRL',
          'Rafael Tavárez', 'administracion@tavarez.com.do', 'declined',
          now() - interval '9 days', 'Nos quedamos con otro suplidor por precio.', '152.166.10.87',
          maria, now() - interval '9 days')
  returning id into v_sol;
  insert into public.signature_events (tenant_id, request_id, event_type, ip_address, occurred_at)
  values (v_med, v_sol, 'created', null, now() - interval '9 days'),
         (v_med, v_sol, 'sent', null, now() - interval '9 days'),
         (v_med, v_sol, 'viewed', '152.166.10.87', now() - interval '8 days'),
         (v_med, v_sol, 'declined', '152.166.10.87', now() - interval '8 days');
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  6. CRM, oportunidades y marketing
--
--  El embudo tenía una sola oportunidad y tres columnas vacías. Ahora hay
--  una en cada etapa, una ganada y una perdida con su motivo; y los leads
--  vienen de las cuatro fuentes, con sus llamadas y visitas anotadas.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med   uuid;
  v_l     uuid;
  v_camp  uuid;
  r       record;
  maria   constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  if exists (select 1 from public.leads where tenant_id = v_med and name = 'Residencial Brisas del Cibao') then
    return;
  end if;

  for r in
    select * from (values
      ('Residencial Brisas del Cibao', 'Promotora Brisas del Cibao SRL', 'ingenieria@brisascibao.do', '809-971-4410', 'web',      'contacted',    true,  12),
      ('Ferretería La Económica',      'Ferretería La Económica',        'laeconomica.moca@gmail.com', '809-578-2290', 'cold',     'new',          false, 2),
      ('Colegio San Judas Tadeo',      'Fundación Educativa San Judas',  'administracion@csjt.edu.do', '809-535-6620', 'event',    'qualified',    true,  20),
      ('Plaza Comercial Las Palmas',   'Inmobiliaria Las Palmas SRL',    'proyectos@laspalmas.do',     '829-890-3300', 'referral', 'converted',    true,  35),
      ('Taller de Herrería El Yunque', null,                             null,                         '849-266-1180', 'cold',     'disqualified', true,  15)
    ) t(nombre, empresa, correo, tel, fuente, estado, asignado, hace)
  loop
    insert into public.leads
      (tenant_id, name, company, email, phone, source, score, status, assigned_to, created_at, updated_at)
    values (v_med, r.nombre, r.empresa, r.correo, r.tel, r.fuente,
            -- El mismo puntaje que `puntuarLead()`: correo 40, teléfono 20,
            -- fuente (referido 40, evento 30, web 20, frío 10).
            least(100, (case when r.correo is not null then 40 else 0 end)
                     + (case when r.tel is not null then 20 else 0 end)
                     + (case r.fuente when 'referral' then 40 when 'event' then 30
                                      when 'web' then 20 else 10 end)),
            r.estado, case when r.asignado then maria end,
            now() - make_interval(days => r.hace), now() - make_interval(days => greatest(r.hace - 3, 0)))
    returning id into v_l;

    if r.nombre = 'Residencial Brisas del Cibao' then
      insert into public.lead_activities (tenant_id, lead_id, type, notes, occurred_at, created_by)
      values (v_med, v_l, 'email', 'Pidió lista de precios de cemento y varilla por volumen.', now() - interval '11 days', maria),
             (v_med, v_l, 'call', 'Llamada con el ing. Peralta: empiezan la segunda torre en noviembre.', now() - interval '6 days', maria);
      insert into public.opportunities (tenant_id, lead_id, name, amount, stage, probability, expected_close_date, created_at)
      values (v_med, v_l, 'Cemento y varilla - Torre II Brisas del Cibao', 1250000, 'qualification', 0.30, current_date + 45, now() - interval '6 days');
    elsif r.nombre = 'Colegio San Judas Tadeo' then
      insert into public.lead_activities (tenant_id, lead_id, type, notes, occurred_at, created_by)
      values (v_med, v_l, 'meeting', 'Visita al colegio: quieren pintar las 18 aulas en las vacaciones de Navidad.', now() - interval '14 days', maria),
             (v_med, v_l, 'note', 'Enviarles la cotización antes del 15; deciden en la reunión de la junta.', now() - interval '13 days', maria);
      insert into public.opportunities (tenant_id, lead_id, name, amount, stage, probability, expected_close_date, created_at)
      values (v_med, v_l, 'Pintura de aulas - Colegio San Judas Tadeo', 186000, 'proposal', 0.50, current_date + 20, now() - interval '14 days');
    elsif r.nombre = 'Plaza Comercial Las Palmas' then
      insert into public.lead_activities (tenant_id, lead_id, type, notes, occurred_at, created_by)
      values (v_med, v_l, 'meeting', 'Firmaron el acuerdo de suministro para los locales 1 al 12.', now() - interval '20 days', maria);
      insert into public.opportunities (tenant_id, lead_id, name, amount, stage, probability, expected_close_date, created_at)
      values (v_med, v_l, 'Suministro locales 1-12 - Plaza Las Palmas', 420000, 'won', 1, current_date - 18, now() - interval '34 days');
    elsif r.nombre = 'Taller de Herrería El Yunque' then
      insert into public.lead_activities (tenant_id, lead_id, type, notes, occurred_at, created_by)
      values (v_med, v_l, 'call', 'Solo compra varilla suelta cuando le sale un trabajo; no es cliente de volumen.', now() - interval '12 days', maria);
    end if;
  end loop;

  -- Una en prospección (sin lead: la trajo el vendedor de la calle) y una
  -- perdida, con su motivo.
  insert into public.opportunities (tenant_id, lead_id, name, amount, stage, probability, expected_close_date, created_at)
  values (v_med, null, 'Remodelación de la sucursal Banreservas de Bonao', 95000, 'prospecting', 0.10, current_date + 60, now() - interval '3 days');
  insert into public.opportunities (tenant_id, lead_id, name, amount, stage, probability, expected_close_date, lost_reason, created_at)
  values (v_med, null, 'Cemento para el muelle de Sans Souci', 610000, 'lost', 0, current_date - 10,
          'La licitación se la llevó un importador directo con precio de fábrica.', now() - interval '40 days');

  -- Una campaña ya enviada por WhatsApp, con sus aperturas y clics, y otra
  -- programada para el lunes.
  insert into public.campaigns
    (tenant_id, name, channel, subject, message, status, target_status, utm_source, utm_medium, utm_campaign,
     sent_at, created_by, created_at)
  values (v_med, 'Lista de precios de octubre', 'whatsapp', null,
          'Buenas. Ya tenemos la lista de precios de octubre: el cemento se mantiene a RD$ 465 el saco y a RD$ 440 desde 50 sacos. Pídanos su cotización por aquí.',
          'sent', 'qualified', 'crm', 'whatsapp', 'precios-octubre',
          now() - interval '4 days', maria, now() - interval '5 days')
  returning id into v_camp;
  insert into public.campaign_recipients (tenant_id, campaign_id, lead_id, sent_at, opened_at, clicked_at)
  select v_med, v_camp, l.id, now() - interval '4 days',
         case when l.name <> 'Constructora Vega Real' then now() - interval '4 days' + interval '2 hours' end,
         case when l.name = 'Colegio San Judas Tadeo' then now() - interval '3 days' end
  from public.leads l where l.tenant_id = v_med and l.status = 'qualified';

  insert into public.campaigns
    (tenant_id, name, channel, subject, message, status, target_source, utm_source, utm_medium, utm_campaign,
     scheduled_at, created_by)
  values (v_med, 'Pintura para la Navidad', 'email', 'Deje su negocio listo para diciembre',
          'Pintura acrílica blanca a RD$ 1,150 el galón y aplicación en sitio. Separe su fecha antes del 15 de noviembre.',
          'scheduled', 'web', 'crm', 'email', 'pintura-navidad',
          (date_trunc('week', now() at time zone 'America/Santo_Domingo') + interval '7 days 9 hours') at time zone 'America/Santo_Domingo', maria);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  7. Contratos, cobros, portal, mesa de ayuda, fidelización y tienda
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med      uuid;
  v_hotel    uuid;
  v_baez     uuid;
  v_duarte   uuid;
  v_hidalgos uuid;
  v_tavarez  uuid;
  v_ana      uuid;
  v_martillo uuid;
  v_almonte  uuid;
  v_canal    uuid;
  v_web      uuid;
  v_pin      uuid;
  v_cem      uuid;
  v_t        uuid;
  v_pl       uuid;
  maria      constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  if exists (select 1 from public.contracts where tenant_id = v_med and contract_number = 'CTR-0002') then
    return;
  end if;

  select id into v_hotel    from public.customers where tenant_id = v_med and name = 'Hotel Playa Dorada Suites SRL';
  select id into v_baez     from public.customers where tenant_id = v_med and name = 'Constructora Báez Guzmán SRL';
  select id into v_duarte   from public.customers where tenant_id = v_med and name = 'Constructora Duarte SRL';
  select id into v_hidalgos from public.customers where tenant_id = v_med and name = 'Ferretería Los Hidalgos SRL';
  select id into v_tavarez  from public.customers where tenant_id = v_med and name = 'Inversiones Tavárez & Asociados SRL';
  select id into v_ana      from public.customers where tenant_id = v_med and name = 'Colmado Doña Ana';
  select id into v_martillo from public.customers where tenant_id = v_med and name = 'Ferretería El Martillo SRL';
  select id into v_almonte  from public.customers where tenant_id = v_med and name = 'José Miguel Almonte';
  select id into v_pin from public.products where tenant_id = v_med and sku = 'PIN-300';
  select id into v_cem from public.products where tenant_id = v_med and sku = 'CEM-100';
  if v_hotel is null or v_pin is null then return; end if;

  perform pg_temp.como(v_med);

  -- Contratos: mantenimiento trimestral del hotel, un suministro anual en
  -- borrador y uno de alquiler de andamios ya vencido.
  insert into public.contracts
    (tenant_id, contract_number, customer_id, status, billing_frequency, start_date, end_date,
     base_amount, escalation_pct, auto_renew, created_by, created_at)
  values
    (v_med, 'CTR-0002', v_hotel, 'active', 'quarterly', current_date - 200, current_date + 165,
     48000, 0.04, true, maria, now() - interval '200 days'),
    (v_med, 'CTR-0003', v_baez, 'draft', 'annual', current_date + 5, current_date + 370,
     1200000, 0.06, false, maria, now() - interval '2 days'),
    (v_med, 'CTR-0004', v_hidalgos, 'expired', 'monthly', current_date - 400, current_date - 35,
     8500, 0, false, maria, now() - interval '400 days');

  -- Cobros: un enlace vencido que nadie pagó y uno cancelado.
  insert into public.payment_links (tenant_id, customer_id, amount, description, status, expires_at, created_by, created_at)
  values (v_med, v_tavarez, 12500, 'Anticipo del 50 % - pintura oficinas La Vega', 'expired', current_date - 6, maria, now() - interval '16 days'),
         (v_med, v_almonte, 3800, 'Saldo de la entrega del 12 de septiembre', 'canceled', current_date + 3, maria, now() - interval '9 days'),
         (v_med, v_hotel, 24000, 'Primer pago trimestral - mantenimiento', 'pending', current_date + 10, maria, now() - interval '1 day');
  insert into public.recurring_charges
    (tenant_id, customer_id, amount, description, frequency, next_charge_date, created_by)
  values (v_med, v_hidalgos, 2500, 'Alquiler de la mezcladora de 1 saco', 'weekly', current_date + 4, maria),
         (v_med, v_hotel, 16000, 'Mantenimiento de pintura de áreas comunes', 'monthly', current_date + 12, maria);

  -- Portal: una invitación que el cliente todavía no ha abierto y una
  -- revocada. (La pantalla crea las invitaciones ya activas: una
  -- "pendiente" no tendría enlace que mandar.)
  insert into public.portal_invites (tenant_id, customer_id, email, token, status, created_by, activated_at, created_at)
  values (v_med, v_hotel, 'mantenimiento@playadoradasuites.do', 'demo-hotel-portal-2026', 'active', maria,
          now() - interval '1 day', now() - interval '1 day');
  insert into public.portal_invites (tenant_id, customer_id, email, token, status, created_by, revoked_at, created_at)
  values (v_med, v_tavarez, 'administracion@tavarez.com.do', 'demo-tavarez-portal-2026', 'revoked', maria,
          now() - interval '12 days', now() - interval '40 days');
  update public.portal_invites set last_accessed_at = now() - interval '5 hours'
  where tenant_id = v_med and token = 'demo-martillo-portal-2026' and last_accessed_at is null;

  -- Mesa de ayuda: uno en curso, uno esperando al cliente, uno resuelto y
  -- uno cerrado con su calificación.
  insert into public.tickets (tenant_id, customer_id, subject, description, priority, status, sla_due_at, assigned_to, created_by, created_at, updated_at)
  values (v_med, v_baez, 'Faltaron 5 sacos en la entrega del lunes',
          'El conduce dice 20 sacos y en obra contaron 15. Piden que se complete o se ajuste la factura.',
          'urgent', 'in_progress', now() + interval '2 hours', maria, maria, now() - interval '6 hours', now() - interval '1 hour')
  returning id into v_t;
  insert into public.ticket_messages (tenant_id, ticket_id, author_type, body, created_at)
  values (v_med, v_t, 'customer', 'El maestro de obra contó 15 sacos. Les mando la foto del conduce firmado.', now() - interval '6 hours'),
         (v_med, v_t, 'agent', 'Recibido. Lo estamos verificando con el chofer y le confirmamos antes de las 4.', now() - interval '1 hour');

  insert into public.tickets (tenant_id, customer_id, subject, description, priority, status, sla_due_at, assigned_to, created_by, created_at, updated_at)
  values (v_med, v_hotel, 'Color de la pintura no coincide con la muestra',
          'La pintura de la última entrega se ve más amarillenta que la muestra aprobada.',
          'normal', 'waiting_customer', now() + interval '1 day', maria, maria, now() - interval '2 days', now() - interval '1 day')
  returning id into v_t;
  insert into public.ticket_messages (tenant_id, ticket_id, author_type, body, created_at)
  values (v_med, v_t, 'customer', 'Las cubetas del lote nuevo se ven distintas a las anteriores.', now() - interval '2 days'),
         (v_med, v_t, 'agent', '¿Nos puede enviar el número de lote que aparece en la tapa? Así lo reclamamos a fábrica.', now() - interval '1 day');

  insert into public.tickets (tenant_id, customer_id, subject, description, priority, status, assigned_to, created_by, resolved_at, created_at, updated_at)
  values (v_med, v_duarte, 'Factura con el RNC equivocado',
          'La factura salió con el RNC de otra empresa del grupo.', 'high', 'resolved', maria, maria,
          now() - interval '3 days', now() - interval '5 days', now() - interval '3 days')
  returning id into v_t;
  insert into public.ticket_messages (tenant_id, ticket_id, author_type, body, created_at)
  values (v_med, v_t, 'customer', 'La factura debe salir a nombre de Constructora Duarte, no de Inmobiliaria Duarte.', now() - interval '5 days'),
         (v_med, v_t, 'agent', 'Corregido: se emitió la nota de crédito y la factura nueva con el RNC correcto.', now() - interval '3 days');

  insert into public.tickets (tenant_id, customer_id, subject, description, priority, status, assigned_to, created_by, resolved_at, closed_at, satisfaction_rating, created_at, updated_at)
  values (v_med, v_ana, '¿Hacen entregas en Bonao los sábados?',
          'Quiere saber si el camión sube a Bonao los sábados en la mañana.', 'low', 'closed', maria, maria,
          now() - interval '9 days', now() - interval '8 days', 5, now() - interval '10 days', now() - interval '8 days')
  returning id into v_t;
  insert into public.ticket_messages (tenant_id, ticket_id, author_type, body, created_at)
  values (v_med, v_t, 'customer', 'Buenas, ¿el camión sube a Bonao los sábados?', now() - interval '10 days'),
         (v_med, v_t, 'agent', 'Sí, los sábados de 8 a 12. El pedido debe estar confirmado el viernes antes de las 3.', now() - interval '9 days');

  -- Fidelización: puntos por compras de otros clientes, cupones en los tres
  -- estados y un referido completado.
  insert into public.loyalty_transactions (tenant_id, customer_id, points, reason, source_type, created_by, created_at)
  values (v_med, v_hidalgos, 420, 'Compras de agosto', 'purchase', maria, now() - interval '30 days'),
         (v_med, v_hidalgos, 150, 'Bono por referir a Colmado Doña Ana', 'referral_bonus', maria, now() - interval '12 days'),
         (v_med, v_hotel, 610, 'Compra de pintura para el bloque A', 'purchase', maria, now() - interval '25 days'),
         (v_med, v_hotel, -300, 'Canjeó RD$ 300 en la factura de septiembre', 'redemption', maria, now() - interval '8 days'),
         (v_med, v_ana, 60, 'Compras de mostrador', 'purchase', maria, now() - interval '6 days');
  insert into public.loyalty_coupons (tenant_id, code, customer_id, discount_type, discount_value, status, expires_at, redeemed_at, created_by, created_at)
  values (v_med, 'PINTURA500', v_hotel, 'fixed', 500, 'redeemed', now() + interval '20 days', now() - interval '8 days', maria, now() - interval '20 days'),
         (v_med, 'VERANO15', null, 'percentage', 0.15, 'expired', now() - interval '25 days', null, maria, now() - interval '70 days'),
         (v_med, 'OBRA5', v_baez, 'percentage', 0.05, 'active', now() + interval '45 days', null, maria, now() - interval '2 days');
  insert into public.loyalty_referrals (tenant_id, referrer_customer_id, referred_customer_id, bonus_points, status, completed_at, created_at)
  values (v_med, v_hidalgos, v_ana, 150, 'completed', now() - interval '12 days', now() - interval '20 days');

  -- Tienda en línea: la tienda de WooCommerce, más productos vinculados y
  -- pedidos importados y cancelados, no solo uno por importar.
  update public.channel_orders set customer_name = 'Yolanda Pérez'
  where tenant_id = v_med and customer_name = 'Yolanda Perez';
  select id into v_canal from public.sales_channels where tenant_id = v_med and name = 'Tienda Shopify';
  insert into public.sales_channels (tenant_id, name, platform, store_url, status, created_at)
  values (v_med, 'Tienda WooCommerce', 'woocommerce', 'tienda.distribuidoracaribe.do', 'disconnected', now() - interval '90 days')
  returning id into v_web;
  if v_canal is not null then
    insert into public.channel_product_links (tenant_id, channel_id, product_id, external_sku, synced_at)
    values (v_med, v_canal, v_pin, 'pintura-blanca-acrilica-galon', now() - interval '2 hours')
    on conflict do nothing;
    insert into public.channel_orders (tenant_id, channel_id, external_order_id, customer_name, customer_email, total, status, received_at, resolved_at)
    values (v_med, v_canal, '#SHOP-1039', 'Ramón Antonio Guzmán', 'ramon.guzman@gmail.com', 2714.00, 'imported', now() - interval '3 days', now() - interval '3 days' + interval '20 minutes')
    returning id into v_t;
    insert into public.channel_order_lines (tenant_id, order_id, product_id, external_sku, quantity, unit_price)
    values (v_med, v_t, v_pin, 'pintura-blanca-acrilica-galon', 2, 1150.00);

    insert into public.channel_orders (tenant_id, channel_id, external_order_id, customer_name, customer_email, total, status, received_at, resolved_at)
    values (v_med, v_canal, '#SHOP-1040', 'Luisa Fernanda Mejía', 'luisa.mejia@hotmail.com', 1357.00, 'cancelled', now() - interval '2 days', now() - interval '2 days' + interval '1 hour')
    returning id into v_t;
    insert into public.channel_order_lines (tenant_id, order_id, product_id, external_sku, quantity, unit_price)
    values (v_med, v_t, v_pin, 'pintura-blanca-acrilica-galon', 1, 1150.00);

    insert into public.channel_orders (tenant_id, channel_id, external_order_id, customer_name, customer_email, total, status, received_at)
    values (v_med, v_canal, '#SHOP-1043', 'Pedro Julio Castillo', 'pjcastillo@gmail.com', 7386.80, 'received', now() - interval '40 minutes')
    returning id into v_t;
    insert into public.channel_order_lines (tenant_id, order_id, product_id, external_sku, quantity, unit_price)
    values (v_med, v_t, v_pin, 'pintura-blanca-acrilica-galon', 4, 1100.00),
           (v_med, v_t, v_cem, 'cemento-gris-425kg', 4, 465.00);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  8. Facturas del mes pasado, con NCF
--
--  El IT-1 y el 607 que se declaran este mes son los del mes pasado, y la
--  distribuidora no tenía ni una factura con comprobante en ese período:
--  el ITBIS cobrado salía en cero. Tres facturas, con el NCF sacado de su
--  secuencia (`assign_ncf`), el ITBIS al 18 % y sus cobros: dos de
--  crédito fiscal (B01) a clientes con RNC y una de consumo (B02).
--  Son manuales, como las FAC-DEMO de demo.sql: no mueven inventario.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med      uuid;
  v_hidalgos uuid;
  v_baez     uuid;
  v_ana      uuid;
  v_pin      uuid;
  v_cem      uuid;
  v_envio    uuid;
  v_inv      uuid;
  v_n        int;
  v_ncf      text;
  v_mes      date := (date_trunc('month', current_date) - interval '1 month')::date;
  r          record;
  maria      constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  if exists (select 1 from public.customer_invoices
             where tenant_id = v_med and notes = 'Orden de compra OC-HID-0815 del cliente.') then
    return;
  end if;

  select id into v_hidalgos from public.customers where tenant_id = v_med and name = 'Ferretería Los Hidalgos SRL';
  select id into v_baez     from public.customers where tenant_id = v_med and name = 'Constructora Báez Guzmán SRL';
  select id into v_ana      from public.customers where tenant_id = v_med and name = 'Colmado Doña Ana';
  select id into v_pin   from public.products where tenant_id = v_med and sku = 'PIN-300';
  select id into v_cem   from public.products where tenant_id = v_med and sku = 'CEM-100';
  select id into v_envio from public.products where tenant_id = v_med and sku = 'ENVIO';
  if v_hidalgos is null or v_baez is null or v_ana is null or v_pin is null then return; end if;

  perform pg_temp.como(v_med);

  for r in
    select * from (values
      (1, v_hidalgos, 'B01',  7, 30, 'Orden de compra OC-HID-0815 del cliente.'),
      (2, v_baez,     'B01', 18, 45, 'Obra Residencial Los Prados, primera tanda.'),
      (3, v_ana,      'B02', 26,  0, 'Venta de contado en el mostrador.')
    ) t(orden, cliente, tipo, dia, plazo, notas)
    order by orden
  loop
    insert into public.customer_invoice_counters as c (tenant_id, year, last_n)
    values (v_med, extract(year from now())::smallint, 1)
    on conflict (tenant_id, year) do update set last_n = c.last_n + 1
    returning last_n into v_n;
    v_ncf := public.assign_ncf(v_med, r.tipo);

    insert into public.customer_invoices
      (tenant_id, number, customer_id, source_type, issue_date, due_date,
       subtotal, discount, tax, total, status, notes, created_by, ncf, ncf_type, buyer_tax_id, created_at)
    select v_med, format('FA-%s-%s', extract(year from now())::int, lpad(v_n::text, 5, '0')),
           r.cliente, 'manual', v_mes + r.dia, v_mes + r.dia + r.plazo,
           0, 0, 0, 0, 'open', r.notas, maria, v_ncf, r.tipo,
           replace(c.tax_id, '-', ''), (v_mes + r.dia)::timestamptz + interval '10 hours'
    from public.customers c where c.id = r.cliente
    returning id into v_inv;

    -- Líneas: (factura, producto, cantidad, precio)
    insert into public.customer_invoice_lines
      (invoice_id, tenant_id, product_id, description, unit, qty, unit_price, discount_pct, tax_rate,
       subtotal, tax, line_total)
    select v_inv, v_med, p.id, p.name, p.unit, x.qty, x.precio, 0, 0.18,
           pg_temp.neto(x.qty, x.precio, 0), pg_temp.itbis(x.qty, x.precio, 0, 0.18),
           pg_temp.total(x.qty, x.precio, 0, 0.18)
    from (values
      (1, v_pin, 20::numeric, 1150::numeric),
      (2, v_cem, 60, 440),
      (3, v_pin, 4, 1150),
      (3, v_envio, 1, 350)
    ) x(orden, producto, qty, precio)
    join public.products p on p.id = x.producto
    where x.orden = r.orden;

    update public.customer_invoices i
    set subtotal = t.sub, tax = t.tax, total = t.sub + t.tax
    from (select sum(subtotal) as sub, sum(tax) as tax
          from public.customer_invoice_lines where invoice_id = v_inv) t
    where i.id = v_inv;

    -- El mismo evento que emite `facturarPedido`: la contabilidad asienta
    -- la factura (CxC contra ventas e ITBIS) antes que su cobro.
    perform public.emit_event('ar.invoice.issued',
      jsonb_build_object('invoiceId', v_inv,
                         'number', (select number from public.customer_invoices where id = v_inv)),
      'ar');

    -- Los cobros: Los Hidalgos pagó completo por transferencia, Báez Guzmán
    -- abonó con cheque y Doña Ana pagó en efectivo al momento.
    insert into public.customer_payments
      (tenant_id, invoice_id, amount, method, reference, received_by, received_at)
    select v_med, v_inv,
           case r.orden when 2 then 15000 else i.total end,
           case r.orden when 1 then 'transfer' when 2 then 'check' else 'cash' end,
           case r.orden when 1 then 'BHD-90412' when 2 then 'CHQ 000318 Banreservas' end,
           maria,
           (v_mes + r.dia + case r.orden when 1 then 16 when 2 then 11 else 0 end)::timestamptz + interval '15 hours'
    from public.customer_invoices i where i.id = v_inv;

    update public.customer_invoices
    set status = case r.orden when 2 then 'partially_paid' else 'paid' end
    where id = v_inv;
  end loop;
end $$;

-- Corrección: una primera versión de la sección 8 no emitió
-- `ar.invoice.issued` para las facturas del mes pasado. Se emite ahora,
-- una sola vez por factura.
do $$
declare
  v_med uuid;
  f     record;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  perform pg_temp.como(v_med);
  for f in
    select i.id, i.number from public.customer_invoices i
    where i.tenant_id = v_med and i.source_type = 'manual' and i.ncf is not null
      and i.notes in ('Orden de compra OC-HID-0815 del cliente.',
                      'Obra Residencial Los Prados, primera tanda.',
                      'Venta de contado en el mostrador.')
      and not exists (select 1 from public.event_outbox e
                      where e.tenant_id = v_med and e.type = 'ar.invoice.issued'
                        and (e.payload->>'invoiceId' = i.id::text or e.payload->>'number' = i.number))
    order by i.issue_date
  loop
    perform public.emit_event('ar.invoice.issued',
      jsonb_build_object('invoiceId', f.id, 'number', f.number), 'ar');
  end loop;
end $$;

-- Corrección: en una primera versión el colmado no tenía secuencia B01 y
-- sus tickets a clientes con RNC o cédula quedaron sin comprobante. Se
-- crea la secuencia y se les asigna el NCF que les tocaba.
do $$
declare
  v_pyme uuid;
  t      record;
begin
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  if v_pyme is null then return; end if;
  perform pg_temp.como(v_pyme);
  if not exists (select 1 from public.ncf_sequences
                 where tenant_id = v_pyme and ncf_type = 'B01' and is_active) then
    insert into public.ncf_sequences
      (tenant_id, ncf_type, range_from, range_to, next_number, expires_on, authorization_ref)
    values (v_pyme, 'B01', 1, 500, 1, (current_date + interval '1 year')::date, 'DEMO-B01');
  end if;
  for t in
    select s.id from public.pos_sales s
    join public.customers c on c.id = s.customer_id
    where s.tenant_id = v_pyme and s.ncf is null and not s.voided and c.tax_id is not null
      and s.client_ref in (select md5('ventas-pyme-' || x)::uuid
                           from unnest(array['t0-2','t1-2','t1-3','t2-2']) x)
    order by s.sold_at
  loop
    update public.pos_sales
    set ncf = public.assign_ncf(v_pyme, 'B01'), ncf_type = 'B01'
    where id = t.id;
  end loop;
end $$;

-- Corrección: una primera versión de este archivo dejó la invitación del
-- hotel en 'pending', un estado al que la pantalla nunca llega.
update public.portal_invites
set status = 'active', activated_at = coalesce(activated_at, created_at)
where token = 'demo-hotel-portal-2026' and status = 'pending';
