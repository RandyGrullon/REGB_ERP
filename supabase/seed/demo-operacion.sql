-- ═══════════════════════════════════════════════════════════════════════
--  Datos de demostración del área de Inventario, compras y operación
--
--  La demo de `demo.sql` dejaba estas pantallas con un solo registro o
--  vacías: un catálogo de siete productos sin categorías ni códigos de
--  barra, tres existencias, dos proveedores, un compresor como único
--  equipo, una orden de producción sin reportes ni consumo, y la flota y
--  las rutas en cero. Así no se le puede enseñar a un almacenista, a un
--  comprador ni a un técnico cómo se ve su día.
--
--  Aquí se llena lo que falta con datos creíbles de RD: RNC y cédulas
--  que pasan el dígito verificador, montos en RD$, ITBIS del 18 %,
--  placas dominicanas (L = carga, K = motor), direcciones reales.
--
--  Reglas de este archivo:
--   · Idempotente. Cada bloque tiene su ancla (un SKU, un código, un
--     número de orden, un texto fijo) y no hace nada si ya corrió.
--   · La mercancía entra y sale por `inventory_movements`, como en la
--     pantalla: el trigger de 0019 recalcula existencias y costo promedio.
--   · No toca las anclas de `demo.sql` (nombres de almacenes, clientes,
--     planes, proveedores): cambiarlas duplicaría esos registros en la
--     próxima corrida. Sí corrige textos que no son ancla (nombres de
--     productos por SKU, unidades, ubicaciones).
--   · Las fechas son relativas a `current_date`: la demo envejece sola.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Ayudantes de esta sesión (pg_temp: desaparecen al terminar) ─────────

-- EAN-13 con su dígito verificador, igual que `generarEan13()`.
create or replace function pg_temp.ean13(p_base12 text) returns text
language plpgsql immutable as $$
declare s int := 0; i int;
begin
  for i in 1..12 loop
    s := s + substr(p_base12, i, 1)::int * (case when i % 2 = 0 then 3 else 1 end);
  end loop;
  return p_base12 || ((10 - s % 10) % 10)::text;
end $$;

-- RNC de 9 dígitos con el verificador de la DGII (módulo 11, pesos 7..2).
create or replace function pg_temp.rnc(p_base8 text) returns text
language plpgsql immutable as $$
declare pesos int[] := array[7, 9, 8, 6, 5, 4, 3, 2]; s int := 0; r int; d int; i int;
begin
  for i in 1..8 loop s := s + substr(p_base8, i, 1)::int * pesos[i]; end loop;
  r := s % 11;
  d := case r when 0 then 2 when 1 then 1 else 11 - r end;
  return format('%s-%s-%s', substr(p_base8, 1, 3), substr(p_base8, 4, 5), d);
end $$;

-- Cédula de 11 dígitos con su verificador (Luhn con pesos 1,2).
create or replace function pg_temp.cedula(p_base10 text) returns text
language plpgsql immutable as $$
declare s int := 0; p int; i int;
begin
  for i in 1..10 loop
    p := substr(p_base10, i, 1)::int * (case when i % 2 = 0 then 2 else 1 end);
    s := s + (case when p > 9 then p / 10 + p % 10 else p end);
  end loop;
  return format('%s-%s-%s', substr(p_base10, 1, 3), substr(p_base10, 4, 7), (10 - s % 10) % 10);
end $$;

-- Una hora del día en RD (la base guarda UTC): "mañana a las 9" es a las 9 de aquí.
create or replace function pg_temp.rd(p_dia date, p_hora time) returns timestamptz
language sql immutable as $$ select (p_dia + p_hora) at time zone 'America/Santo_Domingo' $$;

-- Entrada de existencias inicial, una sola vez por producto y almacén.
create or replace function pg_temp.existencia_inicial(
  p_tenant uuid, p_almacen uuid, p_sku text, p_qty numeric, p_costo numeric,
  p_hace interval, p_quien uuid
) returns void language plpgsql as $$
declare v_prod uuid;
begin
  select id into v_prod from public.products where tenant_id = p_tenant and sku = p_sku;
  if v_prod is null or p_almacen is null then return; end if;
  if exists (
    select 1 from public.inventory_movements
    where tenant_id = p_tenant and warehouse_id = p_almacen and product_id = v_prod
      and reason = 'Inventario inicial'
  ) then return; end if;
  insert into public.inventory_movements
    (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, reason, created_by, created_at)
  values (p_tenant, p_almacen, v_prod, 'adjustment_in', p_qty, p_costo, 'Inventario inicial',
          p_quien, now() - p_hace);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  1. Catálogo de la distribuidora: tildes, categorías, productos que
--     faltaban, puntos de reorden y códigos de barra.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med uuid;
  v_cat uuid;
  r     record;
  n     int;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  -- Nombres y unidades con tildes, solo si siguen siendo el texto de fábrica.
  update public.products p set name = x.nuevo
  from (values
    ('ENVIO',   'Envío a domicilio',          'Envío a domicilio'),
    ('INST',    'Instalación en sitio',       'Instalación en sitio'),
    ('KIT-100', 'Kit básico de reparación',   'Kit básico de reparación'),
    ('PIN-300', 'Pintura blanca acrílica gl', 'Pintura blanca acrílica (galón)')
  ) as x(sku, viejo, nuevo)
  where p.tenant_id = v_med and p.sku = x.sku and p.name = x.viejo;

  update public.products set unit = 'galón' where tenant_id = v_med and unit = 'galon';
  update public.products set category = 'Ferretería' where tenant_id = v_med and category = 'Ferreteria';
  update public.products set category = 'Construcción' where tenant_id = v_med and category = 'Construccion';

  -- Lo que vende de verdad una distribuidora de materiales.
  insert into public.products (tenant_id, sku, name, category, unit, price, cost, tax_rate, tracks_stock)
  values
    (v_med, 'BLK-600', 'Block de hormigón de 6 pulgadas',   'Construcción', 'unidad',     42.00,   33.00, 0.18, true),
    (v_med, 'ARN-LAV', 'Arena lavada (metro cúbico)',       'Construcción', 'm³',       1850.00, 1450.00, 0.18, true),
    (v_med, 'PVC-050', 'Tubo PVC de 1/2 pulgada × 19 pies', 'Plomería',     'unidad',    165.00,  118.00, 0.18, true),
    (v_med, 'CLV-300', 'Clavos de 3 pulgadas (libra)',      'Ferretería',   'libra',      75.00,   52.00, 0.18, true),
    (v_med, 'ALM-DUL', 'Alambre dulce (libra)',             'Ferretería',   'libra',      68.00,   49.00, 0.18, true),
    (v_med, 'MAS-500', 'Masilla para paredes (cubeta 5 gal)','Pinturas',    'cubeta',   2450.00, 1890.00, 0.18, true)
  on conflict (tenant_id, sku) do nothing;

  -- Categorías: las mismas que ya usa el catálogo como texto, ahora de verdad.
  for r in
    select distinct category as nombre from public.products
    where tenant_id = v_med and category is not null
  loop
    select id into v_cat from public.product_categories
      where tenant_id = v_med and parent_id is null and name = r.nombre;
    if v_cat is null then
      insert into public.product_categories (tenant_id, name) values (v_med, r.nombre)
      returning id into v_cat;
    end if;
    update public.products set category_id = v_cat
      where tenant_id = v_med and category = r.nombre and category_id is null;
  end loop;

  -- demo.sql puso el cemento y la varilla en Ferretería y el kit de
  -- reparación en Construcción; al revés de como lo acomoda una
  -- distribuidora (y de la varilla reforzada, que ya está en Construcción).
  update public.products p
  set category = x.nueva,
      category_id = (select c.id from public.product_categories c
                     where c.tenant_id = v_med and c.parent_id is null and c.name = x.nueva)
  from (values
    ('CEM-100', 'Ferretería',   'Construcción'),
    ('VAR-200', 'Ferretería',   'Construcción'),
    ('KIT-100', 'Construcción', 'Ferretería')
  ) as x(sku, vieja, nueva)
  where p.tenant_id = v_med and p.sku = x.sku and p.category = x.vieja
    and exists (select 1 from public.product_categories c
                where c.tenant_id = v_med and c.parent_id is null and c.name = x.nueva);

  -- Punto de reorden: a partir de aquí la existencia sale "Baja".
  update public.products p set reorder_point = x.punto
  from (values
    ('CEM-100', 40), ('VAR-200', 100), ('PIN-300', 12), ('BLK-600', 500), ('ARN-LAV', 5),
    ('PVC-050', 30), ('CLV-300', 50), ('ALM-DUL', 40), ('MAS-500', 5), ('VAR-REF', 20)
  ) as x(sku, punto)
  where p.tenant_id = v_med and p.sku = x.sku and p.reorder_point is null;

  -- Códigos EAN-13 internos (prefijo 20, el mismo rango que usa "Generar
  -- códigos faltantes"). El kit se queda sin código a propósito: es lo
  -- que se fabrica aquí y sirve para enseñar el botón de generar.
  select count(*) into n from public.products where tenant_id = v_med and barcode like '20%';
  for r in
    select id from public.products
    where tenant_id = v_med and active and tracks_stock and barcode is null and sku <> 'KIT-100'
    order by sku
  loop
    n := n + 1;
    update public.products set barcode = pg_temp.ean13('20' || lpad(n::text, 10, '0'))
      where id = r.id;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  2. Existencias iniciales de la distribuidora (hace 45 días), para que
--     Existencias, Almacenes y el kardex no se queden en tres líneas.
--     Las anota Ramón, el encargado de almacén.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med   uuid;
  v_sd    uuid;
  v_stgo  uuid;
  v_ramon constant uuid := '00000000-0000-0000-0000-000000000104';
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_sd from public.warehouses where tenant_id = v_med and code = 'ALM-SD';
  select id into v_stgo from public.warehouses where tenant_id = v_med and name in ('Almacén Santiago', 'Almacén Santiago');

  -- El almacén de Santiago no tenía código ni sucursal.
  update public.warehouses w set code = 'ALM-STI',
         branch_id = coalesce(w.branch_id, (select b.id from public.branches b
                                             where b.tenant_id = v_med and b.name = 'Santiago' limit 1))
  where w.id = v_stgo and w.code is null;

  perform pg_temp.existencia_inicial(v_med, v_sd, 'VAR-200', 380,  240.00, interval '45 days', v_ramon);
  perform pg_temp.existencia_inicial(v_med, v_sd, 'BLK-600', 2400,  33.00, interval '45 days', v_ramon);
  perform pg_temp.existencia_inicial(v_med, v_sd, 'ARN-LAV', 18,  1450.00, interval '45 days', v_ramon);
  perform pg_temp.existencia_inicial(v_med, v_sd, 'PVC-050', 140,  118.00, interval '45 days', v_ramon);
  perform pg_temp.existencia_inicial(v_med, v_sd, 'CLV-300', 260,   52.00, interval '45 days', v_ramon);
  perform pg_temp.existencia_inicial(v_med, v_sd, 'ALM-DUL', 180,   49.00, interval '45 days', v_ramon);
  perform pg_temp.existencia_inicial(v_med, v_sd, 'MAS-500', 22,  1890.00, interval '45 days', v_ramon);

  perform pg_temp.existencia_inicial(v_med, v_stgo, 'VAR-200', 90,  240.00, interval '45 days', v_ramon);
  perform pg_temp.existencia_inicial(v_med, v_stgo, 'BLK-600', 600,  33.00, interval '45 days', v_ramon);
  perform pg_temp.existencia_inicial(v_med, v_stgo, 'CLV-300', 60,   52.00, interval '45 days', v_ramon);
  perform pg_temp.existencia_inicial(v_med, v_stgo, 'PIN-300', 6,   890.00, interval '45 days', v_ramon);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  3. Proveedores: tres más, con RNC válido, sus papeles, cuentas de
--     banco y evaluaciones. El RNC de Materiales Del Este no pasaba el
--     dígito verificador (el 606 lo rechazaría): se corrige.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med     uuid;
  v_este    uuid;
  v_central uuid;
  v_aceros  uuid;
  v_pint    uuid;
  v_plast   uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  update public.suppliers set tax_id = pg_temp.rnc('13298765'),
         email = coalesce(email, 'ventas@materialesdeleste.com.do'),
         address = coalesce(address, 'Autopista de San Isidro km 12, Santo Domingo Este')
  where tenant_id = v_med and code = 'PROV-001' and tax_id = '132-98765-3';

  update public.suppliers set phone = coalesce(phone, '809-688-1540'),
         email = coalesce(email, 'compras@ferrecentral.com.do'),
         address = coalesce(address, 'Av. Máximo Gómez 118, Villa Juana, Santo Domingo')
  where tenant_id = v_med and name in ('Ferretería Central Import SRL', 'Ferretería Central Import SRL');

  insert into public.suppliers
    (tenant_id, code, name, tax_id, phone, email, address, payment_terms, qualification_status, notes)
  values
    (v_med, 'PROV-003', 'Aceros y Varillas Quisqueya SRL', pg_temp.rnc('13145678'), '809-560-4410',
     'ventas@acerosquisqueya.com.do', 'Av. Isabel Aguiar 212, Herrera, Santo Domingo Oeste', 45,
     'qualified', 'Entrega en 48 horas en Santo Domingo; flete aparte para Santiago.'),
    (v_med, 'PROV-004', 'Pinturas Tropical Caribe SRL', pg_temp.rnc('13178902'), '809-567-2231',
     'pedidos@pinturastropical.com.do', 'C/ Juan Erazo 44, Villa Juana, Santo Domingo', 30,
     'qualified', 'Descuento de 5 % por pago antes de 10 días.'),
    (v_med, 'PROV-005', 'Plásticos y Tuberías del Norte SRL', pg_temp.rnc('13022456'), '809-241-7788',
     'ventas@tuberiasdelnorte.com.do', 'Av. Circunvalación 310, Santiago de los Caballeros', 15,
     'pending', null)
  on conflict (tenant_id, code) do nothing;

  select id into v_este    from public.suppliers where tenant_id = v_med and code = 'PROV-001';
  select id into v_central from public.suppliers where tenant_id = v_med and name in ('Ferretería Central Import SRL', 'Ferretería Central Import SRL');
  select id into v_aceros  from public.suppliers where tenant_id = v_med and code = 'PROV-003';
  select id into v_pint    from public.suppliers where tenant_id = v_med and code = 'PROV-004';
  select id into v_plast   from public.suppliers where tenant_id = v_med and code = 'PROV-005';

  -- Papeles. Pinturas Tropical tiene la certificación de la DGII vencida.
  if v_aceros is not null and not exists (select 1 from public.supplier_documents where supplier_id = v_aceros) then
    insert into public.supplier_documents (tenant_id, supplier_id, doc_type, doc_number, issued_at, expires_at, notes)
    values
      (v_med, v_aceros, 'rnc_certificate', 'RNC-1314567', current_date - 400, current_date + 330, null),
      (v_med, v_aceros, 'tax_compliance', 'DGII-2026-08812', current_date - 70, current_date + 20,
       'Certificación de cumplimiento tributario al día'),
      (v_med, v_aceros, 'insurance', 'POL-RC-55120', current_date - 200, current_date + 165,
       'Responsabilidad civil por la mercancía en tránsito');
  end if;
  if v_pint is not null and not exists (select 1 from public.supplier_documents where supplier_id = v_pint) then
    insert into public.supplier_documents (tenant_id, supplier_id, doc_type, doc_number, issued_at, expires_at, notes)
    values
      (v_med, v_pint, 'rnc_certificate', 'RNC-1317890', current_date - 600, current_date + 130, null),
      (v_med, v_pint, 'tax_compliance', 'DGII-2026-04417', current_date - 100, current_date - 10,
       'Vencida: pedirles la renovación antes de la próxima compra'),
      (v_med, v_pint, 'contract', 'CONT-2026-003', current_date - 240, current_date + 125,
       'Precios fijos por 12 meses en pintura acrílica');
  end if;

  if v_aceros is not null and not exists (select 1 from public.supplier_bank_accounts where supplier_id = v_aceros) then
    insert into public.supplier_bank_accounts (tenant_id, supplier_id, bank_name, account_number, account_type, currency)
    values (v_med, v_aceros, 'Banco Popular Dominicano', '800-44521-7', 'checking', 'DOP');
  end if;
  if v_pint is not null and not exists (select 1 from public.supplier_bank_accounts where supplier_id = v_pint) then
    insert into public.supplier_bank_accounts (tenant_id, supplier_id, bank_name, account_number, account_type, currency)
    values (v_med, v_pint, 'Banreservas', '240-011872-3', 'checking', 'DOP');
  end if;
  if v_este is not null and not exists (select 1 from public.supplier_bank_accounts where supplier_id = v_este) then
    insert into public.supplier_bank_accounts (tenant_id, supplier_id, bank_name, account_number, account_type, currency)
    values (v_med, v_este, 'Banco BHD', '1022-334455-1', 'checking', 'DOP');
  end if;

  if v_aceros is not null and not exists (select 1 from public.supplier_evaluations where supplier_id = v_aceros) then
    insert into public.supplier_evaluations (tenant_id, supplier_id, score, comments, evaluated_by, evaluated_at)
    values
      (v_med, v_aceros, 5, 'Entregó completo y a tiempo; varilla con su certificado de calidad.', 'Ramón Antonio Reyes', now() - interval '12 days'),
      (v_med, v_aceros, 4, 'Llegó un día tarde por el flete, pero avisaron.', 'Rafael Encarnación', now() - interval '50 days');
  end if;
  if v_pint is not null and not exists (select 1 from public.supplier_evaluations where supplier_id = v_pint) then
    insert into public.supplier_evaluations (tenant_id, supplier_id, score, comments, evaluated_by, evaluated_at)
    values (v_med, v_pint, 3, 'Dos galones con grumos en el último pedido; lo repusieron.', 'Ramón Antonio Reyes', now() - interval '25 days');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  4. Órdenes de compra con número de verdad (OC-2026-000NN): una ya
--     recibida con su recepción, una confirmada por recibir, la que salió
--     de la requisición "Reposición de cemento y varillas" y un borrador.
--     El contador se deja por encima para que la próxima de la pantalla
--     no choque.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med    uuid;
  v_sd     uuid;
  v_ramon  constant uuid := '00000000-0000-0000-0000-000000000104';
  v_este   uuid;
  v_aceros uuid;
  v_pint   uuid;
  v_plast  uuid;
  v_cem    uuid;
  v_var    uuid;
  v_pin    uuid;
  v_mas    uuid;
  v_pvc    uuid;
  v_orden  uuid;
  v_linea  uuid;
  v_linea2 uuid;
  v_rec    uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_sd from public.warehouses where tenant_id = v_med and code = 'ALM-SD';
  select id into v_este   from public.suppliers where tenant_id = v_med and code = 'PROV-001';
  select id into v_aceros from public.suppliers where tenant_id = v_med and code = 'PROV-003';
  select id into v_pint   from public.suppliers where tenant_id = v_med and code = 'PROV-004';
  select id into v_plast  from public.suppliers where tenant_id = v_med and code = 'PROV-005';
  select id into v_cem from public.products where tenant_id = v_med and sku = 'CEM-100';
  select id into v_var from public.products where tenant_id = v_med and sku = 'VAR-200';
  select id into v_pin from public.products where tenant_id = v_med and sku = 'PIN-300';
  select id into v_mas from public.products where tenant_id = v_med and sku = 'MAS-500';
  select id into v_pvc from public.products where tenant_id = v_med and sku = 'PVC-050';
  if v_sd is null or v_aceros is null or v_var is null then return; end if;

  -- OC-2026-00010: 120 varillas recibidas completas hace 12 días.
  -- 120 × 238 = 28,560.00; ITBIS 5,140.80; total 33,700.80.
  insert into public.purchase_orders
    (tenant_id, number, supplier_id, warehouse_id, status, order_date, supplier_ncf,
     supplier_ncf_date, notes, subtotal, tax, total, created_by, confirmed_at)
  values (v_med, 'OC-2026-00010', v_aceros, v_sd, 'received', current_date - 15, 'B0100004512',
          current_date - 12, 'Entrega en el almacén de Santo Domingo', 28560.00, 5140.80, 33700.80,
          '00000000-0000-0000-0000-000000000001', now() - interval '15 days')
  on conflict (tenant_id, number) do nothing
  returning id into v_orden;
  if v_orden is not null then
    insert into public.purchase_order_lines
      (order_id, tenant_id, product_id, qty_ordered, qty_received, unit_cost, tax_rate, line_total)
    values (v_orden, v_med, v_var, 120, 120, 238.00, 0.18, 33700.80)
    returning id into v_linea;

    insert into public.goods_receipts
      (tenant_id, purchase_order_id, warehouse_id, supplier_id, received_by, received_at, notes, status)
    values (v_med, v_orden, v_sd, v_aceros, v_ramon, now() - interval '12 days',
            'Factura B0100004512, camión placa L318764', 'completed')
    returning id into v_rec;

    insert into public.goods_receipt_lines
      (receipt_id, tenant_id, purchase_order_line_id, product_id,
       qty_expected, qty_received, qty_accepted, qty_rejected, unit_cost)
    values (v_rec, v_med, v_linea, v_var, 120, 120, 120, 0, 238.00);

    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost,
       reference_type, reference_id, notes, created_by, created_at)
    values (v_med, v_sd, v_var, 'receipt', 120, 238.00, 'goods_receipt', v_rec,
            'OC-2026-00010: recibido completo', v_ramon, now() - interval '12 days');
  end if;

  -- OC-2026-00011: pintura y masilla, confirmada hace 2 días, por recibir.
  -- 40 × 880 = 35,200 − 5 % = 33,440; 10 × 1,890 = 18,900 → 52,340.00;
  -- ITBIS 9,421.20; total 61,761.20.
  if v_pint is not null and v_pin is not null and v_mas is not null then
    insert into public.purchase_orders
      (tenant_id, number, supplier_id, warehouse_id, status, order_date, notes,
       subtotal, discount, tax, total, created_by, confirmed_at)
    values (v_med, 'OC-2026-00011', v_pint, v_sd, 'confirmed', current_date - 2,
            'Pintura para el pedido de Constructora Báez Guzmán', 52340.00, 1760.00, 9421.20, 61761.20,
            '00000000-0000-0000-0000-000000000001', now() - interval '2 days')
    on conflict (tenant_id, number) do nothing
    returning id into v_orden;
    if v_orden is not null then
      insert into public.purchase_order_lines
        (order_id, tenant_id, product_id, qty_ordered, qty_received, unit_cost, discount_pct, tax_rate, line_total)
      values
        (v_orden, v_med, v_pin, 40, 0, 880.00, 5, 0.18, 39459.20),
        (v_orden, v_med, v_mas, 10, 0, 1890.00, 0, 0.18, 22302.00);
    end if;
  end if;

  -- OC-2026-00012: la que salió de la requisición de Rafael. Confirmada.
  -- 60 × 401 = 24,060 + 70 × 240 = 16,800 → 40,860.00; ITBIS 7,354.80;
  -- total 48,214.80 (la requisición estimaba RD$ 45,000).
  if v_este is not null then
    insert into public.purchase_orders
      (tenant_id, number, supplier_id, warehouse_id, status, order_date, notes,
       subtotal, tax, total, created_by, confirmed_at)
    values (v_med, 'OC-2026-00012', v_este, v_sd, 'confirmed', current_date - 4,
            'Reposición de cemento y varillas (requisición aprobada)', 40860.00, 7354.80, 48214.80,
            '00000000-0000-0000-0000-000000000001', now() - interval '4 days')
    on conflict (tenant_id, number) do nothing
    returning id into v_orden;
    if v_orden is not null then
      insert into public.purchase_order_lines
        (order_id, tenant_id, product_id, qty_ordered, qty_received, unit_cost, tax_rate, line_total)
      values
        (v_orden, v_med, v_cem, 60, 0, 401.00, 0.18, 28390.80),
        (v_orden, v_med, v_var, 70, 0, 240.00, 0.18, 19824.00);
    end if;
  end if;

  -- OC-2026-00013: borrador de tubería para Santiago, sin confirmar.
  -- 100 × 118 = 11,800; ITBIS 2,124; total 13,924.
  if v_plast is not null and v_pvc is not null then
    insert into public.purchase_orders
      (tenant_id, number, supplier_id, warehouse_id, status, order_date, notes,
       subtotal, tax, total, created_by)
    values (v_med, 'OC-2026-00013', v_plast, v_sd, 'draft', current_date,
            'Cotizar flete a Santiago antes de confirmar', 11800.00, 2124.00, 13924.00,
            '00000000-0000-0000-0000-000000000001')
    on conflict (tenant_id, number) do nothing
    returning id into v_orden;
    if v_orden is not null then
      insert into public.purchase_order_lines
        (order_id, tenant_id, product_id, qty_ordered, qty_received, unit_cost, tax_rate, line_total)
      values (v_orden, v_med, v_pvc, 100, 0, 118.00, 0.18, 13924.00);
    end if;
  end if;

  insert into public.purchase_order_counters as c (tenant_id, year, last_n)
  values (v_med, extract(year from now())::smallint, 13)
  on conflict (tenant_id, year) do update set last_n = greatest(c.last_n, 13);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  5. Requisiciones: una aprobada esperando su orden y una por aprobar.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med     uuid;
  v_anthony uuid;
  v_rafael  uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_anthony from public.employees where tenant_id = v_med and code = 'E-003';
  select id into v_rafael  from public.employees where tenant_id = v_med and code = 'E-001';
  if v_anthony is null or v_rafael is null then return; end if;

  if not exists (select 1 from public.purchase_requisitions
                 where tenant_id = v_med and description like 'Estantería metálica%') then
    insert into public.purchase_requisitions
      (tenant_id, employee_id, department, description, estimated_amount, status,
       approved_by, approved_at, decision_note, created_at)
    values (v_med, v_rafael, 'Almacén', 'Estantería metálica de 5 niveles para el almacén de Santiago',
            18500.00, 'approved', '00000000-0000-0000-0000-000000000001', now() - interval '1 day',
            'Aprobada: pedir dos cotizaciones antes de comprar', now() - interval '3 days');
  end if;

  if not exists (select 1 from public.purchase_requisitions
                 where tenant_id = v_med and description like 'Uniformes%') then
    insert into public.purchase_requisitions
      (tenant_id, employee_id, department, description, estimated_amount, status, created_at)
    values (v_med, v_anthony, 'Ventas', 'Uniformes y botas de seguridad para los choferes de reparto',
            12800.00, 'pending', now() - interval '6 hours');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  6. Transferencias: un pedido de Santiago por despachar (borrador).
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med   uuid;
  v_sd    uuid;
  v_stgo  uuid;
  v_orden uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_sd   from public.warehouses where tenant_id = v_med and code = 'ALM-SD';
  select id into v_stgo from public.warehouses where tenant_id = v_med and name in ('Almacén Santiago', 'Almacén Santiago');
  if v_sd is null or v_stgo is null then return; end if;

  if not exists (select 1 from public.transfer_orders
                 where tenant_id = v_med and notes = 'Pedido semanal de la sucursal de Santiago') then
    insert into public.transfer_orders (tenant_id, from_warehouse_id, to_warehouse_id, status, notes, created_by, created_at)
    values (v_med, v_sd, v_stgo, 'draft', 'Pedido semanal de la sucursal de Santiago',
            '00000000-0000-0000-0000-000000000104', now() - interval '2 hours')
    returning id into v_orden;

    insert into public.transfer_order_lines (order_id, tenant_id, product_id, qty_requested)
    select v_orden, v_med, p.id, x.qty
    from (values ('BLK-600', 300), ('CLV-300', 40), ('ALM-DUL', 25)) as x(sku, qty)
    join public.products p on p.tenant_id = v_med and p.sku = x.sku;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  7. Conteos: un conteo cíclico ya aprobado en Santiago (sin
--     diferencias) y, en el colmado, un conteo físico cerrado.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med   uuid;
  v_stgo  uuid;
  v_conteo uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_stgo from public.warehouses where tenant_id = v_med and name in ('Almacén Santiago', 'Almacén Santiago');
  if v_stgo is null then return; end if;

  if not exists (select 1 from public.cycle_counts
                 where tenant_id = v_med and warehouse_id = v_stgo and status = 'approved') then
    insert into public.cycle_counts
      (tenant_id, warehouse_id, status, notes, started_by, started_at, submitted_at, approved_by, approved_at)
    values (v_med, v_stgo, 'approved', 'Conteo de rutina de la clase A y C',
            '00000000-0000-0000-0000-000000000104', now() - interval '16 days',
            now() - interval '16 days' + interval '2 hours',
            '00000000-0000-0000-0000-000000000001', now() - interval '15 days')
    returning id into v_conteo;

    insert into public.cycle_count_lines (count_id, tenant_id, product_id, system_qty, counted_qty, unit_cost)
    select v_conteo, v_med, sl.product_id, sl.qty_on_hand, sl.qty_on_hand, sl.avg_cost
    from public.stock_levels sl
    join public.products p on p.id = sl.product_id
    where sl.tenant_id = v_med and sl.warehouse_id = v_stgo and p.sku in ('CEM-100', 'VAR-200');
  end if;
end $$;

do $$
declare
  v_pyme   uuid;
  v_alm    uuid;
  v_conteo uuid;
begin
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  if v_pyme is null then return; end if;
  select id into v_alm from public.warehouses where tenant_id = v_pyme order by is_default desc limit 1;
  if v_alm is null then return; end if;

  if not exists (select 1 from public.stock_counts where tenant_id = v_pyme and status = 'closed') then
    insert into public.stock_counts (tenant_id, warehouse_id, status, started_by, started_at, closed_at)
    values (v_pyme, v_alm, 'closed', '00000000-0000-0000-0000-000000000202',
            now() - interval '8 days', now() - interval '8 days' + interval '40 minutes')
    returning id into v_conteo;

    insert into public.stock_count_lines (count_id, tenant_id, product_id, system_qty, counted_qty)
    select v_conteo, v_pyme, sl.product_id, sl.qty_on_hand, sl.qty_on_hand
    from public.stock_levels sl
    where sl.tenant_id = v_pyme and sl.warehouse_id = v_alm;
  end if;
end $$;

-- La distribuidora también tiene historia en las pantallas "de un paso" de
-- Inventario (antes de usar Transferencias y Conteos cíclicos): un conteo
-- físico cerrado de Santiago, que cuadró, y un traslado rápido de masilla.
do $$
declare
  v_med    uuid;
  v_sd     uuid;
  v_stgo   uuid;
  v_mas    uuid;
  v_conteo uuid;
  v_tr     uuid;
  v_ramon  constant uuid := '00000000-0000-0000-0000-000000000104';
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_sd from public.warehouses where tenant_id = v_med and is_default limit 1;
  select id into v_stgo from public.warehouses
    where tenant_id = v_med and name in ('Almacén Santiago', 'Almacén Santiago') limit 1;
  select id into v_mas from public.products where tenant_id = v_med and sku = 'MAS-500';
  if v_sd is null or v_stgo is null then return; end if;

  if not exists (select 1 from public.stock_counts where tenant_id = v_med) then
    insert into public.stock_counts (tenant_id, warehouse_id, status, started_by, started_at, closed_at)
    values (v_med, v_stgo, 'closed', v_ramon,
            pg_temp.rd(current_date - 30, '07:30'), pg_temp.rd(current_date - 30, '09:10'))
    returning id into v_conteo;

    insert into public.stock_count_lines (count_id, tenant_id, product_id, system_qty, counted_qty)
    select v_conteo, v_med, sl.product_id, sl.qty_on_hand, sl.qty_on_hand
    from public.stock_levels sl
    join public.products p on p.id = sl.product_id
    where sl.tenant_id = v_med and sl.warehouse_id = v_stgo and p.sku in ('BLK-600', 'CLV-300');
  end if;

  if v_mas is not null and not exists (select 1 from public.stock_transfers where tenant_id = v_med)
     and coalesce((select qty_on_hand from public.stock_levels
                   where tenant_id = v_med and warehouse_id = v_sd and product_id = v_mas), 0) >= 4 then
    insert into public.stock_transfers
      (tenant_id, from_warehouse_id, to_warehouse_id, status, created_by, completed_at, created_at)
    values (v_med, v_sd, v_stgo, 'completed', v_ramon,
            pg_temp.rd(current_date - 8, '14:20'), pg_temp.rd(current_date - 8, '14:20'))
    returning id into v_tr;

    insert into public.stock_transfer_lines (transfer_id, tenant_id, product_id, qty)
    values (v_tr, v_med, v_mas, 4);

    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, created_by, created_at)
    values
      (v_med, v_sd,   v_mas, 'transfer_out', -4, 'stock_transfer', v_tr, v_ramon, pg_temp.rd(current_date - 8, '14:20')),
      (v_med, v_stgo, v_mas, 'transfer_in',   4, 'stock_transfer', v_tr, v_ramon, pg_temp.rd(current_date - 8, '14:20'));
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  8. Producción: la orden de varilla reforzada en progreso ya tenía 30
--     hechas y 2 de merma, pero ningún reporte ni consumo. Se le pone su
--     consumo al liberar (la receta: 1 varilla y 0.1 galón de pintura por
--     unidad) y los tres reportes que suman lo que ya dice la orden.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med   uuid;
  v_orden uuid;
  v_alm   uuid;
  v_rel   timestamptz;
  v_prod  uuid;
  r       record;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select po.id, po.warehouse_id, po.released_at, bm.product_id
    into v_orden, v_alm, v_rel, v_prod
  from public.production_orders po
  join public.bill_of_materials bm on bm.id = po.bom_id
  join public.products p on p.id = bm.product_id
  where po.tenant_id = v_med and p.sku = 'VAR-REF' and po.status = 'in_progress'
    and po.qty_completed = 30 and po.qty_scrapped = 2
  limit 1;
  if v_orden is null then return; end if;

  if not exists (select 1 from public.production_order_lines where order_id = v_orden) then
    for r in
      select bl.component_product_id, bl.quantity_per_unit * po.qty_planned / bm.output_qty as qty
      from public.production_orders po
      join public.bill_of_materials bm on bm.id = po.bom_id
      join public.bom_lines bl on bl.bom_id = bm.id and bl.is_substitute_for is null
      where po.id = v_orden
    loop
      insert into public.production_order_lines (order_id, tenant_id, component_product_id, qty_required, qty_consumed)
      values (v_orden, v_med, r.component_product_id, r.qty, r.qty);
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, created_by, created_at)
      values (v_med, v_alm, r.component_product_id, 'adjustment_out', -r.qty, 'production_order', v_orden,
              '00000000-0000-0000-0000-000000000001', coalesce(v_rel, now() - interval '6 days'));
    end loop;
  end if;

  if not exists (select 1 from public.production_reports where order_id = v_orden) then
    insert into public.production_reports
      (order_id, tenant_id, qty_completed_delta, qty_scrapped_delta, reported_by, reported_at, notes)
    values
      (v_orden, v_med, 12, 1, '00000000-0000-0000-0000-000000000104', coalesce(v_rel, now()) + interval '1 hour 20 minutes',
       'Primera tanda; una varilla doblada al cortar'),
      (v_orden, v_med, 10, 0, '00000000-0000-0000-0000-000000000104', coalesce(v_rel, now()) + interval '2 hours 40 minutes', null),
      (v_orden, v_med, 8, 1, '00000000-0000-0000-0000-000000000104', coalesce(v_rel, now()) + interval '3 hours 50 minutes',
       'Una con el recubrimiento corrido; se separó como merma');
    -- Lo completado entra al almacén en cada reporte, como en la pantalla,
    -- al costo de la ficha (sin costo, la varilla entraba valiendo cero).
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by, created_at)
    select v_med, v_alm, v_prod, 'adjustment_in', x.qty, p.cost, 'production_order', v_orden,
           '00000000-0000-0000-0000-000000000104', coalesce(v_rel, now()) + x.despues
    from (values (12, interval '1 hour 20 minutes'), (10, interval '2 hours 40 minutes'),
                 (8, interval '3 hours 50 minutes')) as x(qty, despues)
    cross join public.products p where p.id = v_prod;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  8b. Planificación de materiales: la corrida de demo.sql es del kit con
--      la receta todavía en borrador y sus sugerencias escritas a mano.
--      Esta se calcula como lo hace la pantalla: receta activa de la
--      varilla reforzada para una obra grande (600), restando la
--      existencia de hoy. Lo que no alcanza queda para comprar.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med  uuid;
  v_prod uuid;
  v_bom  uuid;
  v_out  numeric;
  v_run  uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_prod from public.products where tenant_id = v_med and sku = 'VAR-REF';
  select id, output_qty into v_bom, v_out from public.bill_of_materials
    where tenant_id = v_med and product_id = v_prod and status = 'active';
  if v_prod is null or v_bom is null then return; end if;
  if exists (select 1 from public.mrp_runs where tenant_id = v_med and target_product_id = v_prod) then
    return;
  end if;

  insert into public.mrp_runs (tenant_id, target_product_id, target_qty, created_by, notes, run_at)
  values (v_med, v_prod, 600, '00000000-0000-0000-0000-000000000001',
          'Obra del residencial en Villa Mella: 600 varillas reforzadas para noviembre',
          pg_temp.rd(current_date - 1, '10:30'))
  returning id into v_run;

  insert into public.mrp_suggestions (run_id, tenant_id, product_id, action, qty_suggested)
  select v_run, v_med, l.component_product_id,
         case when exists (select 1 from public.bill_of_materials b2
                           where b2.tenant_id = v_med and b2.product_id = l.component_product_id
                             and b2.status = 'active') then 'produce' else 'purchase' end,
         round(600 * l.quantity_per_unit / v_out
               - coalesce((select sum(sl.qty_on_hand) from public.stock_levels sl
                           where sl.tenant_id = v_med and sl.product_id = l.component_product_id), 0), 3)
  from public.bom_lines l
  where l.bom_id = v_bom and l.tenant_id = v_med and l.is_substitute_for is null
    and 600 * l.quantity_per_unit / v_out
        > coalesce((select sum(sl.qty_on_hand) from public.stock_levels sl
                    where sl.tenant_id = v_med and sl.product_id = l.component_product_id), 0);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  9. Calidad: un plan para la varilla, dos inspecciones aprobadas y una
--     no conformidad vieja ya cerrada con su acción correctiva verificada.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med     uuid;
  v_var     uuid;
  v_pin     uuid;
  v_cem     uuid;
  v_plan    uuid;
  v_plan_cem uuid;
  v_insp    uuid;
  v_nc      uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_var from public.products where tenant_id = v_med and sku = 'VAR-200';
  select id into v_pin from public.products where tenant_id = v_med and sku = 'PIN-300';
  select id into v_cem from public.products where tenant_id = v_med and sku = 'CEM-100';
  if v_var is null then return; end if;

  select id into v_plan from public.inspection_plans where tenant_id = v_med and name = 'Recepción de varilla';
  if v_plan is null then
    insert into public.inspection_plans (tenant_id, name, scope, product_id)
    values (v_med, 'Recepción de varilla', 'receiving', v_var)
    returning id into v_plan;
    insert into public.inspection_plan_criteria (plan_id, tenant_id, criterion, is_critical, sort_order)
    values
      (v_plan, v_med, 'Diámetro de 3/8 pulgada medido con calibrador', true, 1),
      (v_plan, v_med, 'Largo de 20 pies en una muestra de 10 varillas', true, 2),
      (v_plan, v_med, 'Sin óxido suelto ni escamas', false, 3);
  end if;

  if not exists (select 1 from public.inspections where tenant_id = v_med and plan_id = v_plan) then
    insert into public.inspections (tenant_id, plan_id, product_id, performed_by, performed_at, result, notes)
    values (v_med, v_plan, v_var, '00000000-0000-0000-0000-000000000104', now() - interval '12 days', 'passed',
            'Lote de la OC-2026-00010, 120 varillas')
    returning id into v_insp;
    insert into public.inspection_results (inspection_id, tenant_id, criterion, is_critical, passed)
    values
      (v_insp, v_med, 'Diámetro de 3/8 pulgada medido con calibrador', true, true),
      (v_insp, v_med, 'Largo de 20 pies en una muestra de 10 varillas', true, true),
      (v_insp, v_med, 'Sin óxido suelto ni escamas', false, true);
  end if;

  -- Una recepción de cemento que sí pasó (la de la demo reprobó).
  select id into v_plan_cem from public.inspection_plans where tenant_id = v_med and name in ('Recepción de cemento', 'Recepción de cemento');
  if v_plan_cem is not null and not exists (
    select 1 from public.inspections where tenant_id = v_med and plan_id = v_plan_cem and result = 'passed'
  ) then
    insert into public.inspections (tenant_id, plan_id, product_id, performed_by, performed_at, result, notes)
    values (v_med, v_plan_cem, v_cem, '00000000-0000-0000-0000-000000000104', now() - interval '6 days', 'passed',
            'OC-DEMO-0001, 60 sacos')
    returning id into v_insp;
    insert into public.inspection_results (inspection_id, tenant_id, criterion, is_critical, passed)
    select v_insp, v_med, c.criterion, c.is_critical, true
    from public.inspection_plan_criteria c where c.plan_id = v_plan_cem;
  end if;

  -- La no conformidad de la pintura con grumos, ya cerrada.
  if v_pin is not null and not exists (
    select 1 from public.non_conformances where tenant_id = v_med and description like 'Dos galones de pintura con grumos%'
  ) then
    insert into public.non_conformances (tenant_id, description, severity, status, detected_by, detected_at, created_at)
    values (v_med, 'Dos galones de pintura con grumos en el lote PIN-2025-C', 'minor', 'closed',
            '00000000-0000-0000-0000-000000000104', now() - interval '28 days', now() - interval '28 days')
    returning id into v_nc;
    insert into public.capas
      (tenant_id, non_conformance_id, root_cause, corrective_action, preventive_action, status,
       due_date, verified_by, verified_at, created_at)
    values (v_med, v_nc, 'Los galones se guardaron al sol en el patio y la pintura se cortó.',
            'Pinturas Tropical repuso los dos galones; el lote se movió adentro.',
            'La pintura se guarda en el área techada, lejos de la puerta del patio.',
            'closed', current_date - 20, '00000000-0000-0000-0000-000000000001', now() - interval '21 days',
            now() - interval '27 days');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  10. Mantenimiento: el montacargas, la planta eléctrica y la balanza,
--      con sus órdenes de trabajo. A la planta le toca servicio por horas
--      y a la balanza por fecha.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med  uuid;
  v_mon  uuid;
  v_pel  uuid;
  v_bal  uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  update public.equipment set location = 'Almacén Santo Domingo'
  where tenant_id = v_med and code = 'CMP-01' and location = 'Almacén Santo Domingo';

  insert into public.equipment
    (tenant_id, code, name, location, usage_hours, last_service_at, last_service_usage,
     maintenance_interval_usage, maintenance_interval_days)
  values
    (v_med, 'MON-01', 'Montacargas Toyota 8FG25', 'Almacén Santo Domingo', 3420,
     current_date - 40, 3300, 250, 90),
    (v_med, 'PEL-01', 'Planta eléctrica de 60 kW', 'Patio trasero, Santo Domingo', 860,
     current_date - 75, 640, 200, 180),
    (v_med, 'BAL-01', 'Balanza de plataforma de 1,000 kg', 'Almacén Santiago', 0,
     current_date - 200, 0, null, 180)
  on conflict (tenant_id, code) do nothing;

  select id into v_mon from public.equipment where tenant_id = v_med and code = 'MON-01';
  select id into v_pel from public.equipment where tenant_id = v_med and code = 'PEL-01';
  select id into v_bal from public.equipment where tenant_id = v_med and code = 'BAL-01';

  if v_mon is not null and not exists (select 1 from public.work_orders where equipment_id = v_mon) then
    insert into public.work_orders
      (tenant_id, equipment_id, type, status, priority, description, requested_by, opened_at, completed_at, notes)
    values
      (v_med, v_mon, 'preventive', 'completed', 'normal',
       'Servicio de 250 horas: aceite, filtros y revisión de frenos',
       '00000000-0000-0000-0000-000000000104', now() - interval '41 days', now() - interval '40 days',
       'Hecho por el taller Montacargas del Caribe; factura 00318'),
      (v_med, v_mon, 'corrective', 'completed', 'high',
       'Fuga en la manguera hidráulica del mástil',
       '00000000-0000-0000-0000-000000000104', now() - interval '95 days', now() - interval '94 days', null);
  end if;

  if v_pel is not null and not exists (select 1 from public.work_orders where equipment_id = v_pel) then
    insert into public.work_orders
      (tenant_id, equipment_id, type, status, priority, description, requested_by, opened_at, notes)
    values (v_med, v_pel, 'corrective', 'in_progress', 'urgent',
            'No arranca sola cuando se va la luz: revisar batería y la transferencia automática',
            '00000000-0000-0000-0000-000000000104', now() - interval '1 day',
            'Mientras tanto se arranca a mano; avisar al vigilante');
  end if;

  if v_bal is not null and not exists (select 1 from public.work_orders where equipment_id = v_bal) then
    insert into public.work_orders
      (tenant_id, equipment_id, type, status, priority, description, requested_by, opened_at)
    values (v_med, v_bal, 'preventive', 'open', 'normal',
            'Calibración anual con pesas certificadas',
            '00000000-0000-0000-0000-000000000001', now() - interval '3 days');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  11. Flota: la Hilux de la demo (si faltaba), el camión de reparto y el
--      motor de mensajería, con sus papeles, combustible, taller y multas.
--      El chofer del camión es un empleado nuevo (Wilson), con cédula
--      válida; se busca por cédula para no duplicarlo.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med     uuid;
  v_anthony uuid;
  v_wilson  uuid;
  v_hilux   uuid;
  v_camion  uuid;
  v_motor   uuid;
  v_cedula  text := pg_temp.cedula('0011834567');
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_anthony from public.employees where tenant_id = v_med and code = 'E-003';

  select id into v_wilson from public.employees where tenant_id = v_med and national_id = v_cedula;
  if v_wilson is null then
    insert into public.employees
      (tenant_id, code, first_name, last_name, national_id, hire_date, position, department,
       salary, status, phone)
    values (v_med, 'E-020', 'Wilson', 'Mercedes Castillo', v_cedula, date_trunc('month', current_date)::date,
            'Chofer de reparto', 'Logística', 28000.00, 'active', '829-418-2765')
    on conflict (tenant_id, code) do nothing
    returning id into v_wilson;
  end if;
  -- Entra este mes, como María y Luis en RRHH: la nómina de agosto ya está
  -- procesada y no lo incluye. La primera versión de esta semilla lo había
  -- metido con año y medio de antigüedad.
  update public.employees set hire_date = date '2026-09-01'
  where tenant_id = v_med and national_id = v_cedula and hire_date < date '2026-09-01';

  -- La Hilux, igual que en demo.sql.
  if v_anthony is not null then
    insert into public.vehicles (tenant_id, plate, brand, model, year, assigned_driver_id, odometer_km)
    values (v_med, 'A123456', 'Toyota', 'Hilux', 2022, v_anthony, 45000)
    on conflict (tenant_id, plate) do nothing;
  end if;
  select id into v_hilux from public.vehicles where tenant_id = v_med and plate = 'A123456';

  insert into public.vehicles (tenant_id, plate, brand, model, year, vin, assigned_driver_id, odometer_km, status)
  values
    (v_med, 'L452187', 'Isuzu', 'NPR 4.5 t', 2019, 'JALC4B16XK7004512', v_wilson, 128450, 'active'),
    (v_med, 'K173045', 'Honda', 'CGL 125', 2023, null, null, 18320, 'maintenance')
  on conflict (tenant_id, plate) do nothing;
  select id into v_camion from public.vehicles where tenant_id = v_med and plate = 'L452187';
  select id into v_motor  from public.vehicles where tenant_id = v_med and plate = 'K173045';

  -- La Hilux: lo mismo que sembraba demo.sql, si no está.
  if v_hilux is not null and not exists (select 1 from public.vehicle_documents where vehicle_id = v_hilux) then
    insert into public.vehicle_documents (tenant_id, vehicle_id, doc_type, expiry_date, notes)
    values
      (v_med, v_hilux, 'license', current_date + 10, 'Licencia de Anthony, categoría 2'),
      (v_med, v_hilux, 'insurance', current_date - 5, 'Póliza de ley; renovar en la aseguradora'),
      (v_med, v_hilux, 'inspection', current_date + 200, null);
  end if;
  if v_hilux is not null and not exists (select 1 from public.fuel_logs where vehicle_id = v_hilux) then
    insert into public.fuel_logs (tenant_id, vehicle_id, driver_id, filled_at, liters, cost, odometer_km)
    values
      (v_med, v_hilux, v_anthony, now() - interval '20 days', 30, 5000.00, 44500),
      (v_med, v_hilux, v_anthony, now() - interval '2 days', 15, 2600.00, 45000);
  end if;
  if v_hilux is not null and not exists (select 1 from public.maintenance_records where vehicle_id = v_hilux) then
    insert into public.maintenance_records (tenant_id, vehicle_id, service_date, type, description, cost, odometer_km, next_due_km)
    values (v_med, v_hilux, current_date - 30, 'preventive', 'Cambio de aceite y filtros', 3500.00, 40000, 45000);
  end if;
  if v_hilux is not null and not exists (select 1 from public.traffic_fines where vehicle_id = v_hilux) then
    insert into public.traffic_fines (tenant_id, vehicle_id, driver_id, fine_date, amount, reason)
    values (v_med, v_hilux, v_anthony, current_date - 3, 2500.00, 'Exceso de velocidad en la autopista Duarte');
  end if;

  -- El camión: inspección técnica vencida (no debería salir), el resto en regla.
  if v_camion is not null and not exists (select 1 from public.vehicle_documents where vehicle_id = v_camion) then
    insert into public.vehicle_documents (tenant_id, vehicle_id, doc_type, expiry_date, notes)
    values
      (v_med, v_camion, 'insurance', current_date + 120, 'Seguro de carga, póliza 44-0981'),
      (v_med, v_camion, 'license', current_date + 410, 'Licencia de Wilson, categoría 3 (pesados)'),
      (v_med, v_camion, 'inspection', current_date - 12, 'Inspección técnica vehicular vencida');
  end if;
  if v_camion is not null and not exists (select 1 from public.fuel_logs where vehicle_id = v_camion) then
    -- Gasoil a unos RD$ 63 el litro; rinde entre 5 y 6 km por litro.
    insert into public.fuel_logs (tenant_id, vehicle_id, driver_id, filled_at, liters, cost, odometer_km)
    values
      (v_med, v_camion, v_wilson, now() - interval '26 days', 72, 4536.00, 126380),
      (v_med, v_camion, v_wilson, now() - interval '19 days', 68, 4284.00, 126770),
      (v_med, v_camion, v_wilson, now() - interval '12 days', 75, 4725.00, 127190),
      (v_med, v_camion, v_wilson, now() - interval '5 days',  70, 4410.00, 127600),
      (v_med, v_camion, v_wilson, now() - interval '1 day',   74, 4662.00, 128010);
  end if;
  if v_camion is not null and not exists (select 1 from public.maintenance_records where vehicle_id = v_camion) then
    insert into public.maintenance_records (tenant_id, vehicle_id, service_date, type, description, cost, odometer_km, next_due_km)
    values
      (v_med, v_camion, current_date - 60, 'preventive', 'Cambio de aceite, filtros de aceite y gasoil', 9800.00, 122500, 127500),
      (v_med, v_camion, current_date - 22, 'corrective', 'Cambio de bandas de freno traseras', 14250.00, 126100, null);
  end if;
  if v_camion is not null and not exists (select 1 from public.traffic_fines where vehicle_id = v_camion) then
    insert into public.traffic_fines (tenant_id, vehicle_id, driver_id, fine_date, amount, reason, status, resolved_at)
    values (v_med, v_camion, v_wilson, current_date - 20, 1000.00,
            'Estacionar en zona prohibida en la avenida Duarte (DIGESETT)', 'paid', now() - interval '16 days');
  end if;

  -- El motor: en el taller.
  if v_motor is not null and not exists (select 1 from public.vehicle_documents where vehicle_id = v_motor) then
    insert into public.vehicle_documents (tenant_id, vehicle_id, doc_type, expiry_date, notes)
    values
      (v_med, v_motor, 'insurance', current_date + 45, null),
      (v_med, v_motor, 'inspection', current_date + 280, null);
  end if;
  if v_motor is not null and not exists (select 1 from public.maintenance_records where vehicle_id = v_motor) then
    insert into public.maintenance_records (tenant_id, vehicle_id, service_date, type, description, cost, odometer_km, next_due_km)
    values (v_med, v_motor, current_date - 1, 'corrective', 'Cadena y piñón gastados; en el taller hasta el viernes', 3200.00, 18320, null);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  12. Rutas: la de antier ya completada (con una parada fallida), la de
--      hoy en la calle y la de mañana planificada. Si ya hay una ruta en
--      progreso o una planificada (las de demo.sql), no se repiten.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med     uuid;
  v_wilson  uuid;
  v_anthony uuid;
  v_ruta    uuid;
  c_hidalgos uuid; c_tavarez uuid; c_ana uuid; c_baez uuid; c_martillo uuid;
  c_duarte uuid; c_almonte uuid; c_hotel uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_anthony from public.employees where tenant_id = v_med and code = 'E-003';
  select id into v_wilson  from public.employees where tenant_id = v_med and position = 'Chofer de reparto' limit 1;
  select id into c_hidalgos from public.customers where tenant_id = v_med and name like 'Ferretería Los Hidalgos%';
  select id into c_tavarez  from public.customers where tenant_id = v_med and name like 'Inversiones Tavárez%';
  select id into c_ana      from public.customers where tenant_id = v_med and name = 'Colmado Doña Ana';
  select id into c_baez     from public.customers where tenant_id = v_med and name like 'Constructora Báez Guzmán%';
  select id into c_martillo from public.customers where tenant_id = v_med and name in ('Ferretería El Martillo SRL', 'Ferretería El Martillo SRL');
  select id into c_duarte   from public.customers where tenant_id = v_med and name = 'Constructora Duarte SRL';
  select id into c_almonte  from public.customers where tenant_id = v_med and name = 'José Miguel Almonte';
  select id into c_hotel    from public.customers where tenant_id = v_med and name like 'Hotel Playa Dorada%';
  -- Sin chofer de reparto (si el empleado no se pudo crear), sale Anthony.
  v_wilson := coalesce(v_wilson, v_anthony);
  if v_wilson is null then return; end if;

  if not exists (select 1 from public.delivery_routes where tenant_id = v_med and status = 'completed') then
    insert into public.delivery_routes (tenant_id, driver_id, vehicle_plate, route_date, status, notes, started_at, completed_at)
    values (v_med, v_wilson, 'L452187', current_date - 2, 'completed', 'Ruta del Cibao',
            pg_temp.rd(current_date - 2, '07:40'), pg_temp.rd(current_date - 2, '16:15'))
    returning id into v_ruta;
    insert into public.route_stops (route_id, tenant_id, sequence, customer_id, address, status, recipient_name, delivery_notes, delivered_at)
    values
      (v_ruta, v_med, 1, c_ana, 'C/ Colón esq. Sánchez, Bonao', 'failed', null,
       'Cerrado a la hora de la entrega; se reprograma', pg_temp.rd(current_date - 2, '09:05')),
      (v_ruta, v_med, 2, c_tavarez, 'C/ Duarte 45, La Vega', 'delivered', 'Carmen Tavárez',
       'Recibió 40 sacos de cemento', pg_temp.rd(current_date - 2, '10:30')),
      (v_ruta, v_med, 3, c_hidalgos, 'Av. 27 de Febrero 58, Santiago de los Caballeros', 'delivered', 'Luis Hidalgo',
       null, pg_temp.rd(current_date - 2, '12:10'));
  end if;

  if not exists (select 1 from public.delivery_routes where tenant_id = v_med and status = 'in_progress') then
    insert into public.delivery_routes (tenant_id, driver_id, vehicle_plate, route_date, status, notes, started_at)
    values (v_med, v_wilson, 'L452187', current_date, 'in_progress', 'Ruta de Santo Domingo',
            pg_temp.rd(current_date, '08:10'))
    returning id into v_ruta;
    insert into public.route_stops (route_id, tenant_id, sequence, customer_id, address, status, recipient_name, delivered_at)
    values
      (v_ruta, v_med, 1, c_baez, 'Autopista San Isidro km 9, Santo Domingo Este', 'delivered', 'Ing. Ramón Báez',
       pg_temp.rd(current_date, '09:20')),
      (v_ruta, v_med, 2, c_martillo, 'Av. Duarte 214, Villa Francisca, Santo Domingo', 'delivered', 'Pedro Martínez',
       pg_temp.rd(current_date, '10:05'));
    insert into public.route_stops (route_id, tenant_id, sequence, customer_id, address)
    values
      (v_ruta, v_med, 3, c_duarte, 'C/ Rafael Augusto Sánchez 86, Piantini, Santo Domingo'),
      (v_ruta, v_med, 4, c_almonte, 'C/ Primera 12, Los Alcarrizos');
  end if;

  if v_anthony is not null
     and not exists (select 1 from public.delivery_routes where tenant_id = v_med and status = 'planned') then
    insert into public.delivery_routes (tenant_id, driver_id, vehicle_plate, route_date, notes)
    values (v_med, v_anthony, 'A123456', current_date + 1, 'Ruta de Puerto Plata')
    returning id into v_ruta;
    insert into public.route_stops (route_id, tenant_id, sequence, customer_id, address)
    values
      (v_ruta, v_med, 1, c_hotel, 'Complejo Playa Dorada, Puerto Plata'),
      (v_ruta, v_med, 2, c_ana, 'C/ Colón esq. Sánchez, Bonao');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  13. Servicio en campo: un técnico de verdad (Franklin, con su acceso
--      de Técnico de Campo), una visita agendada para mañana y una orden
--      sin técnico para que el despachador la asigne.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med      uuid;
  v_franklin constant uuid := '00000000-0000-0000-0000-000000000111';
  v_rol      uuid;
  v_hotel    uuid;
  v_baez     uuid;
  v_orden    uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  insert into public.user_profiles (tenant_id, user_id, display_name, email, phone, job_title)
  values (v_med, v_franklin, 'Franklin Batista Reyes', 'franklin.batista@distribuidoracaribe.do',
          '829-705-3314', 'Técnico de refrigeración')
  on conflict (tenant_id, user_id) do nothing;

  select id into v_rol from public.roles
    where tenant_id = v_med and name in ('Técnico de Campo', 'Tecnico de Campo') limit 1;
  if v_rol is not null then
    insert into public.memberships (tenant_id, user_id, role_id, is_active, invited_at, accepted_at)
    values (v_med, v_franklin, v_rol, true, now() - interval '2 months', now() - interval '2 months' + interval '1 day')
    on conflict (tenant_id, user_id) do nothing;
  end if;

  select id into v_hotel from public.customers where tenant_id = v_med and name like 'Hotel Playa Dorada%';
  select id into v_baez  from public.customers where tenant_id = v_med and name like 'Constructora Báez Guzmán%';

  if v_hotel is not null and not exists (select 1 from public.service_orders where tenant_id = v_med and code = 'OS-3') then
    insert into public.service_orders
      (tenant_id, code, customer_id, technician_id, status, priority, scheduled_at, address, description, created_by)
    values (v_med, 'OS-3', v_hotel, v_franklin, 'scheduled', 'high', pg_temp.rd(current_date + 1, '09:00'),
            'Complejo Playa Dorada, Puerto Plata',
            'Mantenimiento preventivo de seis unidades de aire acondicionado del lobby',
            '00000000-0000-0000-0000-000000000001')
    returning id into v_orden;
    insert into public.service_checklist_items (tenant_id, order_id, position, label, required)
    values
      (v_med, v_orden, 0, 'Cortar la corriente de cada unidad', true),
      (v_med, v_orden, 1, 'Lavar filtros y serpentines', true),
      (v_med, v_orden, 2, 'Medir la presión del gas refrigerante', true),
      (v_med, v_orden, 3, 'Foto de cada unidad terminada', false);
  end if;

  if v_baez is not null and not exists (select 1 from public.service_orders where tenant_id = v_med and code = 'OS-4') then
    insert into public.service_orders
      (tenant_id, code, customer_id, status, priority, address, description, created_by)
    values (v_med, 'OS-4', v_baez, 'draft', 'normal', 'Autopista San Isidro km 9, Santo Domingo Este',
            'Instalación de bomba de agua de 1 HP en la obra', '00000000-0000-0000-0000-000000000001');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  14. Colmado Esperanza: lo que de verdad se vende en un colmado, con
--      sus categorías, códigos de barra, puntos de reorden y existencias.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_pyme uuid;
  v_alm  uuid;
  v_cat  uuid;
  r      record;
  n      int;
  v_altagracia constant uuid := '00000000-0000-0000-0000-000000000202';
begin
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  if v_pyme is null then return; end if;
  select id into v_alm from public.warehouses where tenant_id = v_pyme order by is_default desc limit 1;

  update public.products set category = 'Víveres' where tenant_id = v_pyme and category = 'Viveres';
  update public.products set unit = 'galón' where tenant_id = v_pyme and unit = 'galon';
  -- Sin inglés en la pantalla: "delivery" es "envío a domicilio".
  update public.products set name = 'Envío a domicilio'
  where tenant_id = v_pyme and sku = 'DELIV' and name = 'Delivery del colmado';

  insert into public.products (tenant_id, sku, name, category, unit, price, cost, tax_rate, tracks_stock)
  values
    (v_pyme, 'HUE-030', 'Huevos (cartón de 30)',        'Víveres',              'cartón',  260.00, 215.00, 0,    true),
    (v_pyme, 'SAL-001', 'Salami de primera (libra)',    'Embutidos y lácteos',  'libra',   185.00, 142.00, 0.18, true),
    (v_pyme, 'QSO-001', 'Queso de freír (libra)',       'Embutidos y lácteos',  'libra',   240.00, 188.00, 0.18, true),
    (v_pyme, 'REF-2LT', 'Refresco de cola 2 litros',    'Bebidas',              'unidad',  125.00,  92.00, 0.18, true),
    (v_pyme, 'AGU-5GL', 'Botellón de agua 5 galones',   'Bebidas',              'unidad',   80.00,  55.00, 0,    true),
    (v_pyme, 'JAB-CUA', 'Jabón de cuaba',               'Limpieza',             'unidad',   45.00,  31.00, 0.18, true)
  on conflict (tenant_id, sku) do nothing;

  for r in
    select distinct category as nombre from public.products
    where tenant_id = v_pyme and category is not null
  loop
    select id into v_cat from public.product_categories
      where tenant_id = v_pyme and parent_id is null and name = r.nombre;
    if v_cat is null then
      insert into public.product_categories (tenant_id, name) values (v_pyme, r.nombre)
      returning id into v_cat;
    end if;
    update public.products set category_id = v_cat
      where tenant_id = v_pyme and category = r.nombre and category_id is null;
  end loop;

  update public.products p set reorder_point = x.punto
  from (values ('ARZ-001', 20), ('HAB-003', 25), ('ACE-002', 6), ('HUE-030', 5), ('SAL-001', 8),
               ('QSO-001', 6), ('REF-2LT', 12), ('AGU-5GL', 6), ('JAB-CUA', 10)) as x(sku, punto)
  where p.tenant_id = v_pyme and p.sku = x.sku and p.reorder_point is null;

  select count(*) into n from public.products where tenant_id = v_pyme and barcode like '20%';
  for r in
    select id from public.products
    where tenant_id = v_pyme and active and tracks_stock and barcode is null order by sku
  loop
    n := n + 1;
    update public.products set barcode = pg_temp.ean13('20' || lpad(n::text, 10, '0')) where id = r.id;
  end loop;

  if v_alm is not null then
    perform pg_temp.existencia_inicial(v_pyme, v_alm, 'HUE-030', 14,  215.00, interval '10 days', v_altagracia);
    perform pg_temp.existencia_inicial(v_pyme, v_alm, 'SAL-001', 22,  142.00, interval '10 days', v_altagracia);
    perform pg_temp.existencia_inicial(v_pyme, v_alm, 'QSO-001', 4,   188.00, interval '10 days', v_altagracia);
    perform pg_temp.existencia_inicial(v_pyme, v_alm, 'REF-2LT', 36,   92.00, interval '10 days', v_altagracia);
    perform pg_temp.existencia_inicial(v_pyme, v_alm, 'AGU-5GL', 9,    55.00, interval '10 days', v_altagracia);
    perform pg_temp.existencia_inicial(v_pyme, v_alm, 'JAB-CUA', 48,   31.00, interval '10 days', v_altagracia);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  15. Fechas que no cuadraban en la demo: transferencias y órdenes de
--      producción "creadas" después de despacharse o liberarse (demo.sql
--      les deja la hora de la siembra). Se crean dos horas antes.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare v_med uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  update public.transfer_orders set created_at = dispatched_at - interval '2 hours'
  where tenant_id = v_med and dispatched_at is not null and created_at > dispatched_at;

  update public.production_orders set created_at = released_at - interval '2 hours'
  where tenant_id = v_med and status in ('released', 'in_progress')
    and released_at is not null and created_at > released_at;

  -- Las dos visitas de demo.sql quedan a la hora de la siembra (de
  -- madrugada si se sembró de noche) y OS-1 "agendada" antes de crearse.
  -- Se ponen en horario de trabajo: OS-1 en sitio desde esta mañana y
  -- OS-2 terminada hace nueve días en una hora de visita.
  update public.service_orders
  set created_at   = pg_temp.rd(current_date - 1, '15:20'),
      scheduled_at = pg_temp.rd(current_date, '08:00'),
      started_at   = pg_temp.rd(current_date, '08:15')
  where tenant_id = v_med and code = 'OS-1' and status = 'in_progress';

  update public.service_checklist_items ci
  set done_at = pg_temp.rd(current_date, case ci.position when 0 then '08:25'::time else '08:50'::time end)
  from public.service_orders so
  where so.id = ci.order_id and so.tenant_id = v_med and so.code = 'OS-1'
    and so.status = 'in_progress' and ci.done;

  update public.service_orders
  set created_at   = pg_temp.rd(current_date - 10, '11:00'),
      scheduled_at = pg_temp.rd(current_date - 9, '09:00'),
      started_at   = pg_temp.rd(current_date - 9, '09:10'),
      completed_at = pg_temp.rd(current_date - 9, '10:05'),
      signed_at    = case when signed_at is null then null else pg_temp.rd(current_date - 9, '10:05') end
  where tenant_id = v_med and code = 'OS-2' and status = 'done';

  update public.service_checklist_items ci
  set done_at = pg_temp.rd(current_date - 9, case ci.position when 0 then '09:25'::time else '09:50'::time end)
  from public.service_orders so
  where so.id = ci.order_id and so.tenant_id = v_med and so.code = 'OS-2' and ci.done;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  16. Textos de la demo con sus tildes. Solo se cambian si siguen siendo
--      el texto exacto de demo.sql y no son ancla de nada (sus bloques se
--      anclan por estado, código o existencia, no por el texto). Un
--      registro ya cerrado que la base no deja editar se salta sin error.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med uuid;
  r     record;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  for r in select * from (values
    ('purchase_requisitions', 'description', 'Reposición de cemento y varillas', 'Reposición de cemento y varillas'),
    ('purchase_requisitions', 'description', 'Papelería y útiles de oficina para el mes', 'Papelería y útiles de oficina para el mes'),
    ('purchase_requisitions', 'decision_note', 'Se pospone para el próximo trimestre; no es urgente.', 'Se pospone para el próximo trimestre; no es urgente.'),
    ('rfqs', 'title', 'Cotización de cemento y varillas', 'Cotización de cemento y varillas'),
    ('rfqs', 'title', 'Cotización de pintura para el segundo trimestre', 'Cotización de pintura para el segundo trimestre'),
    ('rfqs', 'description', 'Reposición de inventario para el próximo trimestre', 'Reposición de inventario para el próximo trimestre'),
    ('rfq_quotes', 'notes', 'Precio de siempre, entrega en camion propio', 'Precio de siempre, entrega en camión propio'),
    ('rfq_quotes', 'notes', 'Precio mas bajo pero entrega mas lenta', 'Precio más bajo, pero entrega más lenta'),
    ('product_recalls', 'reason', 'Lote vencido todavia en el almacen: retirar y no vender.', 'Lote vencido todavía en el almacén: retirar y no vender.'),
    ('transfer_orders', 'notes', 'Reposicion para la sucursal de Santiago', 'Reposición para la sucursal de Santiago'),
    ('transfer_orders', 'notes', 'Reposicion de la semana pasada', 'Reposición de la semana pasada'),
    ('mrp_runs', 'notes', 'Reponer el kit básico de reparación para el trimestre', 'Reponer el kit básico de reparación para el trimestre'),
    ('non_conformances', 'description', 'Cemento recibido con el empaque mojado -riesgo de fragua prematura-', 'Cemento recibido con el empaque mojado (riesgo de fragua prematura)'),
    ('inventory_movements', 'notes', 'Recepcion parcial OC-DEMO-0001', 'Recepción parcial OC-DEMO-0001'),
    ('inspection_plan_criteria', 'criterion', 'Fecha de fabricacion legible', 'Fecha de fabricación legible'),
    ('service_orders', 'description', 'Mantenimiento del aire acondicionado del almacen', 'Mantenimiento del aire acondicionado del almacén'),
    ('service_checklist_items', 'label', 'Cortar corriente del equipo', 'Cortar la corriente del equipo'),
    ('service_checklist_items', 'label', 'Lavar filtros y serpentin', 'Lavar filtros y serpentín'),
    ('service_checklist_items', 'label', 'Medir presion del gas refrigerante', 'Medir la presión del gas refrigerante'),
    ('supplier_evaluations', 'comments', 'Resolvio un reclamo de calidad muy rapido.', 'Resolvió un reclamo de calidad muy rápido.'),
    ('supplier_evaluations', 'evaluated_by', 'Rafael Encarnacion', 'Rafael Encarnación'),
    ('work_orders', 'description', 'Correa floja (tensada)', 'Correa floja (se tensó)'),
    ('work_orders', 'description', 'Filtro de aire obstruido (reemplazado)', 'Filtro de aire obstruido (se reemplazó)')
  ) as x(tabla, columna, viejo, nuevo)
  loop
    begin
      execute format('update public.%I set %I = $1 where tenant_id = $2 and %I = $3',
                     r.tabla, r.columna, r.columna)
        using r.nuevo, v_med, r.viejo;
    exception when others then
      -- Registro cerrado (trigger de inmutabilidad): se queda como está.
      null;
    end;
  end loop;
end $$;
