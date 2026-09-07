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
         (v_med, 'payroll', 'active', true)
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
