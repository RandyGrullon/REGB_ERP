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
        '131-45678-9', 'mediano', 'active', now() - interval '6 months', now() - interval '5 months', 94)
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

  insert into public.companies (tenant_id, legal_name, tax_id, currency, is_default)
  values (v_pyme, 'Colmado La Esperanza SRL', '130-11111-1', 'DOP', true)
  on conflict do nothing
  returning id into v_c1;
  if v_c1 is null then
    select id into v_c1 from public.companies where tenant_id = v_pyme limit 1;
  end if;

  insert into public.companies (tenant_id, legal_name, tax_id, currency, is_default)
  values (v_med, 'Distribuidora Caribe SRL', '131-45678-9', 'DOP', true)
  on conflict do nothing
  returning id into v_c2;
  if v_c2 is null then
    select id into v_c2 from public.companies where tenant_id = v_med limit 1;
  end if;

  insert into public.branches (tenant_id, company_id, name, code)
  values (v_pyme, v_c1, 'Villa Consuelo', 'VC')
  on conflict do nothing;

  insert into public.branches (tenant_id, company_id, name, code)
  values (v_med, v_c2, 'Santo Domingo', 'SD'), (v_med, v_c2, 'Santiago', 'STI')
  on conflict do nothing;

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
         (v_med, 'invoice-capture', 'active', true)
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
