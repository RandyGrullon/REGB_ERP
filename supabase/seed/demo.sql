-- ═══════════════════════════════════════════════════════════════════════
--  Datos de demostracion
--
--  Dos clientes reales de República Dominicana con perfiles distintos, para
--  ver el registry resolver cosas diferentes segun quien mira.
--
--  Idempotente: se puede correr las veces que haga falta.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Catalogo de modulos ────────────────────────────────────────────────
insert into nexus.module_catalog (id, name, category, description, icon, version, requires, recommends, platforms, is_published)
values
  ('products', 'Productos', 'core',
   'Catalogo con variantes, unidades, atributos, imagenes y kits.', 'Box', '0.1.0',
   '{}', '{}', '{"web":true,"desktop":true,"mobile":true}', true),

  ('inventory', 'Inventario', 'standard',
   'Existencias multi-almacen, kardex, costo promedio y valorizacion.', 'Package', '0.1.0',
   '{products}', '{purchase-orders}', '{"web":true,"desktop":true,"mobile":true}', true),

  ('pos', 'Punto de venta', 'standard',
   'Tactil, offline, cajas, turnos, arqueo e impresora termica.', 'CreditCard', '0.1.0',
   '{products}', '{inventory}', '{"web":true,"desktop":true,"mobile":true}', true),

  ('payroll', 'Nomina', 'advanced',
   'Calculo con TSS, AFP, ARS e ISR; prestaciones, regalia y volantes.', 'Users', '0.1.0',
   '{}', '{accounting}', '{"web":true,"desktop":true,"mobile":false}', true)
on conflict (id) do update
  set name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      requires = excluded.requires,
      recommends = excluded.recommends,
      platforms = excluded.platforms,
      is_published = excluded.is_published;

-- ── Precios por tier (§6.3) ────────────────────────────────────────────
insert into nexus.module_pricing (module_id, tier, install_price, monthly_price, per_user)
values
  ('products',  'pyme',    0,    0, 0),
  ('products',  'mediano', 0,    0, 0),
  ('products',  'grande',  0,    0, 0),
  ('inventory', 'pyme',    150,  19, 0),
  ('inventory', 'mediano', 600,  69, 0),
  ('inventory', 'grande',  1800, 190, 0),
  ('pos',       'pyme',    150,  19, 0),
  ('pos',       'mediano', 600,  69, 0),
  ('pos',       'grande',  1800, 190, 0),
  ('payroll',   'pyme',    400,  45, 0),
  ('payroll',   'mediano', 1500, 160, 2),
  ('payroll',   'grande',  4000, 420, 2)
on conflict (module_id, tier) do update
  set install_price = excluded.install_price,
      monthly_price = excluded.monthly_price,
      per_user = excluded.per_user;

-- ── Cliente 1: PYME ────────────────────────────────────────────────────
insert into nexus.tenants (slug, legal_name, trade_name, tax_id, tier, status, installed_at, go_live_at, health_score)
values ('colmado-esperanza', 'Colmado La Esperanza SRL', 'La Esperanza',
        '130-11111-1', 'pyme', 'active', now() - interval '4 months', now() - interval '3 months', 88)
on conflict (slug) do nothing;

-- ── Cliente 2: MEDIANO ─────────────────────────────────────────────────
insert into nexus.tenants (slug, legal_name, trade_name, tax_id, tier, status, installed_at, go_live_at, health_score)
values ('distribuidora-caribe', 'Distribuidora Caribe SRL', 'Caribe',
        '131-45678-9', 'mediano', 'active', now() - interval '6 months', now() - interval '5 months', 94)
on conflict (slug) do nothing;

-- ── Empresas y sucursales ──────────────────────────────────────────────
do $$
declare
  v_pyme uuid;
  v_med  uuid;
  v_c1   uuid;
  v_c2   uuid;
begin
  select id into v_pyme from nexus.tenants where slug = 'colmado-esperanza';
  select id into v_med  from nexus.tenants where slug = 'distribuidora-caribe';

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

  -- ── Modulos del colmado: lo minimo para dejar Excel ──────────────────
  insert into nexus.tenant_modules (tenant_id, module_id, status, enabled)
  values (v_pyme, 'products', 'active', true),
         (v_pyme, 'pos', 'active', true)
  on conflict do nothing;

  -- Inventario en prueba: vence en 9 dias.
  insert into nexus.tenant_modules (tenant_id, module_id, status, enabled, trial_ends_at)
  values (v_pyme, 'inventory', 'trial', true, (current_date + 9))
  on conflict do nothing;

  -- ── Modulos de la distribuidora ──────────────────────────────────────
  insert into nexus.tenant_modules (tenant_id, module_id, status, enabled)
  values (v_med, 'products', 'active', true),
         (v_med, 'inventory', 'active', true),
         (v_med, 'pos', 'active', true),
         (v_med, 'payroll', 'active', true)
  on conflict do nothing;

  -- ── Suscripciones ────────────────────────────────────────────────────
  insert into nexus.subscriptions
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
