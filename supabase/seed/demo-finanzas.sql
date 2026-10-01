-- ═══════════════════════════════════════════════════════════════════════
--  Demo de Finanzas: contabilidad, por pagar, tesorería, conciliación,
--  activos fijos, presupuestos, impuestos, consolidación, centros de
--  costo, monedas, facturación electrónica y reportes.
--
--  Corre DESPUÉS de demo.sql (supabase/scripts/seed.mjs aplica demo.sql y
--  luego cada demo-*.sql en orden). Todo es idempotente: cada bloque mira
--  si ya existe lo suyo antes de insertar, así que se puede correr las
--  veces que haga falta sobre la misma base.
--
--  Solo la distribuidora: el colmado no tiene encendido ningún módulo de
--  finanzas, y sus pantallas le salen como "módulo no activo".
--
--  Las fechas son relativas a hoy -como en demo.sql- para que la demo no
--  envejezca: "el mes pasado" es siempre el que se está declarando.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Contabilidad: el borrador de la demo, con sus líneas ──────────────
--  AS-DEMO-0002 existía para enseñar "hay un borrador pendiente", pero
--  sin líneas: la ficha decía "Diferencia RD$ 0.00 · cuadra" de un asiento
--  vacío, y el botón Contabilizar no podía hacer nada. Ahora trae la compra
--  de verdad -sin contabilizar-, lista para que el contador la revise y
--  la contabilice en vivo.
do $$
declare
  v_med     uuid;
  v_asiento uuid;
  v_gastos  uuid;
  v_caja    uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_asiento from public.journal_entries
    where tenant_id = v_med and number = 'AS-DEMO-0002' and status = 'draft';
  if v_asiento is null then return; end if;
  if exists (select 1 from public.journal_entry_lines where entry_id = v_asiento) then return; end if;

  select id into v_gastos from public.accounts where tenant_id = v_med and code = '6101';
  select id into v_caja   from public.accounts where tenant_id = v_med and code = '1101';
  if v_gastos is null or v_caja is null then return; end if;

  insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit, memo) values
    (v_asiento, v_med, v_gastos, 3450.00, 0, 'Resmas de papel, tóner y folders'),
    (v_asiento, v_med, v_caja, 0, 3450.00, 'Pagado de caja chica');
end $$;

-- ─── Por pagar: compras de agosto de un segundo proveedor ──────────────
--  Todas las facturas de la demo eran de un solo proveedor y de este mes:
--  el 606 y el IT-1 del mes que se está declarando salían en cero, y
--  "Vencido" nunca tenía nada. Dos compras de mercancía a Ferretería
--  Central Import con NCF: una pagada completa por transferencia y otra
--  vencida, sin pagar.
--
--  El asiento de cada una lo genera la contabilidad automática, igual que
--  cuando se registra desde la pantalla: aquí solo se emite el mismo
--  evento que emite la acción (`ap.invoice.recorded`), y el pago emite
--  el suyo por trigger.
do $$
declare
  v_med     uuid;
  v_prov    uuid;
  v_factura uuid;
  v_mes     date := (date_trunc('month', current_date) - interval '1 month')::date;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  -- Por nombre con o sin tilde: demo.sql lo sembró sin ella.
  select id into v_prov from public.suppliers
    where tenant_id = v_med and name ilike 'Ferreter_a Central Import%'
    order by created_at limit 1;
  if v_prov is null then return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'app_metadata',
      json_build_object('tenant_id', v_med, 'is_provider', false))::text, true);

  if not exists (select 1 from public.supplier_invoices
                 where tenant_id = v_med and supplier_id = v_prov
                   and supplier_invoice_number = 'FCI-3301') then
    insert into public.supplier_invoices
      (tenant_id, supplier_id, supplier_invoice_number, supplier_ncf, issue_date, due_date,
       subtotal, tax, expense_type, total, notes)
    values (v_med, v_prov, 'FCI-3301', 'B0100012031', v_mes + 5, v_mes + 35,
            42000.00, 7560.00, '09', 49560.00,
            'Varilla, alambre y clavos para reponer inventario')
    returning id into v_factura;

    perform public.emit_event('ap.invoice.recorded',
      json_build_object('supplierId', v_prov, 'supplierInvoiceNumber', 'FCI-3301',
                        'total', 49560.00)::jsonb, 'ap');

    insert into public.supplier_payments (tenant_id, invoice_id, amount, method, reference, paid_at)
    values (v_med, v_factura, 49560.00, 'transfer', 'TRF-FCI-3301',
            (v_mes + 20)::timestamp + interval '10 hours');

    update public.supplier_invoices set status = 'paid' where id = v_factura;
  end if;

  if not exists (select 1 from public.supplier_invoices
                 where tenant_id = v_med and supplier_id = v_prov
                   and supplier_invoice_number = 'FCI-3342') then
    insert into public.supplier_invoices
      (tenant_id, supplier_id, supplier_invoice_number, supplier_ncf, issue_date, due_date,
       subtotal, tax, expense_type, total, status, notes)
    values (v_med, v_prov, 'FCI-3342', 'B0100012088', v_mes + 12, current_date - 18,
            18500.00, 3330.00, '09', 21830.00, 'overdue',
            'Tubería PVC y conexiones')
    returning id into v_factura;

    perform public.emit_event('ap.invoice.recorded',
      json_build_object('supplierId', v_prov, 'supplierInvoiceNumber', 'FCI-3342',
                        'total', 21830.00)::jsonb, 'ap');
  end if;
end $$;

-- ─── Tesorería: la salida del banco por el pago de FCI-3301 ────────────
--  Tesorería no se entera sola de los pagos de Por pagar: el pago por
--  transferencia se anota también aquí, que es lo que haría la persona
--  que lleva el banco. Así el estado de cuenta de agosto tiene algo que
--  conciliar.
do $$
declare
  v_med       uuid;
  v_operativa uuid;
  v_mes       date := (date_trunc('month', current_date) - interval '1 month')::date;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_operativa from public.bank_accounts
    where tenant_id = v_med and bank_name = 'Banco Popular' and account_number = '790-12345-6';
  if v_operativa is null then return; end if;

  insert into public.bank_transactions
    (tenant_id, bank_account_id, type, amount, description, reference, transaction_date)
  select v_med, v_operativa, x.tipo, x.monto, x.concepto, x.ref, x.fecha
  from (values
    ('deposit', 65400.00, 'Depósito de cobros de la primera quincena', 'DEP-8702', v_mes + 16),
    ('withdrawal', 49560.00, 'Pago a Ferretería Central Import, factura FCI-3301', 'TRF-FCI-3301', v_mes + 20),
    ('withdrawal', 3850.00, 'Pago de energía eléctrica (Edesur) de agosto', 'EDESUR-0826', v_mes + 24)
  ) as x(tipo, monto, concepto, ref, fecha)
  where not exists (
    select 1 from public.bank_transactions t
    where t.tenant_id = v_med and t.bank_account_id = v_operativa and t.reference = x.ref
  );
end $$;

-- ─── Conciliación: el estado de agosto de la cuenta operativa ──────────
--  El único estado importado era el de este mes, con dos líneas
--  pendientes. Un estado de agosto ya conciliado del todo enseña el otro
--  final feliz ("al día") y deja ver cómo queda una conciliación hecha.
do $$
declare
  v_med       uuid;
  v_operativa uuid;
  v_import    uuid;
  v_mes       date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_dep       uuid;
  v_fci       uuid;
  v_edesur    uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_operativa from public.bank_accounts
    where tenant_id = v_med and bank_name = 'Banco Popular' and account_number = '790-12345-6';
  if v_operativa is null then return; end if;

  if exists (select 1 from public.bank_statement_imports
             where tenant_id = v_med and bank_account_id = v_operativa
               and period_start = v_mes) then
    return;
  end if;

  select id into v_dep from public.bank_transactions
    where tenant_id = v_med and bank_account_id = v_operativa and reference = 'DEP-8702';
  select id into v_fci from public.bank_transactions
    where tenant_id = v_med and bank_account_id = v_operativa and reference = 'TRF-FCI-3301';
  select id into v_edesur from public.bank_transactions
    where tenant_id = v_med and bank_account_id = v_operativa and reference = 'EDESUR-0826';
  if v_dep is null or v_fci is null or v_edesur is null then return; end if;

  -- 185,000 de apertura + 65,400 - 49,560 - 3,850 = 196,990 al cierre de agosto.
  insert into public.bank_statement_imports
    (tenant_id, bank_account_id, period_start, period_end, statement_balance, created_at)
  values (v_med, v_operativa, v_mes, (v_mes + interval '1 month' - interval '1 day')::date,
          196990.00, (v_mes + interval '1 month' + interval '2 days'))
  returning id into v_import;

  -- El estado de este mes (demo.sql) partía de 185,000 porque no había
  -- nada antes. Con agosto dentro, su saldo final sube lo mismo que subió
  -- agosto (+11,990): 124,450 pasa a 136,440 y sigue difiriendo de
  -- tesorería justo en la comisión de 150 que nadie registró.
  update public.bank_statement_imports
  set statement_balance = statement_balance + 11990.00
  where tenant_id = v_med and bank_account_id = v_operativa
    and period_start > v_mes and statement_balance = 124450.00;

  insert into public.bank_statement_lines
    (tenant_id, import_id, bank_account_id, line_date, description, amount,
     match_status, matched_transaction_id)
  values
    (v_med, v_import, v_operativa, v_mes + 16, 'DEPOSITO EN EFECTIVO SUC PRINCIPAL', 65400.00,
     'matched', v_dep),
    (v_med, v_import, v_operativa, v_mes + 20, 'TRANSF LBTR FERRETERIA CENTRAL IMPORT', -49560.00,
     'matched', v_fci),
    (v_med, v_import, v_operativa, v_mes + 24, 'PAGO SERVICIO EDESUR NIC 5512033', -3850.00,
     'matched', v_edesur);
end $$;

-- ─── Activos fijos: historial completo y los activos que faltaban ──────
--  La camioneta se compró hace 10 meses pero solo tenía 3 meses
--  depreciados: la ficha decía "3 / 60 meses" de un vehículo con casi un
--  año de uso. Se completan los cierres de mes que faltaban -con la misma
--  función que usa la corrida de la app- y se suman los activos que una
--  distribuidora tiene de verdad: el montacargas, las estanterías del
--  almacén y las computadoras de oficina.
do $$
declare
  v_med     uuid;
  v_activo  uuid;
  v_periodo date;
  r         record;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  insert into public.fixed_assets
    (tenant_id, code, name, category, acquisition_date, acquisition_cost,
     salvage_value, useful_life_months, depreciation_method, notes)
  select v_med, x.code, x.name, x.category, x.fecha, x.costo, x.rescate, x.vida, 'straight_line', x.nota
  from (values
    ('EQ-003', 'Montacargas Toyota 2.5 t', 'equipment',
     (current_date - interval '14 months')::date, 1250000.00, 150000.00, 96,
     'Serie 8FGU25-44821. Mantenimiento cada 250 horas.'),
    ('MOB-001', 'Estanterías metálicas del almacén', 'furniture',
     (current_date - interval '20 months')::date, 380000.00, 0.00, 120,
     'Racks de carga pesada, 6 módulos de 3 niveles.'),
    ('EQ-004', 'Computadoras de oficina (5)', 'equipment',
     (current_date - interval '6 months')::date, 185000.00, 10000.00, 36,
     'Facturación, contabilidad, almacén y gerencia.')
  ) as x(code, name, category, fecha, costo, rescate, vida, nota)
  on conflict (tenant_id, code) do nothing;

  -- Cierre de cada mes desde la compra hasta el mes pasado, en orden: la
  -- función calcula sobre la base y lo ya depreciado.
  for r in
    select id, acquisition_date from public.fixed_assets
    where tenant_id = v_med and status = 'active' and code in ('VEH-001', 'EQ-003', 'MOB-001', 'EQ-004')
  loop
    v_periodo := (date_trunc('month', r.acquisition_date) + interval '1 month' - interval '1 day')::date;
    while v_periodo < date_trunc('month', current_date)::date loop
      if not exists (select 1 from public.fixed_asset_depreciations
                     where tenant_id = v_med and asset_id = r.id and period_date = v_periodo) then
        insert into public.fixed_asset_depreciations (tenant_id, asset_id, period_date, amount)
        values (v_med, r.id, v_periodo, public.fixed_asset_monthly_depreciation(r.id));
      end if;
      v_periodo := (date_trunc('month', v_periodo) + interval '2 months' - interval '1 day')::date;
    end loop;
  end loop;
end $$;

-- ─── Presupuestos: el plan del segundo semestre ────────────────────────
--  El presupuesto tenía tres líneas. Un presupuesto de verdad planea las
--  ventas y los gastos de cada mes: se completa julio-diciembre de ventas,
--  gastos generales y costo de ventas, sin tocar lo que ya estaba.
do $$
declare
  v_med         uuid;
  v_presupuesto uuid;
  v_ventas      uuid;
  v_costo       uuid;
  v_gastos      uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_presupuesto from public.budgets
    where tenant_id = v_med and name = 'Presupuesto anual'
    order by fiscal_year desc limit 1;
  select id into v_ventas from public.accounts where tenant_id = v_med and code = '4101';
  select id into v_costo  from public.accounts where tenant_id = v_med and code = '5101';
  select id into v_gastos from public.accounts where tenant_id = v_med and code = '6101';
  if v_presupuesto is null or v_ventas is null or v_costo is null or v_gastos is null then return; end if;

  insert into public.budget_lines (tenant_id, budget_id, account_id, period_month, amount)
  select v_med, v_presupuesto, x.cuenta, x.mes, x.monto
  from (values
    (v_ventas, 7, 38000.00), (v_ventas, 8, 25000.00), (v_ventas, 11, 20000.00),
    (v_ventas, 12, 32000.00),
    (v_costo, 7, 24000.00), (v_costo, 8, 16000.00), (v_costo, 10, 9500.00),
    (v_costo, 11, 12500.00), (v_costo, 12, 20000.00),
    (v_gastos, 7, 9000.00), (v_gastos, 8, 9000.00), (v_gastos, 9, 9000.00),
    (v_gastos, 10, 9000.00), (v_gastos, 11, 9000.00), (v_gastos, 12, 12000.00)
  ) as x(cuenta, mes, monto)
  on conflict (tenant_id, budget_id, account_id, period_month) do nothing;
end $$;

-- ─── Impuestos: tasas, reglas de retención y perfiles ──────────────────
--  La distribuidora tenía el módulo encendido y las tres pantallas en
--  cero: sin tasas, sin reglas y ningún proveedor con perfil fiscal. Se
--  siembran las tres tasas de ITBIS -las mismas de "Sembrar 18%, 16% y
--  exento"-, las cuatro retenciones que una empresa usa de verdad (Norma
--  07-2007 y el art. 309 del Código Tributario) y el perfil de los dos
--  proveedores, que son sociedades (SRL).
do $$
declare
  v_med uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  if not exists (select 1 from public.tax_rates where tenant_id = v_med) then
    insert into public.tax_rates (tenant_id, code, name, kind, rate, is_default, effective_from) values
      (v_med, 'ITBIS-18', 'ITBIS general 18%', 'itbis', 0.18, true, date_trunc('year', current_date)::date),
      (v_med, 'ITBIS-16', 'ITBIS reducido 16%', 'itbis', 0.16, false, date_trunc('year', current_date)::date),
      (v_med, 'EXENTO', 'Exento 0%', 'itbis', 0, false, date_trunc('year', current_date)::date)
    on conflict (tenant_id, code) do nothing;
  end if;

  insert into public.tax_withholding_rules
    (tenant_id, code, name, tax, party_type, base, rate, dgii_isr_type, effective_from)
  values
    (v_med, 'RET-ITBIS-PJ', 'ITBIS a sociedades por servicios 30%', 'itbis', 'juridica', 'itbis', 0.30, null,
     date_trunc('year', current_date)::date),
    (v_med, 'RET-ITBIS-PF', 'ITBIS a personas físicas por servicios 100%', 'itbis', 'fisica', 'itbis', 1.00, null,
     date_trunc('year', current_date)::date),
    (v_med, 'ISR-HON', 'ISR honorarios a personas físicas 10%', 'isr', 'fisica', 'subtotal', 0.10, '02',
     date_trunc('year', current_date)::date),
    (v_med, 'ISR-ALQ', 'ISR alquileres a personas físicas 10%', 'isr', 'fisica', 'subtotal', 0.10, '01',
     date_trunc('year', current_date)::date)
  on conflict (tenant_id, code) do nothing;

  insert into public.supplier_tax_profiles (tenant_id, supplier_id, party_type, itbis_rule_id, notes)
  select v_med, s.id, 'juridica',
         case when s.name ilike 'Materiales Del Este%'
              then (select id from public.tax_withholding_rules
                    where tenant_id = v_med and code = 'RET-ITBIS-PJ') end,
         case when s.name ilike 'Materiales Del Este%'
              then 'También nos factura servicios de instalación: a esos se les retiene el 30% del ITBIS.'
              else 'Solo nos vende mercancía: no lleva retención.' end
  from public.suppliers s
  where s.tenant_id = v_med
    and (s.name ilike 'Materiales Del Este%' or s.name ilike 'Ferreter_a Central Import%')
  on conflict (tenant_id, supplier_id) do nothing;
end $$;

-- ─── Calendario fiscal: lo del mes pasado ya presentado ────────────────
--  Una empresa que lleva sus impuestos al día ya subió los informativos
--  del mes pasado. Queda pendiente solo el IT-1, que se cierra en su
--  pantalla de liquidación: es el siguiente paso de la demo.
do $$
declare
  v_med     uuid;
  v_periodo text := to_char(current_date - interval '1 month', 'YYYYMM');
  v_mes     date := date_trunc('month', current_date)::date;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  insert into public.tax_filings (tenant_id, form, period, due_date, status, filed_at, notes)
  select v_med, x.form, v_periodo, x.vence, 'filed', (x.vence - 2)::timestamp + interval '15 hours',
         'Subido por la Oficina Virtual de la DGII.'
  from (
    select form,
           -- El vencimiento corre al lunes si cae sábado o domingo, igual
           -- que calendarioFiscal().
           case extract(isodow from (v_mes + (dia - 1)))
             when 6 then v_mes + (dia - 1) + 2
             when 7 then v_mes + (dia - 1) + 1
             else v_mes + (dia - 1)
           end as vence
    from (values ('IR-17', 10), ('606', 15), ('607', 15), ('608', 15)) as f(form, dia)
  ) x
  where x.vence <= current_date
  on conflict (tenant_id, form, period) do nothing;
end $$;

-- ─── Consolidación: el grupo de la distribuidora y su transportadora ───
--  La consolidación necesita al menos dos empresas, y la demo tenía una.
--  Se agrega Transportes Caribe SRL -la flota que le lleva la mercancía a
--  la distribuidora- con sus propios asientos: apertura, un préstamo de
--  la matriz, los fletes que cobra a terceros y su combustible. El
--  préstamo es la operación entre empresas que la corrida elimina.
--
--  Sus ingresos y gastos van a cuentas propias (4102, 6102) para no
--  mezclarse con las ventas de la distribuidora en su presupuesto.
do $$
declare
  v_med        uuid;
  v_matriz     uuid;
  v_tc         uuid;
  v_grupo      uuid;
  v_corrida    uuid;
  v_asiento    uuid;
  v_caja       uuid;
  v_bancos     uuid;
  v_capital    uuid;
  v_prestamo_a uuid;
  v_prestamo_p uuid;
  v_fletes     uuid;
  v_combust    uuid;
  v_mes        date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_fin        date := (date_trunc('month', current_date) - interval '1 day')::date;
  r            record;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id into v_matriz from public.companies
    where tenant_id = v_med and is_default and deleted_at is null;
  if v_matriz is null then return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'app_metadata',
      json_build_object('tenant_id', v_med, 'is_provider', false))::text, true);

  select id into v_tc from public.companies
    where tenant_id = v_med and tax_id = '131784526' and deleted_at is null;
  if v_tc is null then
    insert into public.companies
      (tenant_id, legal_name, trade_name, tax_id, currency, address, phone, email)
    values (v_med, 'Transportes Caribe SRL', 'Transportes Caribe', '131784526', 'DOP',
            'Av. Máximo Gómez 88, Villa Juana, Santo Domingo', '809-555-0186',
            'operaciones@transportescaribe.do')
    returning id into v_tc;
  end if;

  insert into public.accounts (tenant_id, code, name, type) values
    (v_med, '1106', 'Préstamo a Transportes Caribe', 'asset'),
    (v_med, '2105', 'Préstamo de Distribuidora Caribe', 'liability'),
    (v_med, '4102', 'Ingresos por fletes', 'revenue'),
    (v_med, '6102', 'Combustible y mantenimiento de flota', 'expense')
  on conflict (tenant_id, code) do nothing;

  select id into v_caja       from public.accounts where tenant_id = v_med and code = '1101';
  select id into v_bancos     from public.accounts where tenant_id = v_med and code = '1103';
  select id into v_capital    from public.accounts where tenant_id = v_med and code = '3101';
  select id into v_prestamo_a from public.accounts where tenant_id = v_med and code = '1106';
  select id into v_prestamo_p from public.accounts where tenant_id = v_med and code = '2105';
  select id into v_fletes     from public.accounts where tenant_id = v_med and code = '4102';
  select id into v_combust    from public.accounts where tenant_id = v_med and code = '6102';
  if v_caja is null or v_bancos is null or v_capital is null then return; end if;

  -- Los asientos: (número, empresa, fecha, descripción, [cuenta, débito, crédito]...)
  for r in
    select * from (values
      ('AS-TC-0001', v_tc, v_mes - 90, 'Transportes Caribe · asiento de apertura',
       v_bancos, 80000.00, v_capital),
      ('AS-DEMO-0003', v_matriz, v_mes + 1, 'Préstamo a Transportes Caribe para gomas nuevas',
       v_prestamo_a, 50000.00, v_bancos),
      ('AS-TC-0002', v_tc, v_mes + 1, 'Transportes Caribe · préstamo recibido de Distribuidora Caribe',
       v_bancos, 50000.00, v_prestamo_p),
      ('AS-TC-0003', v_tc, v_mes + 15, 'Transportes Caribe · fletes cobrados en agosto',
       v_caja, 36000.00, v_fletes),
      ('AS-TC-0004', v_tc, v_mes + 20, 'Transportes Caribe · combustible y gomas',
       v_combust, 12400.00, v_caja)
    ) as x(numero, empresa, fecha, descripcion, debe, monto, haber)
  loop
    if not exists (select 1 from public.journal_entries
                   where tenant_id = v_med and number = r.numero) then
      insert into public.journal_entries (tenant_id, number, entry_date, description, company_id)
      values (v_med, r.numero, r.fecha, r.descripcion, r.empresa)
      returning id into v_asiento;
      insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit) values
        (v_asiento, v_med, r.debe, r.monto, 0),
        (v_asiento, v_med, r.haber, 0, r.monto);
      perform public.post_journal_entry(v_asiento);
    end if;
  end loop;

  -- El grupo, con la distribuidora como matriz.
  insert into public.consolidation_groups (tenant_id, name, presentation_currency)
  values (v_med, 'Grupo Caribe', 'DOP')
  on conflict (tenant_id, name) do nothing;
  select id into v_grupo from public.consolidation_groups where tenant_id = v_med and name = 'Grupo Caribe';

  insert into public.consolidation_group_members (tenant_id, group_id, company_id, is_parent) values
    (v_med, v_grupo, v_matriz, true),
    (v_med, v_grupo, v_tc, false)
  on conflict (tenant_id, group_id, company_id) do nothing;

  -- La corrida del mes pasado, en borrador: la foto se congela con la
  -- misma función que usa "Generar corrida", y queda capturada la
  -- eliminación del préstamo. Cerrarla es el siguiente paso de la demo.
  select id into v_corrida from public.consolidation_runs
    where tenant_id = v_med and group_id = v_grupo and period_start = v_mes and period_end = v_fin;
  if v_corrida is null then
    insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
    values (v_med, v_grupo, v_mes, v_fin)
    returning id into v_corrida;
    perform public.consolidation_freeze(v_corrida);

    insert into public.consolidation_eliminations
      (tenant_id, run_id, from_company_id, to_company_id, debit_account_id, credit_account_id,
       amount, kind, description)
    values (v_med, v_corrida, v_matriz, v_tc, v_prestamo_p, v_prestamo_a, 50000.00,
            'receivable_payable', 'Préstamo de la matriz a Transportes Caribe');
  end if;
end $$;

-- ─── Centros de costo: agosto y el área administrativa ─────────────────
do $$
declare
  v_med uuid;
  v_sd  uuid;
  v_sti uuid;
  v_adm uuid;
  v_mes date := (date_trunc('month', current_date) - interval '1 month')::date;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  insert into public.cost_centers (tenant_id, code, name)
  values (v_med, 'ADM', 'Administración y finanzas')
  on conflict do nothing;

  select id into v_sd  from public.cost_centers where tenant_id = v_med and code = 'SD';
  select id into v_sti from public.cost_centers where tenant_id = v_med and code = 'STI';
  select id into v_adm from public.cost_centers where tenant_id = v_med and code = 'ADM';
  if v_sd is null or v_sti is null or v_adm is null then return; end if;

  insert into public.cost_center_allocations (tenant_id, cost_center_id, amount, description, allocation_date)
  select v_med, x.centro, x.monto, x.concepto, x.fecha
  from (values
    (v_sd, 30000.00, 'Alquiler y servicios de agosto', v_mes + 4),
    (v_sti, 15000.00, 'Alquiler y servicios de agosto', v_mes + 4),
    (v_sd, 2566.67, 'Energía eléctrica (Edesur) de agosto', v_mes + 24),
    (v_sti, 1283.33, 'Energía eléctrica (Edesur) de agosto', v_mes + 24),
    (v_adm, 4200.00, 'Honorarios de la firma de auditoría', v_mes + 27),
    (v_adm, 3450.00, 'Suministros de oficina', current_date - 6)
  ) as x(centro, monto, concepto, fecha)
  where not exists (
    select 1 from public.cost_center_allocations a
    where a.tenant_id = v_med and a.cost_center_id = x.centro
      and a.description = x.concepto and a.allocation_date = x.fecha
  );
end $$;

-- ─── Monedas: el euro y la tasa del dólar de esta semana ───────────────
--  El euro salía "sin tasa" y el dólar llevaba más de una semana sin
--  capturarse. Tasas de referencia del mercado dominicano, capturadas a
--  mano como funciona el módulo.
do $$
declare
  v_med uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  insert into public.exchange_rates (tenant_id, currency_code, rate_date, rate)
  values
    (v_med, 'USD', current_date - 1, 59.05),
    (v_med, 'EUR', current_date - 30, 67.95),
    (v_med, 'EUR', current_date - 15, 68.40),
    (v_med, 'EUR', current_date - 1, 68.55)
  on conflict (tenant_id, currency_code, rate_date) do nothing;
end $$;

-- ─── Reportes: nombres en español y el panel con algo que mirar ────────
do $$
declare
  v_med       uuid;
  v_rep       uuid;
  v_dashboard uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  update public.report_definitions set name = 'Prospectos por estado'
  where tenant_id = v_med and name = 'Leads por estado';

  if not exists (select 1 from public.report_definitions
                 where tenant_id = v_med and name = 'Tickets de soporte por prioridad') then
    insert into public.report_definitions (tenant_id, name, source_key, chart_type)
    values (v_med, 'Tickets de soporte por prioridad', 'tickets_by_priority', 'bar')
    returning id into v_rep;

    select id into v_dashboard from public.dashboards
      where tenant_id = v_med and name = 'Panel gerencial';
    if v_dashboard is not null then
      insert into public.dashboard_items (tenant_id, dashboard_id, report_id, position)
      values (v_med, v_dashboard, v_rep, 2);
    end if;
  end if;
end $$;

-- ─── Facturación electrónica: configurada, en precertificación ─────────
--  Una empresa mediana ya está en camino al e-CF: la demo enseña la
--  pantalla configurada -las tres URL para la postulación, el ambiente de
--  pruebas y la contingencia- en vez de un botón solo. El token lo genera
--  la base, igual que el botón Configurar.
do $$
declare
  v_med uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  insert into public.ecf_config (tenant_id) values (v_med)
  on conflict (tenant_id) do nothing;
end $$;

-- ─── Catálogo de cuentas: los nombres por defecto, con su tilde ────────
--  La distribuidora nació con el catálogo mínimo de 0131, sin tildes. Desde
--  0160 una cuenta nueva ya sale bien; estas se corrigen aquí porque el
--  nombre de una cuenta es dato del cliente, no de la migración.
update public.accounts a
set name = replace(a.name, 'mercancias', 'mercancías')
from regb.tenants t
where t.id = a.tenant_id and t.slug in ('distribuidora-caribe', 'colmado-esperanza')
  and a.name like '%mercancias%';

-- ─── Tesorería: el nombre de la cuenta de nómina, con tilde ────────────
--  El nombre de la cuenta se puede cambiar (los movimientos no: son fijos,
--  y sus conceptos se quedan como se escribieron).
update public.bank_accounts b
set account_name = 'Reserva de nómina'
from regb.tenants t
where t.id = b.tenant_id and t.slug = 'distribuidora-caribe'
  and b.account_name = 'Reserva de nómina';
