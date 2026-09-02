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
         (v_med, 'purchase-orders', 'active', true)
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
