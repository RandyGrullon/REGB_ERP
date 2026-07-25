-- ═══════════════════════════════════════════════════════════════════════
--  0006 — Roles predefinidos
--
--  Los 14 roles de §8.2. Se crean automaticamente al dar de alta un tenant,
--  para que nadie arranque con una pantalla de permisos en blanco.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function regb.provision_system_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.roles (tenant_id, name, description, is_system, visible_modules, permissions, scope)
  values
    (p_tenant, 'Owner', 'Dueno del negocio. Acceso total, incluida la suscripcion.',
     true, array['*'], '{"*": true}'::jsonb, '{}'::jsonb),

    (p_tenant, 'Admin', 'Administra todo menos la facturacion de REGB.',
     true, array['*'],
     '{"*": true, "subscription.manage": false, "tenant.delete": false}'::jsonb, '{}'::jsonb),

    (p_tenant, 'Gerente General', 'Ve todas las sucursales, aprueba y consulta margenes.',
     true, array['dashboard','bi','accounting','ar','ap','inventory','sales-orders',
                 'purchase-orders','crm','employees','projects'],
     '{"*.view": true, "*.approve": true, "*.cost.view": true,
       "settings.manage": false, "api-webhooks.manage": false}'::jsonb, '{}'::jsonb),

    (p_tenant, 'Gerente de Sucursal', 'Opera y aprueba dentro de su sucursal.',
     true, array['dashboard','inventory','sales-orders','pos','ar','attendance','transfers'],
     '{"*.view": true, "*.create": true, "*.edit": true, "*.approve": true}'::jsonb,
     '{"own_branches_only": true, "max_amount": 50000}'::jsonb),

    (p_tenant, 'Contador', 'Contabilidad, impuestos y conciliacion.',
     true, array['dashboard','accounting','ar','ap','treasury','bank-rec','taxes',
                 'e-invoice','fixed-assets','budgets','cost-centers','bi'],
     '{"accounting.*": true, "taxes.*": true, "ar.*": true, "ap.*": true,
       "treasury.*": true, "bank-rec.*": true, "payroll.view": false}'::jsonb, '{}'::jsonb),

    (p_tenant, 'Vendedor', 'Cotiza y vende. No ve costos ni margenes.',
     true, array['dashboard','crm','quotes','sales-orders','pos','customer-portal'],
     '{"crm.*": true, "quotes.create": true, "quotes.edit": true, "quotes.approve": false,
       "sales-orders.create": true, "inventory.view": true,
       "inventory.cost.view": false, "commissions.view.own": true}'::jsonb,
     '{"own_only": true, "max_amount": 50000}'::jsonb),

    (p_tenant, 'Cajero', 'Solo el punto de venta y su turno.',
     true, array['pos'],
     '{"pos.sell": true, "pos.shift.open": true, "pos.shift.close": true,
       "pos.discount.max": 10, "pos.void": false}'::jsonb,
     '{"own_register_only": true}'::jsonb),

    (p_tenant, 'Almacenista', 'Recibe, transfiere y cuenta. No ve precios de venta.',
     true, array['dashboard','inventory','receipts','transfers','stock-counts','barcode','lots-serials'],
     '{"inventory.view": true, "inventory.adjust": true, "inventory.transfer": true,
       "inventory.count": true, "inventory.cost.view": false, "products.price.view": false}'::jsonb,
     '{"own_warehouses_only": true}'::jsonb),

    (p_tenant, 'Comprador', 'Requisiciones, RFQ, ordenes de compra y proveedores.',
     true, array['dashboard','suppliers','requisitions','rfq','purchase-orders','receipts','inventory'],
     '{"purchase-orders.*": true, "suppliers.*": true, "rfq.*": true,
       "inventory.view": true, "purchase-orders.approve": false}'::jsonb, '{}'::jsonb),

    (p_tenant, 'RRHH', 'Empleados, nomina, asistencia y contratacion.',
     true, array['dashboard','employees','payroll','attendance','time-off','recruiting',
                 'performance','training','benefits','expenses'],
     '{"employees.*": true, "payroll.*": true, "attendance.*": true,
       "accounting.view": false, "inventory.view": false}'::jsonb, '{}'::jsonb),

    (p_tenant, 'Empleado', 'Autoservicio: su volante, sus vacaciones, sus gastos.',
     true, array['hr-portal','expenses','time-off','training'],
     '{"hr-portal.view.own": true, "time-off.request": true,
       "expenses.create": true, "payroll.view.own": true}'::jsonb,
     '{"own_only": true}'::jsonb),

    (p_tenant, 'Tecnico de Campo', 'Ejecuta ordenes de servicio y consume repuestos.',
     true, array['field-service','inventory','attendance','expenses'],
     '{"field-service.execute": true, "field-service.view.assigned": true,
       "inventory.consume": true, "inventory.cost.view": false}'::jsonb,
     '{"own_only": true}'::jsonb),

    (p_tenant, 'Auditor', 'Lee todo. No modifica nada.',
     true, array['*'],
     '{"*.view": true, "*.export": true, "*.create": false,
       "*.edit": false, "*.delete": false}'::jsonb,
     '{"read_only": true}'::jsonb),

    (p_tenant, 'Cliente Externo', 'Portal del cliente: sus facturas y sus tickets.',
     true, array['customer-portal'],
     '{"customer-portal.view.own": true, "customer-portal.pay": true,
       "helpdesk.create": true}'::jsonb,
     '{"own_only": true}'::jsonb)
  on conflict (tenant_id, name) do nothing;
end;
$$;

comment on function regb.provision_system_roles(uuid) is
  'Crea los 14 roles de §8.2 para un tenant nuevo. Idempotente.';

-- Al crear un tenant, sus roles se provisionan solos.
create or replace function regb.on_tenant_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles(new.id);
  insert into regb.onboarding (tenant_id, stage) values (new.id, 'sold')
    on conflict (tenant_id) do nothing;
  return new;
end;
$$;

create trigger provision_defaults
  after insert on regb.tenants
  for each row execute function regb.on_tenant_created();
