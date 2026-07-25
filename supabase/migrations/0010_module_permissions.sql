-- ═══════════════════════════════════════════════════════════════════════
--  0010 — Permisos que declara cada modulo
--
--  El editor de roles (§8.4) necesita saber QUE se puede permitir en cada
--  modulo. La fuente de verdad es el `permissions[]` del manifest; esta
--  tabla lo espeja para que la UI no tenga que cargar 93 manifests.
--
--  Los cinco modulos ya construidos llevan sus permisos reales. El resto
--  recibe el juego estandar como marcador, y `/new-module` lo reemplaza
--  cuando el modulo se construye de verdad.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Juego estandar para lo que aun no existe ───────────────────────────
update regb.module_catalog
set permissions = array[
  id || '.view',
  id || '.create',
  id || '.edit',
  id || '.delete',
  id || '.export'
]
where permissions = '{}';

-- ── Los cinco construidos: sus permisos reales, del manifest ───────────
update regb.module_catalog set permissions = array[
  'products.view','products.create','products.edit','products.delete',
  'products.price.view','products.price.edit','products.export'
] where id = 'products';

update regb.module_catalog set permissions = array[
  'inventory.view','inventory.adjust','inventory.transfer',
  'inventory.count','inventory.cost.view','inventory.export'
] where id = 'inventory';

update regb.module_catalog set permissions = array[
  'pos.view','pos.sell','pos.void','pos.discount',
  'pos.shift.open','pos.shift.close','pos.report.view'
] where id = 'pos';

update regb.module_catalog set permissions = array[
  'payroll.view','payroll.run','payroll.approve','payroll.export','payroll.view.own'
] where id = 'payroll';

update regb.module_catalog set permissions = array[
  'invoice-capture.view','invoice-capture.upload','invoice-capture.review',
  'invoice-capture.approve','invoice-capture.reject','invoice-capture.export'
] where id = 'invoice-capture';

-- ── Los core que la UI usa de verdad ───────────────────────────────────
update regb.module_catalog set permissions = array[
  'rbac.view','rbac.role.create','rbac.role.edit','rbac.role.delete',
  'rbac.member.invite','rbac.member.remove'
] where id = 'rbac';

update regb.module_catalog set permissions = array[
  'marketplace.view','marketplace.trial.start','marketplace.request'
] where id = 'marketplace';

update regb.module_catalog set permissions = array[
  'settings.view','settings.edit','settings.branding.edit'
] where id = 'settings';

comment on column regb.module_catalog.permissions is
  'Espejo del permissions[] del manifest. Lo consume el editor de roles de §8.4.';
