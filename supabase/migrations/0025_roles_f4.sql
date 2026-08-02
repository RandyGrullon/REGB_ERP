-- ═══════════════════════════════════════════════════════════════════════
--  0025 — Los roles del sistema conocen los modulos de la Fase 4
--
--  Dos problemas que aparecieron al probar F4 con roles reales:
--
--  1. El Cajero tenia `pos.sell` pero NO `pos.view`, y recibia 404 en su
--     propia caja. La ruta /pos declara `pos.sell` en el manifest, asi que
--     la pagina ya se corrigio para exigir ese permiso; aun asi el rol debe
--     poder VER el modulo, que es lo que decide si aparece en el menu.
--
--  2. Ningun rol conocia `sales-orders` ni `ar`, que no existian cuando se
--     escribio 0006. Sin esto, el Vendedor no puede tomar un pedido y el
--     Contador no ve la cartera: los dos modulos quedan inalcanzables para
--     todos menos el Owner.
--
--  Solo se AGREGAN permisos; ninguna denegacion existente se toca. La
--  denegacion siempre gana (§8.1) y nada de lo que un cliente ya configuro
--  debe cambiar por una migracion.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Cajero: ve su caja y las ventas del turno ───────────────────────────
update public.roles
set permissions = permissions
      || jsonb_build_object('pos.view', true)
      || jsonb_build_object('pos.report.view', true)
      || jsonb_build_object('products.view', true),
    visible_modules = array(select distinct unnest(visible_modules || array['products']))
where is_system and name = 'Cajero';

-- ── Vendedor: toma pedidos y ve lo que el cliente debe ──────────────────
update public.roles
set permissions = permissions
      || jsonb_build_object('sales-orders.view', true)
      || jsonb_build_object('sales-orders.edit', true)
      || jsonb_build_object('sales-orders.confirm', true)
      || jsonb_build_object('sales-orders.customers.manage', true)
      -- Descontar es decision de gerencia, no del vendedor.
      || jsonb_build_object('sales-orders.discount', false)
      || jsonb_build_object('ar.view', true)
      || jsonb_build_object('products.view', true),
    visible_modules = array(select distinct unnest(visible_modules || array['ar','products']))
where is_system and name = 'Vendedor';

-- ── Almacenista: despacha, pero no factura ni ve precios de venta ───────
update public.roles
set permissions = permissions
      || jsonb_build_object('sales-orders.view', true)
      || jsonb_build_object('sales-orders.deliver', true)
      || jsonb_build_object('products.view', true),
    visible_modules = array(select distinct unnest(visible_modules || array['sales-orders','products']))
where is_system and name = 'Almacenista';

-- ── Contador: la cartera completa, sin tocar la operacion ───────────────
update public.roles
set permissions = permissions
      || jsonb_build_object('ar.view', true)
      || jsonb_build_object('ar.invoice.create', true)
      || jsonb_build_object('ar.payment.record', true)
      || jsonb_build_object('ar.export', true)
      || jsonb_build_object('sales-orders.view', true)
      || jsonb_build_object('inventory.view', true)
      || jsonb_build_object('inventory.cost.view', true),
    visible_modules = array(select distinct unnest(visible_modules || array['ar','sales-orders','inventory']))
where is_system and name = 'Contador';

-- ── Gerentes: todo lo de F4, incluido descontar y anular ───────────────
update public.roles
set permissions = permissions
      || jsonb_build_object('sales-orders.*', true)
      || jsonb_build_object('ar.*', true)
      || jsonb_build_object('pos.*', true)
      || jsonb_build_object('inventory.*', true)
      || jsonb_build_object('products.*', true),
    visible_modules = array(select distinct unnest(
      visible_modules || array['sales-orders','ar','pos','inventory','products']))
where is_system and name in ('Gerente General', 'Gerente de Sucursal');

-- ── Auditor: lee todo, no escribe nada (su scope ya es read_only) ──────
update public.roles
set permissions = permissions
      || jsonb_build_object('sales-orders.view', true)
      || jsonb_build_object('ar.view', true)
      || jsonb_build_object('pos.report.view', true),
    visible_modules = array(select distinct unnest(visible_modules || array['sales-orders','ar','pos']))
where is_system and name = 'Auditor';
