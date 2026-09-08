-- ═══════════════════════════════════════════════════════════════════════
--  Datos de demostracion
--
--  Dos clientes reales de República Dominicana con perfiles distintos, para
--  ver el registry resolver cosas diferentes segun quien mira.
--
--  El CATALOGO no vive aqui: es dato de producto y va en migraciones
--  (0009 y 0012). Este archivo solo crea clientes y les activa modulos.
--  Mezclarlos fue un error: el seed corre despues de las migraciones, asi
--  que un modulo definido aqui nunca recibia los permisos que 0010 asigna.
--
--  Idempotente: se puede correr las veces que haga falta.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Cliente 1: PYME ────────────────────────────────────────────────────
insert into regb.tenants (slug, legal_name, trade_name, tax_id, tier, status, installed_at, go_live_at, health_score)
values ('colmado-esperanza', 'Colmado La Esperanza SRL', 'La Esperanza',
        '130-11111-1', 'pyme', 'active', now() - interval '4 months', now() - interval '3 months', 88)
on conflict (slug) do nothing;

-- ── Cliente 2: MEDIANO ─────────────────────────────────────────────────
insert into regb.tenants (slug, legal_name, trade_name, tax_id, tier, status, installed_at, go_live_at, health_score)
values ('distribuidora-caribe', 'Distribuidora Caribe SRL', 'Caribe',
        '131-45678-2', 'mediano', 'active', now() - interval '6 months', now() - interval '5 months', 94)
on conflict (slug) do nothing;

-- ── Empresas, sucursales y modulos ─────────────────────────────────────
do $$
declare
  v_pyme uuid;
  v_med  uuid;
  v_c1   uuid;
  v_c2   uuid;
begin
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  select id into v_med  from regb.tenants where slug = 'distribuidora-caribe';

  -- Los modulos core los activa el trigger al crear el cliente. Aqui solo
  -- se agregan los de pago, que es lo que diferencia a un cliente de otro.

  -- `companies` solo tiene PK(id) -un uuid nuevo cada vez-, asi que un
  -- "on conflict do nothing" aqui nunca dispara: cada corrida duplicaria
  -- la empresa. Se comprueba a mano, igual que el resto de este archivo.
  select id into v_c1 from public.companies where tenant_id = v_pyme limit 1;
  if v_c1 is null then
    insert into public.companies (tenant_id, legal_name, tax_id, currency, is_default)
    values (v_pyme, 'Colmado La Esperanza SRL', '130-11111-1', 'DOP', true)
    returning id into v_c1;
  end if;

  select id into v_c2 from public.companies where tenant_id = v_med limit 1;
  if v_c2 is null then
    insert into public.companies (tenant_id, legal_name, tax_id, currency, is_default)
    values (v_med, 'Distribuidora Caribe SRL', '131-45678-2', 'DOP', true)
    returning id into v_c2;
  end if;

  -- Mismo caso: `branches` solo tiene PK(id).
  if not exists (select 1 from public.branches where company_id = v_c1 and code = 'VC') then
    insert into public.branches (tenant_id, company_id, name, code)
    values (v_pyme, v_c1, 'Villa Consuelo', 'VC');
  end if;

  if not exists (select 1 from public.branches where company_id = v_c2 and code = 'SD') then
    insert into public.branches (tenant_id, company_id, name, code)
    values (v_med, v_c2, 'Santo Domingo', 'SD');
  end if;
  if not exists (select 1 from public.branches where company_id = v_c2 and code = 'STI') then
    insert into public.branches (tenant_id, company_id, name, code)
    values (v_med, v_c2, 'Santiago', 'STI');
  end if;

  -- ── Almacenes: sin esto, inventario/POS/compras/pedidos no tienen
  --    donde mover nada. `warehouses` SI tiene restriccion unica real
  --    (tenant_id, code), asi que `on conflict` aqui es seguro -al reves
  --    de companies/branches, que no la tenian-.
  insert into public.warehouses (tenant_id, branch_id, name, code, is_default)
  select v_pyme, b.id, 'Almacen Villa Consuelo', 'ALM-VC', true
  from public.branches b where b.tenant_id = v_pyme and b.code = 'VC'
  on conflict (tenant_id, code) do nothing;

  insert into public.warehouses (tenant_id, branch_id, name, code, is_default)
  select v_med, b.id, 'Almacen Santo Domingo', 'ALM-SD', true
  from public.branches b where b.tenant_id = v_med and b.code = 'SD'
  on conflict (tenant_id, code) do nothing;

  -- ── Clientes: sin esto, ar/sales-orders/pos/payments no tienen a quien
  --    facturarle. `customers.code` es nullable, asi que un `unique
  --    (tenant_id, code)` no sirve de "on conflict" aqui -dos NULL nunca
  --    chocan en Postgres-: se comprueba por nombre, igual que companies
  --    y branches un poco mas arriba en este mismo archivo. Este es el
  --    mismo tipo de bug que ya aparecio con warehouses: el archivo
  --    siempre SELECCIONO estos dos clientes rio abajo (ar, payments) sin
  --    que nada los hubiera creado nunca -enmascarado por inserts
  --    manuales de sesiones pasadas hasta el primer reset completo de la
  --    base en esta sesion-.
  if not exists (select 1 from public.customers where tenant_id = v_med and name = 'Ferreteria El Martillo SRL') then
    insert into public.customers (tenant_id, name, tax_id, payment_terms)
    values (v_med, 'Ferreteria El Martillo SRL', '131-22334-5', 30);
  end if;

  if not exists (select 1 from public.customers where tenant_id = v_med and name = 'Constructora Duarte SRL') then
    insert into public.customers (tenant_id, name, tax_id, payment_terms)
    values (v_med, 'Constructora Duarte SRL', '131-99887-6', 45);
  end if;

  -- ── El colmado: lo minimo para dejar Excel ───────────────────────────
  insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
  values (v_pyme, 'pos', 'active', true)
  on conflict do nothing;

  -- Inventario en prueba: vence en 9 dias.
  insert into regb.tenant_modules (tenant_id, module_id, status, enabled, trial_ends_at)
  values (v_pyme, 'inventory', 'trial', true, (current_date + 9))
  on conflict do nothing;

  -- ── La distribuidora: recibe de 40 proveedores y arma el 606 ─────────
  insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
  values (v_med, 'inventory', 'active', true),
         (v_med, 'pos', 'active', true),
         (v_med, 'payroll', 'active', true),
         (v_med, 'invoice-capture', 'active', true),
         (v_med, 'purchase-orders', 'active', true),
         (v_med, 'accounting', 'active', true),
         (v_med, 'ap', 'active', true),
         (v_med, 'treasury', 'active', true),
         (v_med, 'bank-rec', 'active', true),
         (v_med, 'fixed-assets', 'active', true),
         (v_med, 'budgets', 'active', true),
         (v_med, 'cost-centers', 'active', true),
         (v_med, 'multicurrency', 'active', true),
         (v_med, 'payments', 'active', true),
         (v_med, 'employees', 'active', true),
         (v_med, 'payroll', 'active', true),
         (v_med, 'attendance', 'active', true),
         (v_med, 'time-off', 'active', true),
         (v_med, 'expenses', 'active', true),
         (v_med, 'hr-portal', 'active', true),
         (v_med, 'benefits', 'active', true),
         (v_med, 'recruiting', 'active', true),
         (v_med, 'performance', 'active', true),
         (v_med, 'training', 'active', true),
         (v_med, 'suppliers', 'active', true),
         (v_med, 'price-lists', 'active', true),
         (v_med, 'requisitions', 'active', true),
         (v_med, 'rfq', 'active', true),
         (v_med, 'receipts', 'active', true),
         (v_med, 'lots-serials', 'active', true),
         (v_med, 'transfers', 'active', true),
         (v_med, 'stock-counts', 'active', true),
         (v_med, 'barcode', 'active', true),
         (v_med, 'fleet', 'active', true),
         (v_med, 'logistics', 'active', true),
         (v_med, 'bom', 'active', true),
         (v_med, 'manufacturing', 'active', true),
         (v_med, 'mrp', 'active', true),
         (v_med, 'quality', 'active', true),
         (v_med, 'maintenance', 'active', true),
         (v_med, 'shopfloor', 'active', true),
         (v_med, 'crm', 'active', true),
         (v_med, 'pipeline', 'active', true)
  on conflict do nothing;

  -- ── Suscripciones ────────────────────────────────────────────────────
  insert into regb.subscriptions
    (tenant_id, tier, billing_cycle, base_price, install_price, install_paid,
     included_users, included_branches, included_companies, included_storage_gb,
     included_modules, started_at, renews_at)
  values
    (v_pyme, 'pyme', 'monthly', 79, 500, true, 5, 1, 1, 10, 0,
     current_date - 90, current_date + 30),
    (v_med, 'mediano', 'annual', 399, 3500, true, 25, 5, 3, 100, 5,
     current_date - 150, current_date + 215)
  on conflict do nothing;
end $$;

-- ── Datos de plataforma (F2): perfiles, settings, avisos, catalogo ──────
do $$
declare
  v_pyme uuid;
  v_med  uuid;
  v_maria constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  select id into v_med  from regb.tenants where slug = 'distribuidora-caribe';

  insert into public.user_profiles (tenant_id, user_id, display_name, email, phone, job_title)
  values
    (v_pyme, v_maria, 'Maria Rosario', 'maria.rosario@demo.do', '809-555-0101', 'Propietaria'),
    (v_med,  v_maria, 'Maria Rosario', 'maria.rosario@demo.do', '809-555-0101', 'Gerente General')
  on conflict do nothing;

  insert into public.tenant_settings (tenant_id, trade_name, currency)
  values (v_pyme, 'La Esperanza', 'DOP'), (v_med, 'Caribe', 'DOP')
  on conflict do nothing;

  insert into public.notifications (tenant_id, user_id, module_id, title, body, link)
  select v_pyme, null, 'marketplace', 'Tu prueba de Inventario vence pronto',
         'Quedan pocos dias de prueba. Activalo para no perder el historial de movimientos.',
         '/marketplace'
  where not exists (select 1 from public.notifications where tenant_id = v_pyme);

  insert into public.products (tenant_id, sku, name, category, unit, price, cost)
  values
    (v_pyme, 'ARZ-001', 'Arroz selecto 5 lb',        'Viveres',  'funda',   215.00, 178.00),
    (v_pyme, 'ACE-002', 'Aceite de soya 1 gal',      'Viveres',  'galon',   525.00, 462.00),
    (v_pyme, 'HAB-003', 'Habichuelas rojas 1 lb',    'Viveres',  'libra',    85.00,  64.00),
    (v_med,  'CEM-100', 'Cemento gris 42.5 kg',      'Ferreteria','saco',    465.00, 401.00),
    (v_med,  'VAR-200', 'Varilla 3/8 x 20 pies',     'Ferreteria','unidad',  285.00, 240.00),
    (v_med,  'PIN-300', 'Pintura blanca acrilica gl','Pinturas', 'galon',  1150.00, 890.00)
  on conflict do nothing;
end $$;

-- Maria es Owner en ambos clientes: su membership hace real el modulo users.
do $$
declare
  v_pyme uuid;
  v_med  uuid;
  v_maria constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  select id into v_med  from regb.tenants where slug = 'distribuidora-caribe';

  insert into public.memberships (tenant_id, user_id, role_id, invited_at, accepted_at, is_active)
  select t.tid, v_maria, r.id, now() - interval '4 months', now() - interval '4 months', true
  from (values (v_pyme), (v_med)) as t(tid)
  join public.roles r on r.tenant_id = t.tid and r.name = 'Owner'
  on conflict do nothing;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Cartera y arqueo: para que la demo tenga que ensenar el primer minuto
-- ═══════════════════════════════════════════════════════════════════════
--  Una cartera vacia no demuestra nada. Estas tres facturas caen en tres
--  tramos distintos de antiguedad a proposito —una al dia, una que empieza
--  a doler y una casi perdida— porque es la lectura que un dueno hace en
--  cinco segundos y la que decide si compra.
--
--  Las fechas son relativas a `current_date`: la demo envejece sola y
--  nunca se ve congelada en el pasado.
do $$
declare
  v_med      uuid;
  v_pyme     uuid;
  v_martillo uuid;
  v_duarte   uuid;
  v_alm      uuid;
  v_maria    uuid;
  v_inv      uuid;
  v_turno    uuid;
begin
  select id into v_med  from regb.tenants where slug = 'distribuidora-caribe';
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  if v_med is null or v_pyme is null then return; end if;

  select id into v_martillo from public.customers
    where tenant_id = v_med and name = 'Ferreteria El Martillo SRL';
  select id into v_duarte from public.customers
    where tenant_id = v_med and name = 'Constructora Duarte SRL';
  if v_martillo is null or v_duarte is null then return; end if;

  -- Duarte es cliente de volumen: se le exime del cargo por mora aunque
  -- pague tarde. Es la decision fija de negocio que el modulo respeta.
  update public.customers set late_fee_exempt = true where id = v_duarte;

  -- ── Tres facturas en tres tramos ─────────────────────────────────────
  -- 10 dias: al dia. 45: hay que llamar. 95: ya es una negociacion.
  insert into public.customer_invoices
    (tenant_id, number, customer_id, source_type, issue_date, due_date,
     subtotal, discount, tax, total, status)
  values
    (v_med, 'FAC-DEMO-0001', v_martillo, 'manual',
     current_date - 10, current_date + 20,
     18500.00, 0, 3330.00, 21830.00, 'open'),
    (v_med, 'FAC-DEMO-0002', v_duarte, 'manual',
     current_date - 75, current_date - 45,
     42000.00, 2000.00, 7200.00, 47200.00, 'partially_paid'),
    (v_med, 'FAC-DEMO-0003', v_martillo, 'manual',
     current_date - 125, current_date - 95,
     9800.00, 0, 1764.00, 11564.00, 'overdue')
  on conflict (tenant_id, number) do nothing;

  -- Un abono parcial: la de 45 dias envejece solo su REMANENTE, que es
  -- justo lo que distingue un aging bien hecho de uno que suma totales.
  select id into v_inv from public.customer_invoices
    where tenant_id = v_med and number = 'FAC-DEMO-0002';
  -- `customer_payments` no tiene una restriccion unica: `on conflict do
  -- nothing` aqui era un no-op y cada corrida del seed sumaba otro abono
  -- de RD$20,000, hasta cobrar de mas por 6 corridas seguidas. Se comprueba
  -- a mano, como ya se hace en el resto de este archivo.
  if v_inv is not null and not exists (
    select 1 from public.customer_payments where invoice_id = v_inv
  ) then
    insert into public.customer_payments
      (tenant_id, invoice_id, amount, method, reference, received_at)
    values (v_med, v_inv, 20000.00, 'transfer', 'TRF-889021',
            now() - interval '30 days');
  end if;

  -- La de 95 dias de atraso (Martillo, no exento): se le aplico un cargo
  -- por mora a mano, RD$500, decidido por el negocio -no una formula-.
  select id into v_inv from public.customer_invoices
    where tenant_id = v_med and number = 'FAC-DEMO-0003';
  if v_inv is not null and not exists (
    select 1 from public.invoice_late_fees where invoice_id = v_inv
  ) then
    insert into public.invoice_late_fees
      (tenant_id, invoice_id, amount, days_late_at_charge, notes, applied_at)
    values (v_med, v_inv, 500.00, 80, 'Cargo por atraso, acordado por telefono',
            now() - interval '15 days');
  end if;

  -- ── Un turno cerrado con faltante ────────────────────────────────────
  -- Con diferencia a proposito: un arqueo que siempre cuadra no ensena a
  -- leer un arqueo. RD$40 de faltante es lo tipico —vuelto mal dado—, no
  -- un robo, y el tour lo explica asi.
  select id into v_alm from public.warehouses
    where tenant_id = v_pyme order by is_default desc limit 1;
  select user_id into v_maria from public.user_profiles
    where tenant_id = v_pyme limit 1;

  -- `pos_shifts` no tiene una restriccion unica que un "on conflict"
  -- pudiera usar: se comprueba por sus notas fijas, que son el ancla de
  -- este turno de demostracion en concreto.
  if v_alm is not null and not exists (
    select 1 from public.pos_shifts
    where warehouse_id = v_alm and notes = 'Faltante, se revisara manana'
  ) then
    insert into public.pos_shifts
      (tenant_id, warehouse_id, cashier_id, opening_float, counted_cash,
       expected_cash, variance, status, opened_at, closed_at, notes)
    values (v_pyme, v_alm, v_maria, 2000.00, 20380.00, 20420.00, -40.00,
            'closed', now() - interval '2 days' - interval '8 hours',
            now() - interval '2 days', 'Faltante, se revisara manana')
    returning id into v_turno;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Compras: un proveedor y una orden recibida a medias, con el costo real
--  distinto al cotizado —eso es lo que el widget de variacion de costo
--  tiene que ensenar en el primer minuto, no una orden que cuadra perfecto.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_alm       uuid;
  v_cemento   uuid;
  v_proveedor uuid;
  v_orden     uuid;
  v_linea     uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_alm from public.warehouses
    where tenant_id = v_med order by is_default desc limit 1;
  select id into v_cemento from public.products
    where tenant_id = v_med and sku = 'CEM-100';
  if v_alm is null or v_cemento is null then return; end if;

  insert into public.suppliers (tenant_id, code, name, tax_id, phone, payment_terms)
  values (v_med, 'PROV-001', 'Materiales Del Este SRL', '132-98765-3', '809-555-0202', 30)
  on conflict (tenant_id, code) do nothing
  returning id into v_proveedor;
  if v_proveedor is null then
    select id into v_proveedor from public.suppliers
      where tenant_id = v_med and code = 'PROV-001';
  end if;

  insert into public.purchase_orders
    (tenant_id, number, supplier_id, warehouse_id, status, order_date,
     subtotal, tax, total, confirmed_at)
  values
    (v_med, 'OC-DEMO-0001', v_proveedor, v_alm, 'partially_received',
     current_date - 6, 40100.00, 7218.00, 47318.00, now() - interval '6 days')
  on conflict (tenant_id, number) do nothing
  returning id into v_orden;
  if v_orden is null then
    select id into v_orden from public.purchase_orders
      where tenant_id = v_med and number = 'OC-DEMO-0001';
  end if;

  -- Se pidieron 100 sacos a RD$401 (el mismo costo que ya tenia el
  -- catalogo). Solo llegaron 60 en este primer camion, y a RD$415 —el
  -- proveedor subio el precio—, asi que el costo real difiere del
  -- cotizado a proposito.
  select id into v_linea from public.purchase_order_lines
    where order_id = v_orden and product_id = v_cemento;
  if v_linea is null then
    insert into public.purchase_order_lines
      (order_id, tenant_id, product_id, qty_ordered, qty_received, unit_cost, tax_rate, line_total)
    values
      (v_orden, v_med, v_cemento, 100, 60, 401.00, 0.18, 47318.00)
    returning id into v_linea;
  end if;

  -- El movimiento de inventario es lo que de verdad mueve el promedio
  -- ponderado: mismo trigger que un ajuste (0019), sin logica nueva.
  if not exists (
    select 1 from public.inventory_movements
    where reference_type = 'purchase_order' and reference_id = v_orden
  ) then
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost,
       reference_type, reference_id, notes, created_at)
    values
      (v_med, v_alm, v_cemento, 'receipt', 60, 415.00,
       'purchase_order', v_orden, 'Recepcion parcial OC-DEMO-0001',
       now() - interval '2 days');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Recepciones (modulo 46): una orden pendiente de recibir con el flujo
--  nuevo -para probar el modulo en vivo-, y una orden ya recibida con
--  discrepancia real y una devolucion pendiente -para que las tres
--  secciones de /recepciones tengan algo que mostrar sin interactuar
--  primero-. No toca OC-DEMO-0001 -esa se recibio con el mecanismo viejo
--  de purchase-orders, antes de que este modulo existiera-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med             uuid;
  v_alm             uuid;
  v_cemento         uuid;
  v_proveedor       uuid;
  v_orden_pendiente uuid;
  v_orden_recibida  uuid;
  v_linea_recibida  uuid;
  v_recepcion       uuid;
  v_linea_recepcion uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_alm from public.warehouses where tenant_id = v_med order by is_default desc limit 1;
  select id into v_cemento from public.products where tenant_id = v_med and sku = 'CEM-100';
  select id into v_proveedor from public.suppliers where tenant_id = v_med and code = 'PROV-001';
  if v_alm is null or v_cemento is null or v_proveedor is null then return; end if;

  -- Confirmada, nada recibido todavia: la que se recibe EN VIVO al probar el modulo.
  insert into public.purchase_orders
    (tenant_id, number, supplier_id, warehouse_id, status, order_date,
     subtotal, tax, total, confirmed_at)
  values
    (v_med, 'OC-DEMO-0002', v_proveedor, v_alm, 'confirmed',
     current_date - 1, 20050.00, 3609.00, 23659.00, now() - interval '1 day')
  on conflict (tenant_id, number) do nothing
  returning id into v_orden_pendiente;
  if v_orden_pendiente is not null then
    insert into public.purchase_order_lines
      (order_id, tenant_id, product_id, qty_ordered, qty_received, unit_cost, tax_rate, line_total)
    values (v_orden_pendiente, v_med, v_cemento, 50, 0, 401.00, 0.18, 23659.00);
  end if;

  -- Ya recibida CON el flujo de receipts: llegaron 25 de 30, y 5 de esas
  -- 25 se rechazaron por sacos rotos -discrepancia real y una devolucion
  -- pendiente de verdad, no solo un estado de ejemplo-.
  insert into public.purchase_orders
    (tenant_id, number, supplier_id, warehouse_id, status, order_date,
     subtotal, tax, total, confirmed_at)
  values
    (v_med, 'OC-DEMO-0003', v_proveedor, v_alm, 'partially_received',
     current_date - 3, 12030.00, 2165.40, 14195.40, now() - interval '3 days')
  on conflict (tenant_id, number) do nothing
  returning id into v_orden_recibida;
  if v_orden_recibida is null then
    select id into v_orden_recibida from public.purchase_orders
      where tenant_id = v_med and number = 'OC-DEMO-0003';
  end if;

  select id into v_linea_recibida from public.purchase_order_lines
    where order_id = v_orden_recibida and product_id = v_cemento;
  if v_linea_recibida is null then
    insert into public.purchase_order_lines
      (order_id, tenant_id, product_id, qty_ordered, qty_received, unit_cost, tax_rate, line_total)
    values (v_orden_recibida, v_med, v_cemento, 30, 25, 401.00, 0.18, 14195.40)
    returning id into v_linea_recibida;
  end if;

  if not exists (
    select 1 from public.goods_receipts where tenant_id = v_med and purchase_order_id = v_orden_recibida
  ) then
    insert into public.goods_receipts
      (tenant_id, purchase_order_id, warehouse_id, supplier_id, received_at, notes, status)
    values
      (v_med, v_orden_recibida, v_alm, v_proveedor, now() - interval '3 days',
       'Llegaron 5 sacos rotos, se rechazaron', 'with_discrepancies')
    returning id into v_recepcion;

    insert into public.goods_receipt_lines
      (receipt_id, tenant_id, purchase_order_line_id, product_id,
       qty_expected, qty_received, qty_accepted, qty_rejected, rejection_reason, unit_cost)
    values
      (v_recepcion, v_med, v_linea_recibida, v_cemento, 30, 25, 20, 5,
       'Sacos rotos por humedad', 401.00)
    returning id into v_linea_recepcion;

    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost,
       reference_type, reference_id, notes, created_at)
    values
      (v_med, v_alm, v_cemento, 'receipt', 20, 401.00,
       'goods_receipt', v_recepcion, 'OC-DEMO-0003: aceptado', now() - interval '3 days');

    insert into public.supplier_returns (tenant_id, goods_receipt_line_id, supplier_id, qty, reason)
    values (v_med, v_linea_recepcion, v_proveedor, 5, 'Sacos rotos por humedad, devueltos al proveedor');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Lotes, series y vencimientos (modulo 49): tres lotes de la misma
--  pintura -uno por vencer, uno ya vencido con un recall abierto de
--  verdad, uno lejano sin problema- para que las alertas y el recall
--  tengan algo real que mostrar sin interactuar primero.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med      uuid;
  v_alm      uuid;
  v_pintura  uuid;
  v_lote_por_vencer uuid;
  v_lote_vencido    uuid;
  v_lote_lejano     uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_alm from public.warehouses where tenant_id = v_med order by is_default desc limit 1;
  select id into v_pintura from public.products where tenant_id = v_med and sku = 'PIN-300';
  if v_alm is null or v_pintura is null then return; end if;

  update public.products set tracks_lots = true where id = v_pintura;

  insert into public.product_lots (tenant_id, product_id, lot_number, expiry_date)
  values (v_med, v_pintura, 'PIN-2026-A', current_date + 10)
  on conflict (tenant_id, product_id, lot_number) do nothing
  returning id into v_lote_por_vencer;
  if v_lote_por_vencer is null then
    select id into v_lote_por_vencer from public.product_lots
      where tenant_id = v_med and product_id = v_pintura and lot_number = 'PIN-2026-A';
  end if;

  insert into public.product_lots (tenant_id, product_id, lot_number, expiry_date)
  values (v_med, v_pintura, 'PIN-2025-C', current_date - 15)
  on conflict (tenant_id, product_id, lot_number) do nothing
  returning id into v_lote_vencido;
  if v_lote_vencido is null then
    select id into v_lote_vencido from public.product_lots
      where tenant_id = v_med and product_id = v_pintura and lot_number = 'PIN-2025-C';
  end if;

  insert into public.product_lots (tenant_id, product_id, lot_number, expiry_date)
  values (v_med, v_pintura, 'PIN-2026-Z', current_date + 200)
  on conflict (tenant_id, product_id, lot_number) do nothing
  returning id into v_lote_lejano;
  if v_lote_lejano is null then
    select id into v_lote_lejano from public.product_lots
      where tenant_id = v_med and product_id = v_pintura and lot_number = 'PIN-2026-Z';
  end if;

  insert into public.lot_stock (tenant_id, warehouse_id, lot_id, qty_on_hand)
  values (v_med, v_alm, v_lote_por_vencer, 8),
         (v_med, v_alm, v_lote_vencido, 3),
         (v_med, v_alm, v_lote_lejano, 20)
  on conflict (tenant_id, warehouse_id, lot_id) do nothing;

  if not exists (
    select 1 from public.inventory_movements where reference_type = 'product_lot' and lot_id = v_lote_por_vencer
  ) then
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, lot_id, reference_type, notes, created_at)
    values
      (v_med, v_alm, v_pintura, 'adjustment_in', 8, 620.00, v_lote_por_vencer, 'product_lot', 'Registro inicial de lote', now() - interval '20 days'),
      (v_med, v_alm, v_pintura, 'adjustment_in', 3, 620.00, v_lote_vencido, 'product_lot', 'Registro inicial de lote', now() - interval '90 days'),
      (v_med, v_alm, v_pintura, 'adjustment_in', 20, 620.00, v_lote_lejano, 'product_lot', 'Registro inicial de lote', now() - interval '5 days');
  end if;

  if not exists (select 1 from public.product_recalls where tenant_id = v_med and lot_id = v_lote_vencido) then
    insert into public.product_recalls (tenant_id, product_id, lot_id, reason)
    values (v_med, v_pintura, v_lote_vencido, 'Lote vencido todavia en el almacen: retirar y no vender.');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Transferencias (modulo 50): un segundo almacen -Santiago- para que
--  el traslado tenga sentido, una transferencia en transito -para
--  probar "recibir" en vivo- y una ya recibida con una discrepancia
--  real -salieron 10, llegaron 8-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med         uuid;
  v_alm_sd      uuid;
  v_alm_stgo    uuid;
  v_cemento     uuid;
  v_transito    uuid;
  v_recibida    uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_alm_sd from public.warehouses where tenant_id = v_med order by is_default desc limit 1;
  select id into v_cemento from public.products where tenant_id = v_med and sku = 'CEM-100';
  if v_alm_sd is null or v_cemento is null then return; end if;

  select id into v_alm_stgo from public.warehouses where tenant_id = v_med and name = 'Almacen Santiago';
  if v_alm_stgo is null then
    insert into public.warehouses (tenant_id, name, is_default, is_active)
    values (v_med, 'Almacen Santiago', false, true)
    returning id into v_alm_stgo;
  end if;

  -- En transito: despachada, esperando confirmar recepcion en Santiago.
  insert into public.transfer_orders
    (tenant_id, from_warehouse_id, to_warehouse_id, status, notes, dispatched_at)
  select v_med, v_alm_sd, v_alm_stgo, 'in_transit', 'Reposicion para la sucursal de Santiago', now() - interval '1 day'
  where not exists (
    select 1 from public.transfer_orders
    where tenant_id = v_med and from_warehouse_id = v_alm_sd and to_warehouse_id = v_alm_stgo and status = 'in_transit'
  )
  returning id into v_transito;

  if v_transito is not null then
    insert into public.transfer_order_lines (order_id, tenant_id, product_id, qty_requested, qty_sent)
    values (v_transito, v_med, v_cemento, 15, 15);

    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, notes, created_at)
    values
      (v_med, v_alm_sd, v_cemento, 'transfer_out', -15, 'transfer_order', v_transito,
       'Despacho a Santiago', now() - interval '1 day');
  end if;

  -- Ya recibida, con discrepancia real: salieron 10, llegaron 8.
  insert into public.transfer_orders
    (tenant_id, from_warehouse_id, to_warehouse_id, status, notes, dispatched_at, received_at)
  select v_med, v_alm_sd, v_alm_stgo, 'received', 'Reposicion de la semana pasada',
         now() - interval '6 days', now() - interval '5 days'
  where not exists (
    select 1 from public.transfer_orders
    where tenant_id = v_med and from_warehouse_id = v_alm_sd and to_warehouse_id = v_alm_stgo and status = 'received'
  )
  returning id into v_recibida;

  if v_recibida is not null then
    insert into public.transfer_order_lines
      (order_id, tenant_id, product_id, qty_requested, qty_sent, qty_received)
    values (v_recibida, v_med, v_cemento, 10, 10, 8);

    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, notes, created_at)
    values
      (v_med, v_alm_sd, v_cemento, 'transfer_out', -10, 'transfer_order', v_recibida,
       'Despacho a Santiago', now() - interval '6 days'),
      (v_med, v_alm_stgo, v_cemento, 'transfer_in', 8, 'transfer_order', v_recibida,
       'Llegaron 2 sacos menos de los despachados', now() - interval '5 days');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Conteos ciclicos (modulo 51): clasificacion ABC ya calculada sobre
--  los tres productos -para no obligar a correr "recalcular" antes de
--  ver algo-, y un conteo real esperando aprobacion con una
--  discrepancia -para probar "aprobar y ajustar" en vivo-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_alm_sd    uuid;
  v_cemento   uuid;
  v_pintura   uuid;
  v_varilla   uuid;
  v_conteo    uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_alm_sd from public.warehouses where tenant_id = v_med order by is_default desc limit 1;
  select id into v_cemento from public.products where tenant_id = v_med and sku = 'CEM-100';
  select id into v_pintura from public.products where tenant_id = v_med and sku = 'PIN-300';
  select id into v_varilla from public.products where tenant_id = v_med and sku = 'VAR-200';
  if v_alm_sd is null or v_cemento is null then return; end if;

  insert into public.count_schedules (tenant_id, product_id, abc_class, frequency_days, last_counted_at)
  values (v_med, v_cemento, 'A', 30, now() - interval '45 days')
  on conflict (tenant_id, product_id) do nothing;

  if v_pintura is not null then
    insert into public.count_schedules (tenant_id, product_id, abc_class, frequency_days, last_counted_at)
    values (v_med, v_pintura, 'B', 90, null)
    on conflict (tenant_id, product_id) do nothing;
  end if;

  if v_varilla is not null then
    insert into public.count_schedules (tenant_id, product_id, abc_class, frequency_days, last_counted_at)
    values (v_med, v_varilla, 'C', 180, now() - interval '10 days')
    on conflict (tenant_id, product_id) do nothing;
  end if;

  if not exists (
    select 1 from public.cycle_counts where tenant_id = v_med and warehouse_id = v_alm_sd and status = 'pending_approval'
  ) then
    insert into public.cycle_counts (tenant_id, warehouse_id, status, started_at, submitted_at)
    values (v_med, v_alm_sd, 'pending_approval', now() - interval '2 hours', now() - interval '1 hour')
    returning id into v_conteo;

    insert into public.cycle_count_lines (count_id, tenant_id, product_id, system_qty, counted_qty, unit_cost)
    values (v_conteo, v_med, v_cemento, 55, 53, 411.50);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Codigos de barra (modulo 52): el cemento ya tiene un EAN-13 real
--  asignado y un escaneo registrado -para probar etiquetas y escaneo
--  sin interactuar primero-; la pintura y la varilla se dejan SIN
--  codigo a proposito, para que "generar codigos faltantes" tenga
--  trabajo real que hacer en la demo en vivo.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med     uuid;
  v_cemento uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_cemento from public.products where tenant_id = v_med and sku = 'CEM-100';
  if v_cemento is null then return; end if;

  update public.products set barcode = '2000000000015'
  where id = v_cemento and barcode is null;

  if not exists (select 1 from public.barcode_scans where tenant_id = v_med and product_id = v_cemento) then
    insert into public.barcode_scans (tenant_id, product_id, scanned_code, scanned_at)
    values (v_med, v_cemento, '2000000000015', now() - interval '3 hours');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Flota (modulo 54): un vehiculo con conductor asignado, tres
--  documentos con los tres estados de vigencia posibles (vigente, por
--  vencer, vencido), dos cargas de combustible reales para que el
--  rendimiento se calcule solo, un mantenimiento cuyo proximo servicio
--  ya se alcanzo -para ver la alerta sin interactuar primero-, y una
--  multa pendiente.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_conductor uuid;
  v_vehiculo  uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_conductor from public.employees where tenant_id = v_med and first_name = 'Anthony';
  if v_conductor is null then return; end if;

  insert into public.vehicles (tenant_id, plate, brand, model, year, assigned_driver_id, odometer_km)
  values (v_med, 'A123456', 'Toyota', 'Hilux', 2022, v_conductor, 45000)
  on conflict (tenant_id, plate) do nothing
  returning id into v_vehiculo;
  if v_vehiculo is null then
    select id into v_vehiculo from public.vehicles where tenant_id = v_med and plate = 'A123456';
  end if;

  if not exists (select 1 from public.vehicle_documents where tenant_id = v_med and vehicle_id = v_vehiculo) then
    insert into public.vehicle_documents (tenant_id, vehicle_id, doc_type, expiry_date)
    values
      (v_med, v_vehiculo, 'license', current_date + 10),
      (v_med, v_vehiculo, 'insurance', current_date - 5),
      (v_med, v_vehiculo, 'inspection', current_date + 200);
  end if;

  if not exists (select 1 from public.fuel_logs where tenant_id = v_med and vehicle_id = v_vehiculo) then
    insert into public.fuel_logs (tenant_id, vehicle_id, driver_id, filled_at, liters, cost, odometer_km)
    values
      (v_med, v_vehiculo, v_conductor, now() - interval '20 days', 30, 5000.00, 44500),
      (v_med, v_vehiculo, v_conductor, now() - interval '2 days', 15, 2600.00, 45000);
  end if;

  if not exists (select 1 from public.maintenance_records where tenant_id = v_med and vehicle_id = v_vehiculo) then
    insert into public.maintenance_records
      (tenant_id, vehicle_id, service_date, type, description, cost, odometer_km, next_due_km)
    values
      (v_med, v_vehiculo, current_date - 30, 'preventive', 'Cambio de aceite y filtros', 3500.00, 40000, 45000);
  end if;

  if not exists (select 1 from public.traffic_fines where tenant_id = v_med and vehicle_id = v_vehiculo) then
    insert into public.traffic_fines (tenant_id, vehicle_id, driver_id, fine_date, amount, reason)
    values (v_med, v_vehiculo, v_conductor, current_date - 3, 2500.00, 'Exceso de velocidad en la autopista Duarte');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Logistica y rutas (modulo 53): una ruta ya en progreso con una
--  parada entregada de verdad (con prueba de entrega) y una pendiente
--  -para completar la ruta en vivo-, y una ruta todavia en
--  planificacion con una parada -para despachar en vivo-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med         uuid;
  v_conductor   uuid;
  v_martillo    uuid;
  v_duarte      uuid;
  v_ruta_activa uuid;
  v_ruta_plan   uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_conductor from public.employees where tenant_id = v_med and first_name = 'Anthony';
  select id into v_martillo from public.customers where tenant_id = v_med and name = 'Ferreteria El Martillo SRL';
  select id into v_duarte from public.customers where tenant_id = v_med and name = 'Constructora Duarte SRL';
  if v_conductor is null then return; end if;

  if not exists (
    select 1 from public.delivery_routes where tenant_id = v_med and status = 'in_progress'
  ) then
    insert into public.delivery_routes
      (tenant_id, driver_id, vehicle_plate, route_date, status, started_at)
    values (v_med, v_conductor, 'A123456', current_date - 1, 'in_progress', now() - interval '3 hours')
    returning id into v_ruta_activa;

    insert into public.route_stops (route_id, tenant_id, sequence, address, customer_id, status, recipient_name, delivered_at)
    values (v_ruta_activa, v_med, 1, 'Av. 27 de Febrero 45, Santo Domingo', v_martillo, 'delivered', 'Pedro Martinez', now() - interval '2 hours');

    insert into public.route_stops (route_id, tenant_id, sequence, address, customer_id)
    values (v_ruta_activa, v_med, 2, 'Calle El Sol 12, Santiago', v_duarte);
  end if;

  if not exists (
    select 1 from public.delivery_routes where tenant_id = v_med and status = 'planned'
  ) then
    insert into public.delivery_routes (tenant_id, driver_id, vehicle_plate, route_date)
    values (v_med, v_conductor, 'A123456', current_date + 1)
    returning id into v_ruta_plan;

    insert into public.route_stops (route_id, tenant_id, sequence, address, customer_id)
    values (v_ruta_plan, v_med, 1, 'Av. 27 de Febrero 45, Santo Domingo', v_martillo);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Lista de materiales (modulo 55): un sub-ensamble ya activo (varilla
--  reforzada, con su PROPIA receta) y un producto terminado -kit
--  basico de reparacion- cuyo BOM sigue en borrador con sus tres
--  componentes ya agregados, incluyendo el sub-ensamble -para activar
--  en vivo y ver el costeo MULTINIVEL resolverse solo-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med        uuid;
  v_cemento    uuid;
  v_varilla    uuid;
  v_pintura    uuid;
  v_var_ref    uuid;
  v_kit        uuid;
  v_bom_varref uuid;
  v_bom_kit    uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_cemento from public.products where tenant_id = v_med and sku = 'CEM-100';
  select id into v_varilla from public.products where tenant_id = v_med and sku = 'VAR-200';
  select id into v_pintura from public.products where tenant_id = v_med and sku = 'PIN-300';
  if v_cemento is null or v_varilla is null or v_pintura is null then return; end if;

  insert into public.products (tenant_id, sku, name, category, unit, price, cost)
  values (v_med, 'VAR-REF', 'Varilla reforzada y recubierta', 'Construccion', 'unidad', 380.00, 329.00)
  on conflict (tenant_id, sku) do nothing
  returning id into v_var_ref;
  if v_var_ref is null then
    select id into v_var_ref from public.products where tenant_id = v_med and sku = 'VAR-REF';
  end if;

  insert into public.products (tenant_id, sku, name, category, unit, price, cost)
  values (v_med, 'KIT-100', 'Kit basico de reparacion', 'Construccion', 'kit', 1400.00, 0)
  on conflict (tenant_id, sku) do nothing
  returning id into v_kit;
  if v_kit is null then
    select id into v_kit from public.products where tenant_id = v_med and sku = 'KIT-100';
  end if;

  -- Sub-ensamble ya activo: varilla + un poco de pintura como recubrimiento.
  if not exists (select 1 from public.bill_of_materials where tenant_id = v_med and product_id = v_var_ref) then
    insert into public.bill_of_materials (tenant_id, product_id, version, status, output_qty)
    values (v_med, v_var_ref, 1, 'active', 1)
    returning id into v_bom_varref;

    insert into public.bom_lines (bom_id, tenant_id, component_product_id, quantity_per_unit)
    values
      (v_bom_varref, v_med, v_varilla, 1),
      (v_bom_varref, v_med, v_pintura, 0.1);
  end if;

  -- Kit terminado, todavia en borrador -para activar en vivo-: usa el
  -- sub-ensamble de arriba, asi que su costo depende de otro BOM.
  if not exists (select 1 from public.bill_of_materials where tenant_id = v_med and product_id = v_kit) then
    insert into public.bill_of_materials (tenant_id, product_id, version, status, output_qty)
    values (v_med, v_kit, 1, 'draft', 1)
    returning id into v_bom_kit;

    insert into public.bom_lines (bom_id, tenant_id, component_product_id, quantity_per_unit)
    values
      (v_bom_kit, v_med, v_cemento, 0.5),
      (v_bom_kit, v_med, v_var_ref, 2),
      (v_bom_kit, v_med, v_pintura, 0.25);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Ordenes de produccion (modulo 56): una orden en borrador sobre el
--  BOM activo del kit basico de reparacion -para liberar en vivo y ver
--  la explosion de materiales consumir el inventario de verdad-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med    uuid;
  v_alm_sd uuid;
  v_kit    uuid;
  v_bom    uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_alm_sd from public.warehouses where tenant_id = v_med order by is_default desc limit 1;
  select id into v_kit from public.products where tenant_id = v_med and sku = 'KIT-100';
  if v_alm_sd is null or v_kit is null then return; end if;

  select id into v_bom from public.bill_of_materials
    where tenant_id = v_med and product_id = v_kit and status = 'active';
  if v_bom is null then return; end if;

  if not exists (
    select 1 from public.production_orders where tenant_id = v_med and bom_id = v_bom
  ) then
    insert into public.production_orders (tenant_id, bom_id, warehouse_id, qty_planned)
    values (v_med, v_bom, v_alm_sd, 5);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Planificacion MRP (modulo 57): una corrida ya hecha para 10 kits
--  basicos de reparacion, con sus 4 sugerencias -3 de comprar, 1 de
--  producir- para ver ambos caminos de aceptacion sin correr nada en
--  vivo primero. Asume cero stock disponible de estos insumos, asi
--  que la bruta y la neta coinciden.
--
--  El arbol real que explota KIT-100 x10 (bm.output_qty=1 en ambos
--  BOM): cemento 0.5*10=5 (compra, hoja); VAR-REF 2*10=20 (PRODUCE,
--  tiene su propia receta activa) que a su vez explota en varilla
--  1*20=20 (compra) y pintura 0.1*20=2 (compra); mas la pintura
--  directa del kit 0.25*10=2.5 (compra) -que se ACUMULA con la de
--  arriba: 2+2.5=4.5, la misma materia prima en dos ramas distintas-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med     uuid;
  v_kit     uuid;
  v_cemento uuid;
  v_varilla uuid;
  v_pintura uuid;
  v_var_ref uuid;
  v_run     uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_kit     from public.products where tenant_id = v_med and sku = 'KIT-100';
  select id into v_cemento from public.products where tenant_id = v_med and sku = 'CEM-100';
  select id into v_varilla from public.products where tenant_id = v_med and sku = 'VAR-200';
  select id into v_pintura from public.products where tenant_id = v_med and sku = 'PIN-300';
  select id into v_var_ref from public.products where tenant_id = v_med and sku = 'VAR-REF';
  if v_kit is null or v_cemento is null or v_varilla is null or v_pintura is null or v_var_ref is null then
    return;
  end if;

  if not exists (select 1 from public.mrp_runs where tenant_id = v_med and target_product_id = v_kit) then
    insert into public.mrp_runs (tenant_id, target_product_id, target_qty, notes)
    values (v_med, v_kit, 10, 'Reponer el kit basico de reparacion para el trimestre')
    returning id into v_run;

    insert into public.mrp_suggestions (run_id, tenant_id, product_id, action, qty_suggested)
    values
      (v_run, v_med, v_cemento, 'purchase', 5),
      (v_run, v_med, v_var_ref, 'produce', 20),
      (v_run, v_med, v_varilla, 'purchase', 20),
      (v_run, v_med, v_pintura, 'purchase', 4.5);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Control de calidad (modulo 58): un plan de inspeccion de recepcion
--  para el cemento con dos criterios -uno critico-, y una inspeccion
--  real ya reprobada por el criterio critico (empaque humedo), con su
--  no conformidad abierta en 'investigating' -lista para crear el CAPA
--  en vivo, sin resolver nada de antemano-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med         uuid;
  v_cemento     uuid;
  v_plan        uuid;
  v_crit_empaque uuid;
  v_crit_fecha  uuid;
  v_inspeccion  uuid;
  v_nc          uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_cemento from public.products where tenant_id = v_med and sku = 'CEM-100';
  if v_cemento is null then return; end if;

  if not exists (select 1 from public.inspection_plans where tenant_id = v_med and name = 'Recepcion de cemento') then
    insert into public.inspection_plans (tenant_id, name, scope, product_id)
    values (v_med, 'Recepcion de cemento', 'receiving', v_cemento)
    returning id into v_plan;

    insert into public.inspection_plan_criteria (plan_id, tenant_id, criterion, is_critical, sort_order)
    values
      (v_plan, v_med, 'Empaque sin humedad ni roturas', true, 1)
      returning id into v_crit_empaque;
    insert into public.inspection_plan_criteria (plan_id, tenant_id, criterion, is_critical, sort_order)
    values
      (v_plan, v_med, 'Fecha de fabricacion legible', false, 2)
      returning id into v_crit_fecha;

    insert into public.inspections (tenant_id, plan_id, product_id, result, notes)
    values (v_med, v_plan, v_cemento, 'failed', 'Dos fundas del lote llegaron con el empaque mojado')
    returning id into v_inspeccion;

    insert into public.inspection_results (inspection_id, tenant_id, criterion, is_critical, passed)
    values
      (v_inspeccion, v_med, 'Empaque sin humedad ni roturas', true, false),
      (v_inspeccion, v_med, 'Fecha de fabricacion legible', false, true);

    insert into public.non_conformances (tenant_id, description, severity, status, inspection_id)
    values (v_med, 'Cemento recibido con el empaque mojado -riesgo de fragua prematura-', 'major', 'investigating', v_inspeccion)
    returning id into v_nc;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Mantenimiento / CMMS (modulo 59): un compresor con mantenimiento
--  YA VENCIDO por uso (1,200 horas acumuladas contra un intervalo de
--  1,000 desde el ultimo servicio), dos fallas correctivas historicas
--  ya completadas -para que el MTBF tenga con que calcularse- y una
--  orden correctiva ABIERTA real, lista para trabajar en vivo.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med    uuid;
  v_equipo uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  if not exists (select 1 from public.equipment where tenant_id = v_med and code = 'CMP-01') then
    insert into public.equipment
      (tenant_id, code, name, location, usage_hours, last_service_at, last_service_usage,
       maintenance_interval_usage, maintenance_interval_days)
    values
      (v_med, 'CMP-01', 'Compresor de aire', 'Almacen Santo Domingo', 1200,
       current_date - 90, 100, 1000, 180)
    returning id into v_equipo;

    insert into public.work_orders
      (tenant_id, equipment_id, type, status, priority, description, opened_at, completed_at)
    values
      (v_med, v_equipo, 'corrective', 'completed', 'normal', 'Correa floja -tensada-',
       now() - interval '75 days', now() - interval '75 days' + interval '2 hours'),
      (v_med, v_equipo, 'corrective', 'completed', 'normal', 'Filtro de aire obstruido -reemplazado-',
       now() - interval '30 days', now() - interval '30 days' + interval '1 hour');

    insert into public.work_orders (tenant_id, equipment_id, type, priority, description)
    values (v_med, v_equipo, 'corrective', 'high', 'Fuga de aceite visible en la base del compresor');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Piso de planta / OEE (modulo 60): una orden de produccion propia
--  -sobre el sub-ensamble VAR-REF, que ya tiene su propio BOM activo-
--  liberada hace 6 horas, con un paro YA CERRADO de 45 minutos y una
--  sesion de operario YA CERRADA, para que el OEE tenga con que
--  calcularse desde el primer vistazo. Sin sesion ni paro abiertos
--  -listo para que la demo marque entrada o inicie un paro desde cero-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med     uuid;
  v_alm     uuid;
  v_var_ref uuid;
  v_bom     uuid;
  v_orden   uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_alm from public.warehouses where tenant_id = v_med order by is_default desc limit 1;
  select id into v_var_ref from public.products where tenant_id = v_med and sku = 'VAR-REF';
  if v_alm is null or v_var_ref is null then return; end if;

  select id into v_bom from public.bill_of_materials
    where tenant_id = v_med and product_id = v_var_ref and status = 'active';
  if v_bom is null then return; end if;

  if not exists (
    select 1 from public.production_orders
    where tenant_id = v_med and bom_id = v_bom and ideal_cycle_hours is not null
  ) then
    insert into public.production_orders
      (tenant_id, bom_id, warehouse_id, status, qty_planned, qty_completed, qty_scrapped,
       ideal_cycle_hours, released_at)
    values
      (v_med, v_bom, v_alm, 'in_progress', 50, 30, 2, 0.08, now() - interval '6 hours')
    returning id into v_orden;

    insert into public.shopfloor_downtime (tenant_id, production_order_id, reason, started_at, ended_at)
    values (v_med, v_orden, 'Cambio de rollo de material', now() - interval '4 hours', now() - interval '3 hours 15 minutes');

    insert into public.shopfloor_sessions (tenant_id, production_order_id, operator_id, clocked_in_at, clocked_out_at)
    values (v_med, v_orden, '00000000-0000-0000-0000-000000000001', now() - interval '6 hours', now() - interval '2 hours');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  CRM / Leads y Oportunidades (modulos 29-30, F9): un lead nuevo SIN
--  asignar -listo para probar la asignacion round-robin en vivo- y
--  otro ya calificado y asignado, con una oportunidad real en
--  'negotiation' -lista para marcarse ganada o perdida-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med    uuid;
  v_maria  constant uuid := '00000000-0000-0000-0000-000000000001';
  v_lead1  uuid;
  v_lead2  uuid;
  v_op     uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  if not exists (select 1 from public.leads where tenant_id = v_med and name = 'Ferreteria El Progreso') then
    insert into public.leads (tenant_id, name, company, email, phone, source, score, status)
    values (v_med, 'Ferreteria El Progreso', 'Ferreteria El Progreso SRL', 'compras@elprogreso.do', '809-555-0230', 'referral', 100, 'new')
    returning id into v_lead1;
  end if;

  if not exists (select 1 from public.leads where tenant_id = v_med and name = 'Constructora Vega Real') then
    insert into public.leads (tenant_id, name, company, email, phone, source, score, status, assigned_to)
    values (v_med, 'Constructora Vega Real', 'Constructora Vega Real SRL', 'proyectos@vegareal.do', '809-555-0417', 'event', 90, 'qualified', v_maria)
    returning id into v_lead2;

    insert into public.lead_activities (tenant_id, lead_id, type, notes, created_by)
    values
      (v_med, v_lead2, 'call', 'Primera llamada -interesados en material para la torre residencial-', v_maria),
      (v_med, v_lead2, 'meeting', 'Reunion en sitio, revisaron cantidades preliminares', v_maria);

    insert into public.opportunities (tenant_id, lead_id, name, amount, stage, probability, expected_close_date)
    values (v_med, v_lead2, 'Suministro de materiales - Torre Vega Real', 850000, 'negotiation', 0.75, current_date + 15)
    returning id into v_op;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Contabilidad: catalogo minimo + un asiento contabilizado y uno en
--  borrador -para que el widget de "sin contabilizar" tenga algo que
--  mostrar, no solo el caso feliz-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med     uuid;
  v_caja    uuid;
  v_ventas  uuid;
  v_itbis   uuid;
  v_asiento uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  -- Catalogo minimo: lo justo para que el primer asiento tenga sentido.
  insert into public.accounts (tenant_id, code, name, type) values
    (v_med, '1101', 'Caja', 'asset'),
    (v_med, '1102', 'Cuentas por cobrar', 'asset'),
    (v_med, '2101', 'ITBIS por pagar', 'liability'),
    (v_med, '3101', 'Capital social', 'equity'),
    (v_med, '4101', 'Ventas', 'revenue'),
    (v_med, '5101', 'Costo de ventas', 'expense')
  on conflict (tenant_id, code) do nothing;

  select id into v_caja   from public.accounts where tenant_id = v_med and code = '1101';
  select id into v_ventas from public.accounts where tenant_id = v_med and code = '4101';
  select id into v_itbis  from public.accounts where tenant_id = v_med and code = '2101';
  if v_caja is null or v_ventas is null or v_itbis is null then return; end if;

  -- Un asiento contabilizado: venta de contado con su ITBIS aparte. Se
  -- crea en borrador y se contabiliza con la MISMA funcion que usa la
  -- app -no se inserta directo en 'posted'-, porque el trigger de
  -- inmutabilidad no distingue "recien creado" de "de hace meses": una
  -- fila que nace en 'posted' ya no admite agregarle lineas despues.
  select id into v_asiento from public.journal_entries
    where tenant_id = v_med and number = 'AS-DEMO-0001';
  if v_asiento is null then
    insert into public.journal_entries (tenant_id, number, entry_date, description)
    values (v_med, 'AS-DEMO-0001', current_date - 3, 'Venta de contado del dia')
    returning id into v_asiento;

    insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit) values
      (v_asiento, v_med, v_caja, 11800.00, 0),
      (v_asiento, v_med, v_ventas, 0, 10000.00),
      (v_asiento, v_med, v_itbis, 0, 1800.00);

    perform set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid(), 'app_metadata',
        json_build_object('tenant_id', v_med, 'is_provider', false))::text, true);
    perform public.post_journal_entry(v_asiento);
  end if;

  -- Un borrador SIN contabilizar: para que el widget de pendientes no
  -- ensene siempre el caso feliz de "todo al dia".
  insert into public.journal_entries (tenant_id, number, entry_date, description)
  select v_med, 'AS-DEMO-0002', current_date, 'Compra de suministros de oficina'
  where not exists (
    select 1 from public.journal_entries where tenant_id = v_med and number = 'AS-DEMO-0002'
  );
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Cuentas por pagar: una factura de proveedor con retencion, abonada a
--  medias -para que la demo no ensene solo "cero deudas", que no le
--  ensena a nadie a leer la pantalla-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med      uuid;
  v_prov     uuid;
  v_factura  uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_prov from public.suppliers
    where tenant_id = v_med and name = 'Materiales Del Este SRL';
  if v_prov is null then return; end if;

  select id into v_factura from public.supplier_invoices
    where tenant_id = v_med and supplier_id = v_prov and supplier_invoice_number = 'FACT-0891';
  if v_factura is null then
    -- Retencion del 2% de ITBIS -tipico en servicios-, capturada a mano:
    -- el sistema no decide cuando aplica, solo la deja escribir.
    insert into public.supplier_invoices
      (tenant_id, supplier_id, supplier_invoice_number, issue_date, due_date,
       subtotal, tax, retention_amount, total)
    values (v_med, v_prov, 'FACT-0891', current_date - 20, current_date + 10,
            15000.00, 2700.00, 300.00, 17700.00)
    returning id into v_factura;

    insert into public.supplier_payments (tenant_id, invoice_id, amount, method, reference)
    values (v_med, v_factura, 8000.00, 'transfer', 'TRF-PROV-4471');
  end if;

  update public.supplier_invoices set status = 'partially_paid'
  where id = v_factura and status = 'open';
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Tesoreria: dos cuentas bancarias con movimientos y una transferencia
--  entre ellas -que es la unica forma de ver las dos mitades juntas-.
--
--  Idempotente por el unico real (tenant_id, bank_name, account_number).
--  Los movimientos NO se pueden borrar ni reescribir (trigger de
--  inmutabilidad), asi que se insertan solo si la cuenta acaba de nacer.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med         uuid;
  v_operativa   uuid;
  v_reserva     uuid;
  v_nuevas      boolean := false;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_operativa from public.bank_accounts
    where tenant_id = v_med and bank_name = 'Banco Popular' and account_number = '790-12345-6';
  if v_operativa is null then
    insert into public.bank_accounts
      (tenant_id, bank_name, account_name, account_number, account_type, opening_balance)
    values (v_med, 'Banco Popular', 'Cuenta operativa', '790-12345-6', 'checking', 185000.00)
    returning id into v_operativa;
    v_nuevas := true;
  end if;

  select id into v_reserva from public.bank_accounts
    where tenant_id = v_med and bank_name = 'Banreservas' and account_number = '960-88214-3';
  if v_reserva is null then
    insert into public.bank_accounts
      (tenant_id, bank_name, account_name, account_number, account_type, opening_balance)
    values (v_med, 'Banreservas', 'Reserva de nomina', '960-88214-3', 'savings', 60000.00)
    returning id into v_reserva;
  end if;

  if v_nuevas then
    insert into public.bank_transactions
      (tenant_id, bank_account_id, type, amount, description, reference, transaction_date)
    values
      (v_med, v_operativa, 'deposit', 42500.00, 'Deposito de cobros de la semana',
       'DEP-8841', current_date - 6),
      (v_med, v_operativa, 'withdrawal', 18700.00, 'Pago a Materiales Del Este SRL',
       'TRF-PROV-4471', current_date - 4),
      (v_med, v_operativa, 'withdrawal', 9200.00, 'Combustible y peajes de la flota',
       null, current_date - 2);

    -- La transferencia genera sus dos mitades sola (trigger de la 0044).
    insert into public.bank_transfers
      (tenant_id, from_account_id, to_account_id, amount, transfer_date, description)
    values (v_med, v_operativa, v_reserva, 75000.00, current_date - 1,
            'Aparte para la nomina de la quincena');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Conciliacion bancaria: un import con las 3 situaciones reales -una
--  linea ya conciliada, una pendiente con candidato obvio, y una
--  pendiente SIN candidato (una comision que el banco cobro y que nadie
--  registro en tesoreria: la razon de ser del modulo)-.
--
--  Idempotente por chequeo de existencia -no hay unique en period_start/
--  period_end que lo garantice solo-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med          uuid;
  v_operativa    uuid;
  v_deposito     uuid;
  v_import       uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_operativa from public.bank_accounts
    where tenant_id = v_med and bank_name = 'Banco Popular' and account_number = '790-12345-6';
  if v_operativa is null then return; end if;

  select id into v_import from public.bank_statement_imports
    where tenant_id = v_med and bank_account_id = v_operativa;
  if v_import is not null then return; end if;

  select id into v_deposito from public.bank_transactions
    where tenant_id = v_med and bank_account_id = v_operativa and reference = 'DEP-8841';

  insert into public.bank_statement_imports
    (tenant_id, bank_account_id, period_start, period_end, statement_balance)
  values (v_med, v_operativa, current_date - 10, current_date, 124450.00)
  returning id into v_import;

  insert into public.bank_statement_lines
    (tenant_id, import_id, bank_account_id, line_date, description, amount,
     match_status, matched_transaction_id)
  values
    (v_med, v_import, v_operativa, current_date - 6, 'DEPOSITO EFECTIVO SUC PRINCIPAL',
     42500.00, case when v_deposito is not null then 'matched' else 'pending' end, v_deposito),
    (v_med, v_import, v_operativa, current_date - 4, 'TRANSFERENCIA A PROVEEDOR',
     -18700.00, 'pending', null),
    (v_med, v_import, v_operativa, current_date - 1, 'COMISION MANTENIMIENTO DE CUENTA',
     -150.00, 'pending', null);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Activos fijos: un vehiculo activo con historial parcial en linea
--  recta, y un equipo ya dado de baja que uso acelerada -para ensenar los
--  dos metodos y los dos estados sin exagerar el volumen de datos-.
--
--  La depreciacion se inserta directo (no via run_fixed_asset_depreciation)
--  porque aqui se simula HISTORIAL de meses pasados, no la corrida de hoy
--  -exactamente la misma razon por la que accounting siembra su asiento ya
--  contabilizado con draft->post en vez de nacerlo posteado-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med        uuid;
  v_camioneta  uuid;
  v_impresora  uuid;
  v_nuevos     boolean := false;
  v_periodo    date;
  v_monto      numeric;
  i            integer;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_camioneta from public.fixed_assets where tenant_id = v_med and code = 'VEH-001';
  if v_camioneta is null then
    insert into public.fixed_assets
      (tenant_id, code, name, category, acquisition_date, acquisition_cost,
       salvage_value, useful_life_months, depreciation_method)
    values (v_med, 'VEH-001', 'Camioneta de reparto', 'vehicle', current_date - interval '10 months',
            850000.00, 50000.00, 60, 'straight_line')
    returning id into v_camioneta;
    v_nuevos := true;
  end if;

  select id into v_impresora from public.fixed_assets where tenant_id = v_med and code = 'EQ-002';
  if v_impresora is null then
    insert into public.fixed_assets
      (tenant_id, code, name, category, acquisition_date, acquisition_cost,
       salvage_value, useful_life_months, depreciation_method)
    values (v_med, 'EQ-002', 'Impresora fiscal anterior', 'equipment',
            current_date - interval '3 years', 45000.00, 0, 36, 'declining_balance')
    returning id into v_impresora;
    v_nuevos := true;
  end if;

  if v_nuevos then
    -- 3 meses de historial para la camioneta -sigue activa-.
    for i in 1..3 loop
      v_periodo := (date_trunc('month', current_date) - (i - 1) * interval '1 month' - interval '1 day')::date;
      v_monto := public.fixed_asset_monthly_depreciation(v_camioneta);
      insert into public.fixed_asset_depreciations (tenant_id, asset_id, period_date, amount)
      values (v_med, v_camioneta, v_periodo, v_monto);
    end loop;

    -- 6 meses de historial para la impresora, y despues se da de baja.
    for i in 1..6 loop
      v_periodo := (date_trunc('month', current_date - interval '2 years')
                    - (i - 1) * interval '1 month' - interval '1 day')::date;
      v_monto := public.fixed_asset_monthly_depreciation(v_impresora);
      insert into public.fixed_asset_depreciations (tenant_id, asset_id, period_date, amount)
      values (v_med, v_impresora, v_periodo, v_monto);
    end loop;

    update public.fixed_assets
    set status = 'disposed', disposed_at = current_date - interval '1 year',
        disposed_amount = 2000.00,
        disposed_reason = 'Cambiada por una impresora fiscal mas nueva, vendida como repuesto'
    where id = v_impresora;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Presupuestos: compara contra el asiento AS-DEMO-0001 que accounting ya
--  sembro -sin inventar una segunda entrada solo para esto-. Una linea
--  queda sobrepasada (ventas presupuestadas por debajo de lo real), una
--  sana (costo sin gasto real todavia) y una del mes siguiente, todavia
--  vacia -el caso de "plan sin ejecutar aun", distinto de "sin plan".
--
--  El mes se deriva de la MISMA fecha que uso el asiento (current_date-3),
--  no de current_date a secas, para que los dos siempre caigan en el mismo
--  mes sin importar cuando corra este script.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med            uuid;
  v_presupuesto    uuid;
  v_ventas         uuid;
  v_costo          uuid;
  v_ano            smallint;
  v_mes_actual     smallint;
  v_mes_siguiente  smallint;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_ventas from public.accounts where tenant_id = v_med and code = '4101';
  select id into v_costo from public.accounts where tenant_id = v_med and code = '5101';
  if v_ventas is null or v_costo is null then return; end if;

  v_ano           := extract(year  from (current_date - 3))::smallint;
  v_mes_actual    := extract(month from (current_date - 3))::smallint;
  v_mes_siguiente := (v_mes_actual % 12) + 1;

  select id into v_presupuesto from public.budgets
    where tenant_id = v_med and fiscal_year = v_ano and name = 'Presupuesto anual';
  if v_presupuesto is null then
    insert into public.budgets (tenant_id, name, fiscal_year, status)
    values (v_med, 'Presupuesto anual', v_ano, 'active')
    returning id into v_presupuesto;

    insert into public.budget_lines (tenant_id, budget_id, account_id, period_month, amount)
    values
      (v_med, v_presupuesto, v_ventas, v_mes_actual, 8000.00),
      (v_med, v_presupuesto, v_costo, v_mes_actual, 5000.00),
      (v_med, v_presupuesto, v_ventas, v_mes_siguiente, 15000.00);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Centros de costo: las dos sucursales reales que branches ya sembro
--  (Santo Domingo y Santiago), con un gasto prorrateado entre las dos
--  -calculado con splitAmount(), no a mano- y uno asignado manual a una
--  sola.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med    uuid;
  v_sd     uuid;
  v_sti    uuid;
  v_nuevos boolean := false;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_sd from public.cost_centers where tenant_id = v_med and code = 'SD';
  if v_sd is null then
    insert into public.cost_centers (tenant_id, code, name)
    values (v_med, 'SD', 'Sucursal Santo Domingo') returning id into v_sd;
    v_nuevos := true;
  end if;

  select id into v_sti from public.cost_centers where tenant_id = v_med and code = 'STI';
  if v_sti is null then
    insert into public.cost_centers (tenant_id, code, name)
    values (v_med, 'STI', 'Sucursal Santiago') returning id into v_sti;
    v_nuevos := true;
  end if;

  if v_nuevos then
    -- Alquiler y servicios: se reparte 2 a 1 -Santo Domingo es la sucursal
    -- mas grande-. 45000 * 2/3 = 30000.00 y 45000 * 1/3 = 15000.00: cuadra
    -- exacto sin necesitar el ajuste del ultimo centro, pero se calcula
    -- con la misma splitAmount() de siempre.
    insert into public.cost_center_allocations
      (tenant_id, cost_center_id, amount, description, allocation_date)
    values
      (v_med, v_sd, 30000.00, 'Alquiler y servicios de septiembre', current_date - 5),
      (v_med, v_sti, 15000.00, 'Alquiler y servicios de septiembre', current_date - 5),
      (v_med, v_sd, 8500.00, 'Publicidad en redes sociales', current_date - 2);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Multimoneda: tres tasas de USD en fechas distintas -para que el
--  historial se vea real y la diferencia cambiaria tenga algo que
--  comparar-, capturadas a mano como el modulo de verdad funciona.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  insert into public.exchange_rates (tenant_id, currency_code, rate_date, rate)
  values
    (v_med, 'USD', current_date - 30, 58.20),
    (v_med, 'USD', current_date - 15, 58.65),
    (v_med, 'USD', current_date - 2, 58.90)
  on conflict (tenant_id, currency_code, rate_date) do nothing;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Pasarelas de cobro: un link pendiente, uno ya pagado -para ensenar el
--  estado terminal-, y un cobro recurrente ya vencido -para poder probar
--  "generar cobros vencidos" en vivo sin esperar un mes-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med      uuid;
  v_martillo uuid;
  v_duarte   uuid;
  v_nuevos   boolean := false;
  v_pagado   uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_martillo from public.customers
    where tenant_id = v_med and name = 'Ferreteria El Martillo SRL';
  select id into v_duarte from public.customers
    where tenant_id = v_med and name = 'Constructora Duarte SRL';
  if v_martillo is null or v_duarte is null then return; end if;

  if not exists (select 1 from public.payment_links where tenant_id = v_med) then
    v_nuevos := true;

    insert into public.payment_links (tenant_id, customer_id, amount, description, expires_at)
    values (v_med, v_martillo, 5000.00, 'Anticipo de pedido especial', current_date + 5);

    insert into public.payment_links (tenant_id, customer_id, amount, description)
    values (v_med, v_martillo, 2500.00, 'Servicio de instalacion') returning id into v_pagado;

    perform set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid(), 'app_metadata',
        json_build_object('tenant_id', v_med, 'is_provider', false))::text, true);
    perform public.mark_payment_link_paid(v_pagado, 2500.00, now() - interval '3 days');
  end if;

  if v_nuevos and not exists (select 1 from public.recurring_charges where tenant_id = v_med) then
    insert into public.recurring_charges
      (tenant_id, customer_id, amount, description, frequency, next_charge_date)
    values (v_med, v_duarte, 3500.00, 'Mantenimiento mensual de equipos', 'monthly', current_date - 2);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Empleados: una jerarquia real de tres niveles -para que el organigrama
--  se vea con algo mas que una sola persona-, con una promocion real
--  registrada como segundo contrato, y un ingreso reciente para el widget
--  de "nuevos ingresos".
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_gerente   uuid;
  v_encargada uuid;
  v_vendedor  uuid;
  v_nuevos    boolean := false;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_gerente from public.employees where tenant_id = v_med and code = 'E-001';
  if v_gerente is null then
    insert into public.employees
      (tenant_id, code, first_name, last_name, national_id, hire_date, position, department, salary)
    values (v_med, 'E-001', 'Rafael', 'Encarnacion', '001-8823456-1',
            current_date - interval '3 years', 'Gerente General', 'Direccion', 85000.00)
    returning id into v_gerente;

    insert into public.employee_contracts
      (tenant_id, employee_id, contract_type, start_date, salary, position)
    values (v_med, v_gerente, 'indefinido', current_date - interval '3 years', 85000.00, 'Gerente General');

    v_nuevos := true;
  end if;

  select id into v_encargada from public.employees where tenant_id = v_med and code = 'E-002';
  if v_encargada is null then
    insert into public.employees
      (tenant_id, code, first_name, last_name, national_id, hire_date, position, department,
       manager_id, salary)
    values (v_med, 'E-002', 'Yolanda', 'Peña', '001-7712345-9',
            current_date - interval '2 years', 'Encargada de Sucursal', 'Ventas', v_gerente, 32000.00)
    returning id into v_encargada;

    -- Primer contrato, y la promocion que le siguio un ano despues -dos
    -- filas de historial real, no un solo salario reescrito-.
    insert into public.employee_contracts
      (tenant_id, employee_id, contract_type, start_date, salary, position, is_active)
    values (v_med, v_encargada, 'indefinido', current_date - interval '2 years', 25000.00,
            'Vendedora', false);

    insert into public.employee_contracts
      (tenant_id, employee_id, contract_type, start_date, salary, position)
    values (v_med, v_encargada, 'indefinido', current_date - interval '1 year', 32000.00,
            'Encargada de Sucursal');

    v_nuevos := true;
  end if;

  select id into v_vendedor from public.employees where tenant_id = v_med and code = 'E-003';
  if v_vendedor is null then
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, department, manager_id, salary)
    values (v_med, 'E-003', 'Anthony', 'Ramirez', current_date - 10, 'Vendedor', 'Ventas',
            v_encargada, 18000.00);

    insert into public.employee_contracts (tenant_id, employee_id, contract_type, start_date, salary, position)
    select v_med, id, 'indefinido', current_date - 10, 18000.00, 'Vendedor'
    from public.employees where tenant_id = v_med and code = 'E-003';

    v_nuevos := true;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Nomina: un periodo del mes pasado ya PROCESADO -con las lineas de
--  Rafael y Yolanda calculadas a mano con la misma formula de
--  calculatePayrollLine(), para que el volante muestre numeros reales sin
--  reimplementar la aritmetica de TSS/ISR en SQL- y uno del mes actual en
--  BORRADOR, para poder probar /payroll/run en vivo.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med        uuid;
  v_gerente    uuid;
  v_encargada  uuid;
  v_periodo    uuid;
  v_inicio_mes_pasado date := date_trunc('month', current_date - interval '1 month')::date;
  v_fin_mes_pasado    date := (date_trunc('month', current_date) - interval '1 day')::date;
  v_inicio_mes_actual date := date_trunc('month', current_date)::date;
  v_fin_mes_actual    date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_gerente from public.employees where tenant_id = v_med and code = 'E-001';
  select id into v_encargada from public.employees where tenant_id = v_med and code = 'E-002';
  if v_gerente is null or v_encargada is null then return; end if;

  if not exists (
    select 1 from public.payroll_periods
    where tenant_id = v_med and period_start = v_inicio_mes_pasado
  ) then
    -- Nace en 'draft' -la inmutabilidad no distingue "recien creado" de
    -- "de hace meses", mismo motivo que el asiento demo de accounting
    -- nace en draft y se contabiliza despues, nunca al reves-.
    insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
    values (v_med, v_inicio_mes_pasado, v_fin_mes_pasado, v_fin_mes_pasado)
    returning id into v_periodo;

    -- Rafael, 85000: TSS 85000*0.0591=5023.50; ISR mensual 8577.06
    -- (anualizado 959718 cae en el tramo de 25%: 79776+(959718-867123)*0.25=102924.75, /12).
    insert into public.payroll_lines
      (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
    values (v_med, v_periodo, v_gerente, 85000.00, 5023.50, 8577.06, 71399.44);

    -- Yolanda, con su salario de ANTES de la promocion (25000, el mes
    -- pasado): TSS 25000*0.0591=1477.50; dentro del tramo exento, ISR 0.
    insert into public.payroll_lines
      (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
    values (v_med, v_periodo, v_encargada, 25000.00, 1477.50, 0, 23522.50);

    update public.payroll_periods
    set status = 'processed',
        tax_params = '{"afpEmployeeRate":0.0287,"sfsEmployeeRate":0.0304,"contributionCap":415492}'::jsonb
    where id = v_periodo;
  end if;

  if not exists (
    select 1 from public.payroll_periods
    where tenant_id = v_med and period_start = v_inicio_mes_actual
  ) then
    insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
    values (v_med, v_inicio_mes_actual, v_fin_mes_actual, v_fin_mes_actual);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Asistencia: una geocerca real para la sucursal Santo Domingo, un
--  marcaje de ayer ya cerrado -con hora extra real- y uno de hoy todavia
--  abierto -con una leve tardanza-, dentro del radio de la geocerca.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med          uuid;
  v_sucursal     uuid;
  v_vendedor     uuid;
  v_encargada    uuid;
  v_hoy_rd       date;
  v_entrada_hoy  timestamptz;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_sucursal from public.branches where tenant_id = v_med and code = 'SD';
  select id into v_vendedor from public.employees where tenant_id = v_med and code = 'E-003';
  select id into v_encargada from public.employees where tenant_id = v_med and code = 'E-002';
  if v_sucursal is null or v_vendedor is null or v_encargada is null then return; end if;

  insert into public.attendance_geofences (tenant_id, branch_id, latitude, longitude, radius_meters)
  values (v_med, v_sucursal, 18.486058, -69.931212, 150)
  on conflict (tenant_id, branch_id) do nothing;

  -- RD es siempre UTC-4 (sin horario de verano). `current_date` usa la zona
  -- de la sesion de Postgres (UTC en Docker/Supabase) -entre las 8pm y la
  -- medianoche hora de RD, UTC ya cambio de fecha y "hoy" quedaria un dia
  -- adelantado, generando un marcaje en el futuro que la salida real (now())
  -- nunca podria cerrar-. Se calcula el dia calendario real de RD restando
  -- el offset antes de truncar a fecha.
  v_hoy_rd := (now() - interval '4 hours')::date;

  if not exists (
    select 1 from public.attendance_records where tenant_id = v_med and employee_id = v_encargada
  ) then
    -- Ayer (de RD): entro a tiempo, salio dos horas tarde -hora extra real-.
    insert into public.attendance_records
      (tenant_id, employee_id, check_in, check_out, check_in_method, check_in_lat, check_in_lng, within_geofence)
    values (v_med, v_encargada,
            ((v_hoy_rd - 1)::text || ' 08:02:00-04')::timestamptz,
            ((v_hoy_rd - 1)::text || ' 18:15:00-04')::timestamptz,
            'geofence', 18.486100, -69.931250, true);
  end if;

  if not exists (
    select 1 from public.attendance_records where tenant_id = v_med and employee_id = v_vendedor
  ) then
    -- Hoy (de RD): todavia abierto -sin salida-, con una leve tardanza.
    -- Si en RD todavia no son las 8:17am, usar ayer -si no, el marcaje
    -- quedaria en el futuro y ningun check-out podria cerrarlo todavia-.
    v_entrada_hoy := (v_hoy_rd::text || ' 08:17:00-04')::timestamptz;
    if v_entrada_hoy > now() then
      v_entrada_hoy := v_entrada_hoy - interval '1 day';
    end if;
    insert into public.attendance_records
      (tenant_id, employee_id, check_in, check_in_method, check_in_lat, check_in_lng, within_geofence)
    values (v_med, v_vendedor, v_entrada_hoy, 'geofence', 18.486070, -69.931200, true);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Vacaciones & Permisos: una solicitud de vacaciones ya tomada -reduce el
--  saldo del encargado-, una pendiente por aprobar, y un permiso personal
--  rechazado -para ver los tres estados en la pantalla-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_encargada uuid; -- Rafael, el de mas antiguedad: tiene saldo para pedir
  v_cajera    uuid; -- Yolanda
  v_inicio    date;
  v_fin       date;
  v_dias      integer;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_encargada from public.employees where tenant_id = v_med and code = 'E-001';
  select id into v_cajera    from public.employees where tenant_id = v_med and code = 'E-002';
  if v_encargada is null or v_cajera is null then return; end if;

  if not exists (
    select 1 from public.time_off_requests where tenant_id = v_med and employee_id = v_encargada
  ) then
    -- Ya tomada y aprobada, hace un par de meses -resta del saldo mostrado en pantalla-.
    v_inicio := current_date - 60;
    v_fin    := current_date - 56;
    select count(*) into v_dias from generate_series(v_inicio, v_fin, interval '1 day') d
      where extract(dow from d) not in (0, 6);

    insert into public.time_off_requests
      (tenant_id, employee_id, leave_type, start_date, end_date, business_days, status, decided_at)
    values (v_med, v_encargada, 'vacation', v_inicio, v_fin, v_dias, 'approved', now() - interval '55 days');

    -- Pendiente por aprobar, unas semanas adelante -para la cola de /vacaciones/aprobar-.
    v_inicio := current_date + 14;
    v_fin    := current_date + 18;
    select count(*) into v_dias from generate_series(v_inicio, v_fin, interval '1 day') d
      where extract(dow from d) not in (0, 6);

    insert into public.time_off_requests
      (tenant_id, employee_id, leave_type, start_date, end_date, business_days, reason)
    values (v_med, v_encargada, 'vacation', v_inicio, v_fin, v_dias, 'Viaje familiar ya reservado');
  end if;

  if not exists (
    select 1 from public.time_off_requests where tenant_id = v_med and employee_id = v_cajera
  ) then
    -- Un permiso personal de un dia, rechazado -para ver el estado en pantalla-.
    -- Si esa fecha cae en fin de semana, no habria ningun dia laborable
    -- que contar -y business_days > 0 es obligatorio-, asi que se
    -- retrocede hasta encontrar un dia entre semana.
    v_inicio := current_date - 20;
    while extract(dow from v_inicio) in (0, 6) loop
      v_inicio := v_inicio - 1;
    end loop;

    insert into public.time_off_requests
      (tenant_id, employee_id, leave_type, start_date, end_date, business_days, status, reason, decided_at, decision_note)
    values (v_med, v_cajera, 'personal', v_inicio, v_inicio, 1, 'rejected',
            'Cita personal', now() - interval '19 days', 'Coincide con el cierre de mes, se reagenda.');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Gastos & Reembolsos: uno reportado por aprobar, uno aprobado esperando
--  reembolso -con NCF valido, para ver el ITBIS deducible-, y uno ya
--  reembolsado -para ver los cuatro estados de una vez-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_encargada uuid; -- Rafael
  v_cajera    uuid; -- Yolanda
  v_vendedor  uuid; -- Anthony
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_encargada from public.employees where tenant_id = v_med and code = 'E-001';
  select id into v_cajera    from public.employees where tenant_id = v_med and code = 'E-002';
  select id into v_vendedor  from public.employees where tenant_id = v_med and code = 'E-003';
  if v_encargada is null or v_cajera is null or v_vendedor is null then return; end if;

  if not exists (
    select 1 from public.expenses where tenant_id = v_med and employee_id = v_cajera
  ) then
    -- Reportado, todavia sin resolver -sin NCF, un taxi de carrera-.
    insert into public.expenses
      (tenant_id, employee_id, category, expense_date, amount, vendor_name, receipt_note)
    values (v_med, v_cajera, 'transport', current_date - 3, 850,
            'Taxi Uber', 'Carrera al banco a depositar el cierre de caja');
  end if;

  if not exists (
    select 1 from public.expenses where tenant_id = v_med and employee_id = v_encargada
  ) then
    -- Aprobado, esperando reembolso -con NCF fiscal valido: es deducible de ITBIS-.
    insert into public.expenses
      (tenant_id, employee_id, category, expense_date, amount, vendor_name, vendor_tax_id, ncf,
       receipt_note, status, decided_at)
    values (v_med, v_encargada, 'supplies', current_date - 10, 3200,
            'Office Depot Dominicana', '101-88776-5', 'B0100004521',
            'Resmas de papel y tinta para la impresora de la oficina', 'approved', now() - interval '8 days');
  end if;

  if not exists (
    select 1 from public.expenses where tenant_id = v_med and employee_id = v_vendedor
  ) then
    -- Reportado, aprobado y ya reembolsado por transferencia -sin NCF: no es deducible-.
    insert into public.expenses
      (tenant_id, employee_id, category, expense_date, amount, vendor_name, receipt_note,
       status, decided_at, reimbursed_at, reimbursement_method)
    values (v_med, v_vendedor, 'meals', current_date - 15, 650,
            'Colmado Los Hermanos', 'Almuerzo con un cliente en visita de venta',
            'reimbursed', now() - interval '13 days', now() - interval '10 days', 'transfer');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Portal del Empleado: dos anuncios -uno reciente, uno viejo, para ver
--  la insignia "Nuevo" en accion- y el correo de Rafael enlazado al del
--  usuario demo, para que /portal muestre un expediente de verdad -sin
--  ese correo coincidente, el portal solo mostraria el estado vacio-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_encargada uuid; -- Rafael
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_encargada from public.employees where tenant_id = v_med and code = 'E-001';
  if v_encargada is null then return; end if;

  -- El usuario demo (Owner) inicia sesion como maria.rosario@demo.do -ver
  -- 0009/bootstrap-. Sin este correo en el expediente de Rafael, el
  -- portal de demo no encontraria a quien mostrar.
  update public.employees set email = 'maria.rosario@demo.do'
  where id = v_encargada and email is null;

  if not exists (select 1 from public.hr_announcements where tenant_id = v_med) then
    insert into public.hr_announcements (tenant_id, title, body, published_at)
    values
      (v_med, 'Horario especial fin de mes',
       'El viernes de cierre de mes trabajamos hasta las 5:00pm -una hora menos que lo usual- para el corte de caja.',
       now() - interval '3 days'),
      (v_med, 'Nueva politica de vacaciones',
       'A partir de este año, las vacaciones se solicitan con al menos 2 semanas de anticipacion desde el portal.',
       now() - interval '25 days');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Beneficios: un prestamo activo con dos cuotas ya pagadas -saldo
--  parcial, calculado en vivo-, un adelanto ya saldado por completo, y
--  dos inscripciones a un plan de seguro -para ver el costo patronal-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_encargada uuid; -- Rafael
  v_cajera    uuid; -- Yolanda
  v_vendedor  uuid; -- Anthony
  v_prestamo  uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_encargada from public.employees where tenant_id = v_med and code = 'E-001';
  select id into v_cajera    from public.employees where tenant_id = v_med and code = 'E-002';
  select id into v_vendedor  from public.employees where tenant_id = v_med and code = 'E-003';
  if v_encargada is null or v_cajera is null or v_vendedor is null then return; end if;

  if not exists (
    select 1 from public.benefit_loans where tenant_id = v_med and employee_id = v_cajera
  ) then
    -- Prestamo de 12000 a 6 cuotas de 2000, sin interes -dos ya pagadas-.
    insert into public.benefit_loans
      (tenant_id, employee_id, loan_type, principal, installments, installment_amount, start_date)
    values (v_med, v_cajera, 'loan', 12000, 6, 2000, current_date - 60)
    returning id into v_prestamo;

    insert into public.benefit_loan_payments (tenant_id, loan_id, amount, paid_at, source)
    values (v_med, v_prestamo, 2000, now() - interval '30 days', 'payroll'),
           (v_med, v_prestamo, 2000, now() - interval '15 days', 'payroll');
  end if;

  if not exists (
    select 1 from public.benefit_loans where tenant_id = v_med and employee_id = v_vendedor
  ) then
    -- Adelanto de 3000 en una sola cuota -ya saldado por completo-.
    insert into public.benefit_loans
      (tenant_id, employee_id, loan_type, principal, installments, installment_amount, start_date, status)
    values (v_med, v_vendedor, 'advance', 3000, 1, 3000, current_date - 20, 'active')
    returning id into v_prestamo;

    insert into public.benefit_loan_payments (tenant_id, loan_id, amount, paid_at, source)
    values (v_med, v_prestamo, 3000, now() - interval '18 days', 'cash');

    update public.benefit_loans set status = 'paid' where id = v_prestamo;
  end if;

  if not exists (
    select 1 from public.benefit_enrollments where tenant_id = v_med and employee_id = v_encargada
  ) then
    insert into public.benefit_enrollments
      (tenant_id, employee_id, plan_name, employee_contribution, employer_contribution, effective_date)
    values (v_med, v_encargada, 'Seguro Salud Plus', 800, 1800, current_date - 300);

    insert into public.benefit_enrollments
      (tenant_id, employee_id, plan_name, employee_contribution, employer_contribution, effective_date)
    values (v_med, v_cajera, 'Seguro Salud Basico', 500, 1200, current_date - 200);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Reclutamiento: una vacante abierta con dos candidatos en distinta
--  etapa del pipeline -uno con entrevista ya agendada-, y una vacante ya
--  cerrada -para ver los dos estados en la lista-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med        uuid;
  v_vacante    uuid;
  v_cerrada    uuid;
  v_candidato1 uuid;
  v_candidato2 uuid;
  v_aplicacion uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  if not exists (select 1 from public.recruiting_positions where tenant_id = v_med) then
    insert into public.recruiting_positions (tenant_id, title, department, description)
    values (v_med, 'Vendedor de Piso', 'Ventas', 'Atencion al cliente y ventas en la sucursal de Santo Domingo.')
    returning id into v_vacante;

    insert into public.recruiting_positions (tenant_id, title, department, status)
    values (v_med, 'Contador', 'Administracion', 'closed')
    returning id into v_cerrada;

    insert into public.recruiting_candidates (tenant_id, first_name, last_name, email, source)
    values (v_med, 'Carla', 'Jimenez', 'carla.jimenez@correo.do', 'website')
    returning id into v_candidato1;

    insert into public.recruiting_candidates (tenant_id, first_name, last_name, email, source)
    values (v_med, 'Miguel', 'Santana', 'miguel.santana@correo.do', 'referral')
    returning id into v_candidato2;

    insert into public.recruiting_applications (tenant_id, position_id, candidate_id, stage)
    values (v_med, v_vacante, v_candidato1, 'interview')
    returning id into v_aplicacion;

    insert into public.recruiting_interviews (tenant_id, application_id, scheduled_at, interviewer_name)
    values (v_med, v_aplicacion, now() + interval '3 days', 'Rafael Encarnacion');

    insert into public.recruiting_applications (tenant_id, position_id, candidate_id, stage)
    values (v_med, v_vacante, v_candidato2, 'applied');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Desempeno: un objetivo con dos resultados clave en progreso parcial,
--  un 1:1 agendado, dos evaluaciones del mismo ciclo -para ver el
--  promedio 360-, y un plan de mejora activo.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_encargada uuid; -- Rafael
  v_cajera    uuid; -- Yolanda
  v_objetivo  uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_encargada from public.employees where tenant_id = v_med and code = 'E-001';
  select id into v_cajera    from public.employees where tenant_id = v_med and code = 'E-002';
  if v_encargada is null or v_cajera is null then return; end if;

  if not exists (
    select 1 from public.performance_objectives where tenant_id = v_med and employee_id = v_encargada
  ) then
    insert into public.performance_objectives (tenant_id, employee_id, title, period)
    values (v_med, v_encargada, 'Mejorar la satisfaccion del cliente', '2026-Q3')
    returning id into v_objetivo;

    insert into public.performance_key_results (tenant_id, objective_id, description, target_value, current_value, unit)
    values (v_med, v_objetivo, 'Encuestas de satisfaccion completadas', 50, 32, 'encuestas'),
           (v_med, v_objetivo, 'Calificacion promedio de satisfaccion', 4.5, 4.1, 'estrellas');

    insert into public.performance_one_on_ones (tenant_id, employee_id, scheduled_at)
    values (v_med, v_encargada, now() + interval '2 days');

    insert into public.performance_reviews (tenant_id, employee_id, cycle, review_type, reviewer_name, rating, comments)
    values (v_med, v_encargada, '2026-Q3', 'self', 'Rafael Encarnacion', 4, 'Buen trimestre, mejorando la atencion.'),
           (v_med, v_encargada, '2026-Q3', 'manager', 'Maria Rosario', 5, 'Excelente liderazgo del equipo de ventas.');

    insert into public.performance_improvement_plans (tenant_id, employee_id, reason, goals, start_date, end_date)
    values (v_med, v_cajera, 'Llegadas tarde recurrentes', 'Llegar a tiempo las proximas 4 semanas', current_date - 5, current_date + 25);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Capacitacion: un curso completado y certificado -con el certificado
--  por vencer pronto, para ver el widget en accion-, uno en curso sin
--  nota todavia, uno no aprobado, y una competencia con dos empleados
--  evaluados -para ver el promedio del equipo-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med         uuid;
  v_encargada   uuid; -- Rafael
  v_cajera      uuid; -- Yolanda
  v_vendedor    uuid; -- Anthony
  v_curso_at    uuid;
  v_curso_caja  uuid;
  v_inscripcion uuid;
  v_competencia uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_encargada from public.employees where tenant_id = v_med and code = 'E-001';
  select id into v_cajera    from public.employees where tenant_id = v_med and code = 'E-002';
  select id into v_vendedor  from public.employees where tenant_id = v_med and code = 'E-003';
  if v_encargada is null or v_cajera is null or v_vendedor is null then return; end if;

  if not exists (select 1 from public.training_courses where tenant_id = v_med) then
    insert into public.training_courses (tenant_id, title, description, duration_hours, passing_score)
    values (v_med, 'Atencion al cliente', 'Fundamentos de servicio al cliente en el mostrador.', 4, 70)
    returning id into v_curso_at;

    insert into public.training_courses (tenant_id, title, description, duration_hours, passing_score)
    values (v_med, 'Manejo de caja y arqueo', 'Procedimiento correcto de apertura, cierre y arqueo de caja.', 3, 80)
    returning id into v_curso_caja;

    -- Yolanda: completo y aprobo -certificado por vencer en 20 dias-.
    insert into public.training_enrollments
      (tenant_id, course_id, employee_id, status, score, enrolled_at, completed_at)
    values (v_med, v_curso_caja, v_cajera, 'completed', 92, now() - interval '10 days', now() - interval '2 days')
    returning id into v_inscripcion;

    insert into public.training_certificates (tenant_id, enrollment_id, expires_at)
    values (v_med, v_inscripcion, now() + interval '20 days');

    -- Anthony: en curso, todavia sin nota.
    insert into public.training_enrollments (tenant_id, course_id, employee_id, enrolled_at)
    values (v_med, v_curso_at, v_vendedor, now() - interval '3 days');

    -- Rafael: no aprobo -por debajo del minimo del curso-.
    insert into public.training_enrollments
      (tenant_id, course_id, employee_id, status, score, enrolled_at, completed_at)
    values (v_med, v_curso_caja, v_encargada, 'failed', 55, now() - interval '15 days', now() - interval '12 days');

    insert into public.training_competencies (tenant_id, name, description)
    values (v_med, 'Atencion al cliente', 'Capacidad de resolver quejas y dudas del cliente en el mostrador')
    returning id into v_competencia;

    insert into public.training_employee_competencies (tenant_id, employee_id, competency_id, level)
    values (v_med, v_encargada, v_competencia, 5),
           (v_med, v_cajera, v_competencia, 4);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Proveedores: la MISMA ficha que ya usan compras y cuentas por pagar
--  (Materiales Del Este SRL) -homologada, con un documento vigente, uno
--  por vencer pronto, una cuenta bancaria y dos evaluaciones-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_proveedor uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_proveedor from public.suppliers where tenant_id = v_med and code = 'PROV-001';
  if v_proveedor is null then return; end if;

  if not exists (select 1 from public.supplier_documents where tenant_id = v_med and supplier_id = v_proveedor) then
    update public.suppliers set qualification_status = 'qualified' where id = v_proveedor;

    insert into public.supplier_documents (tenant_id, supplier_id, doc_type, doc_number, issued_at, expires_at)
    values (v_med, v_proveedor, 'rnc_certificate', 'RNC-88112233', current_date - 300, current_date + 300),
           (v_med, v_proveedor, 'insurance', 'POL-55221', current_date - 335, current_date + 25);

    insert into public.supplier_bank_accounts (tenant_id, supplier_id, bank_name, account_number, account_type, currency)
    values (v_med, v_proveedor, 'Banco Popular Dominicano', '840012345678', 'checking', 'DOP');

    insert into public.supplier_evaluations (tenant_id, supplier_id, score, comments, evaluated_by, evaluated_at)
    values (v_med, v_proveedor, 4, 'Entrega puntual, calidad consistente.', 'Rafael Encarnacion', now() - interval '60 days'),
           (v_med, v_proveedor, 5, 'Resolvio un reclamo de calidad muy rapido.', 'Rafael Encarnacion', now() - interval '10 days');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Listas de precios: una general con descuento por volumen en cemento,
--  una de cliente con precio especial en varilla -asignada de verdad al
--  cliente-, y una de canal online con precio especial en pintura.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med         uuid;
  v_cemento     uuid;
  v_varilla     uuid;
  v_pintura     uuid;
  v_duarte      uuid;
  v_lista_gen   uuid;
  v_lista_cli   uuid;
  v_lista_canal uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_cemento from public.products where tenant_id = v_med and sku = 'CEM-100';
  select id into v_varilla from public.products where tenant_id = v_med and sku = 'VAR-200';
  select id into v_pintura from public.products where tenant_id = v_med and sku = 'PIN-300';
  select id into v_duarte  from public.customers where tenant_id = v_med and name = 'Constructora Duarte SRL';
  if v_cemento is null or v_varilla is null or v_pintura is null or v_duarte is null then return; end if;

  if not exists (select 1 from public.price_lists where tenant_id = v_med) then
    insert into public.price_lists (tenant_id, name, scope, start_date)
    values (v_med, 'Lista General 2026', 'general', current_date - 60)
    returning id into v_lista_gen;

    insert into public.price_list_entries (tenant_id, price_list_id, product_id, min_quantity, unit_price)
    values (v_med, v_lista_gen, v_cemento, 1, 465),
           (v_med, v_lista_gen, v_cemento, 50, 440),
           (v_med, v_lista_gen, v_cemento, 200, 410);

    insert into public.price_lists (tenant_id, name, scope, customer_id, start_date)
    values (v_med, 'Constructora Duarte - Mayorista', 'customer', v_duarte, current_date - 30)
    returning id into v_lista_cli;

    insert into public.price_list_entries (tenant_id, price_list_id, product_id, min_quantity, unit_price)
    values (v_med, v_lista_cli, v_varilla, 1, 270);

    update public.customers set price_list_id = v_lista_cli where id = v_duarte;

    insert into public.price_lists (tenant_id, name, scope, channel, start_date)
    values (v_med, 'Canal Online', 'channel', 'online', current_date - 15)
    returning id into v_lista_canal;

    insert into public.price_list_entries (tenant_id, price_list_id, product_id, min_quantity, unit_price)
    values (v_med, v_lista_canal, v_pintura, 1, 1100);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Requisiciones: una pendiente por aprobar, una ya aprobada y
--  convertida en orden, una rechazada -los tres desenlaces de una vez-.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med       uuid;
  v_encargada uuid; -- Rafael
  v_cajera    uuid; -- Yolanda
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_encargada from public.employees where tenant_id = v_med and code = 'E-001';
  select id into v_cajera    from public.employees where tenant_id = v_med and code = 'E-002';
  if v_encargada is null or v_cajera is null then return; end if;

  if not exists (select 1 from public.purchase_requisitions where tenant_id = v_med) then
    insert into public.purchase_requisitions (tenant_id, employee_id, department, description, estimated_amount, status)
    values (v_med, v_cajera, 'Ventas', 'Papeleria y utiles de oficina para el mes', 3500, 'pending');

    insert into public.purchase_requisitions
      (tenant_id, employee_id, department, description, estimated_amount, status,
       approved_by, approved_at, po_reference)
    values (v_med, v_encargada, 'Operaciones', 'Reposicion de cemento y varillas', 45000, 'converted',
            v_encargada, now() - interval '5 days', 'OC-2026-00012');

    insert into public.purchase_requisitions
      (tenant_id, employee_id, department, description, estimated_amount, status,
       approved_by, approved_at, decision_note)
    values (v_med, v_cajera, 'Ventas', 'Cambiar el aire acondicionado de la sucursal', 85000, 'rejected',
            v_encargada, now() - interval '8 days', 'Se pospone para el proximo trimestre, no es urgente.');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  RFQ: un segundo proveedor -para tener con quien comparar-, un RFQ
--  abierto con dos cotizaciones -donde gana el monto mas bajo aunque no
--  sea el proveedor ya homologado-, y uno ya adjudicado.
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  v_med          uuid;
  v_prov1        uuid; -- Materiales Del Este SRL, ya homologado
  v_prov2        uuid;
  v_rfq_abierto  uuid;
  v_rfq_cerrado  uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_prov1 from public.suppliers where tenant_id = v_med and code = 'PROV-001';
  if v_prov1 is null then return; end if;

  if not exists (select 1 from public.rfqs where tenant_id = v_med) then
    insert into public.suppliers (tenant_id, code, name, tax_id)
    values (v_med, 'PROV-002', 'Ferreteria Central Import SRL', '101-99887-3')
    returning id into v_prov2;

    insert into public.rfqs (tenant_id, title, description, deadline)
    values (v_med, 'Cotizacion de cemento y varillas', 'Reposicion de inventario para el proximo trimestre', current_date + 10)
    returning id into v_rfq_abierto;

    insert into public.rfq_invitations (tenant_id, rfq_id, supplier_id)
    values (v_med, v_rfq_abierto, v_prov1), (v_med, v_rfq_abierto, v_prov2);

    insert into public.rfq_quotes (tenant_id, rfq_id, supplier_id, total_amount, lead_time_days, notes)
    values (v_med, v_rfq_abierto, v_prov1, 45000, 10, 'Precio de siempre, entrega en camion propio'),
           (v_med, v_rfq_abierto, v_prov2, 43000, 15, 'Precio mas bajo pero entrega mas lenta');

    insert into public.rfqs (tenant_id, title, status, awarded_supplier_id, awarded_at)
    values (v_med, 'Cotizacion de pintura para el segundo trimestre', 'awarded', v_prov1, now() - interval '20 days')
    returning id into v_rfq_cerrado;

    insert into public.rfq_quotes (tenant_id, rfq_id, supplier_id, total_amount, lead_time_days)
    values (v_med, v_rfq_cerrado, v_prov1, 12000, 5);
  end if;
end $$;
