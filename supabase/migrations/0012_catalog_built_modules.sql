-- ═══════════════════════════════════════════════════════════════════════
--  0012 — Los cinco modulos ya construidos, al catalogo
--
--  Estaban solo en el seed, que corre DESPUES de las migraciones. Con una
--  base limpia eso significaba que 0010 no podia asignarles permisos: sus
--  filas todavia no existian, y nacian con `permissions = '{}'`.
--
--  El sintoma era que el editor de roles mostraba "Ver / Crear / Editar"
--  generico para inventario y POS en vez de "Ajustar", "Transferir",
--  "Anular" y demas.
--
--  La causa de fondo era de sitio: el catalogo es dato de PRODUCTO y va en
--  migracion; el seed solo debe crear clientes y activarles modulos.
-- ═══════════════════════════════════════════════════════════════════════

insert into regb.module_catalog
  (id, name, category, description, icon, version, requires, recommends, platforms, permissions, is_published)
values
  ('products', 'Productos', 'core',
   'Catalogo con variantes, unidades, atributos, imagenes y kits.', 'Box', '0.1.0',
   '{}', '{}', '{"web":true,"desktop":true,"mobile":true}',
   array['products.view','products.create','products.edit','products.delete',
         'products.price.view','products.price.edit','products.export'],
   true),

  ('inventory', 'Inventario', 'standard',
   'Existencias multi-almacen, kardex, costo promedio y valorizacion.', 'Package', '0.1.0',
   '{products}', '{purchase-orders}', '{"web":true,"desktop":true,"mobile":true}',
   array['inventory.view','inventory.adjust','inventory.transfer',
         'inventory.count','inventory.cost.view','inventory.export'],
   true),

  ('pos', 'Punto de venta', 'standard',
   'Tactil, offline, cajas, turnos, arqueo e impresora termica.', 'CreditCard', '0.1.0',
   '{products}', '{inventory}', '{"web":true,"desktop":true,"mobile":true}',
   array['pos.view','pos.sell','pos.void','pos.discount',
         'pos.shift.open','pos.shift.close','pos.report.view'],
   true),

  ('payroll', 'Nomina', 'advanced',
   'Calculo con TSS, AFP, ARS e ISR; prestaciones, regalia y volantes.', 'Users', '0.1.0',
   '{}', '{accounting}', '{"web":true,"desktop":true,"mobile":false}',
   array['payroll.view','payroll.run','payroll.approve','payroll.export','payroll.view.own'],
   true),

  ('invoice-capture', 'Captura de facturas', 'advanced',
   'Fotografia la factura del proveedor y extrae RNC, NCF, fecha, ITBIS y lineas.', 'ScanLine', '0.1.0',
   '{}', '{ap,taxes,files}', '{"web":true,"desktop":true,"mobile":true}',
   array['invoice-capture.view','invoice-capture.upload','invoice-capture.review',
         'invoice-capture.approve','invoice-capture.reject','invoice-capture.export'],
   true)

on conflict (id) do update
  set name        = excluded.name,
      category    = excluded.category,
      description = excluded.description,
      icon        = excluded.icon,
      requires    = excluded.requires,
      recommends  = excluded.recommends,
      platforms   = excluded.platforms,
      permissions = excluded.permissions,
      is_published = excluded.is_published;

-- Los precios de los cinco, segun la matriz de §6.3.
insert into regb.module_pricing (module_id, tier, install_price, monthly_price, per_user)
select
  mc.id, t.tier,
  case mc.category
    when 'core'     then 0
    when 'standard' then (array[150, 600, 1800])[t.idx]
    when 'advanced' then (array[400, 1500, 4000])[t.idx]
  end,
  case mc.category
    when 'core'     then 0
    when 'standard' then (array[19, 69, 190])[t.idx]
    when 'advanced' then (array[45, 160, 420])[t.idx]
  end,
  0
from regb.module_catalog mc
cross join (values
  ('pyme'::regb.tenant_tier, 1),
  ('mediano'::regb.tenant_tier, 2),
  ('grande'::regb.tenant_tier, 3)
) as t(tier, idx)
where mc.id in ('products', 'inventory', 'pos', 'payroll', 'invoice-capture')
on conflict (module_id, tier) do update
  set install_price = excluded.install_price,
      monthly_price = excluded.monthly_price;

-- `products` es core: los clientes que ya existen deben tenerlo activo.
do $$
declare t record;
begin
  for t in select id from regb.tenants loop
    perform regb.provision_core_modules(t.id);
  end loop;
end $$;
