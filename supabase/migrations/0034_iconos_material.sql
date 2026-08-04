-- ═══════════════════════════════════════════════════════════════════════
--  0034 · Los iconos del catalogo eran de otra libreria
-- ═══════════════════════════════════════════════════════════════════════
--
--  `regb.module_catalog.icon` se sembro con nombres de Lucide (`ScanLine`,
--  `Users`, `ScrollText`) porque asi era la UI cuando se escribio la 0009.
--  Al pasar toda la app a Material Symbols, ese dato se quedo atras: los
--  iconos se pintan por LIGADURA, asi que un nombre desconocido no falla
--  ni se cae — se dibuja como el texto literal. En el marketplace salia
--  "ScanLine" escrito al lado del titulo del modulo.
--
--  Es el peor tipo de dato viejo: no rompe nada, solo queda feo en la
--  pantalla que le enseñas a un cliente para venderle.
--
--  92 nombres, uno por uno. No hay atajo: son dos vocabularios distintos y
--  la traduccion es de significado, no de forma.
-- ═══════════════════════════════════════════════════════════════════════

update regb.module_catalog set icon = case icon
  when 'ArrowDownToLine'      then 'download'
  when 'ArrowLeftRight'       then 'swap_horiz'
  when 'ArrowUpDown'          then 'swap_vert'
  when 'ArrowUpFromLine'      then 'upload'
  when 'BadgeCheck'           then 'verified'
  when 'Barcode'              then 'barcode'
  when 'BedDouble'            then 'bed'
  when 'Bell'                 then 'notifications'
  when 'Blocks'               then 'extension'
  when 'BookOpen'             then 'menu_book'
  when 'Box'                  then 'inventory_2'
  when 'Building'             then 'business'
  when 'Building2'            then 'apartment'
  when 'Calculator'           then 'calculate'
  when 'CalendarDays'         then 'calendar_month'
  when 'CalendarRange'        then 'date_range'
  when 'Car'                  then 'directions_car'
  when 'ChartColumn'          then 'bar_chart'
  when 'ChartNoAxesCombined'  then 'trending_up'
  when 'ClipboardList'        then 'assignment'
  when 'Cog'                  then 'settings'
  when 'Coins'                then 'payments'
  when 'CreditCard'           then 'credit_card'
  when 'DatabaseBackup'       then 'backup'
  when 'Dumbbell'             then 'fitness_center'
  when 'ExternalLink'         then 'open_in_new'
  when 'Factory'              then 'factory'
  when 'FileCheck'            then 'fact_check'
  when 'FileInput'            then 'upload_file'
  when 'FileSignature'        then 'draw'
  when 'FileText'             then 'description'
  when 'Fingerprint'          then 'fingerprint'
  when 'FolderKanban'         then 'view_kanban'
  when 'FolderOpen'           then 'folder_open'
  when 'Gift'                 then 'redeem'
  when 'GitBranch'            then 'account_tree'
  when 'GitCompare'           then 'compare_arrows'
  when 'GitPullRequest'       then 'call_merge'
  when 'Globe'                then 'language'
  when 'GraduationCap'        then 'school'
  when 'Hammer'               then 'handyman'
  when 'HardHat'              then 'engineering'
  when 'HeartHandshake'       then 'volunteer_activism'
  when 'Home'                 then 'home'
  when 'IdCard'               then 'badge'
  when 'KeyRound'             then 'key'
  when 'Landmark'             then 'account_balance'
  when 'Layers'               then 'layers'
  when 'LayoutDashboard'      then 'dashboard'
  when 'LifeBuoy'             then 'support_agent'
  when 'ListChecks'           then 'checklist'
  when 'MapPin'               then 'location_on'
  when 'Megaphone'            then 'campaign'
  when 'MessageSquare'        then 'chat'
  when 'MonitorCog'           then 'settings_applications'
  when 'Network'              then 'hub'
  when 'Package'              then 'package_2'
  when 'PackageCheck'         then 'inventory'
  when 'PenTool'              then 'design_services'
  when 'Percent'              then 'percent'
  when 'Pill'                 then 'medication'
  when 'Receipt'              then 'receipt'
  when 'ReceiptText'          then 'receipt_long'
  when 'Route'                then 'route'
  when 'ScanBarcode'          then 'barcode_scanner'
  when 'ScanLine'             then 'document_scanner'
  when 'School'               then 'school'
  when 'ScrollText'           then 'history_edu'
  when 'Search'               then 'search'
  when 'Settings'             then 'settings'
  when 'ShieldCheck'          then 'shield'
  when 'Shirt'                then 'apparel'
  when 'ShoppingCart'         then 'shopping_cart'
  when 'Sparkles'             then 'auto_awesome'
  when 'Split'                then 'call_split'
  when 'Sprout'               then 'agriculture'
  when 'Stethoscope'          then 'stethoscope'
  when 'Tags'                 then 'sell'
  when 'Target'               then 'target'
  when 'Timer'                then 'timer'
  when 'Trello'               then 'view_kanban'
  when 'TrendingUp'           then 'trending_up'
  when 'Truck'                then 'local_shipping'
  when 'User'                 then 'person'
  when 'UserCircle'           then 'account_circle'
  when 'UserPlus'             then 'person_add'
  when 'Users'                then 'group'
  when 'Users2'               then 'groups'
  when 'UtensilsCrossed'      then 'restaurant'
  when 'Webhook'              then 'webhook'
  when 'Workflow'             then 'schema'
  when 'Wrench'               then 'build'
  else icon
end
where icon ~ '[A-Z]';

comment on column regb.module_catalog.icon is
  'Ligadura de Material Symbols, en minusculas con guion bajo. Un nombre desconocido no falla: se dibuja como texto literal, que es peor que fallar.';

-- ── Los 20 que tienen manifiesto mandan sobre la traduccion ─────────────
--  Para esos el icono correcto ya estaba escrito en su `manifest.ts`, que
--  es la fuente de verdad del modulo. La traduccion de arriba es un
--  apano razonable para los 73 que todavia no tienen codigo; donde hay
--  manifiesto, se usa el suyo — si no, `ar` acababa con un icono de
--  descarga y `pos` con uno de tarjeta.
update regb.module_catalog set icon = v.icon
from (values
  ('ar', 'request_quote'), ('audit', 'receipt_long'), ('auth', 'shield_person'),
  ('backup', 'backup'), ('branches', 'storefront'), ('dashboard', 'space_dashboard'),
  ('files', 'folder_open'), ('imports', 'upload_file'), ('inventory', 'package_2'),
  ('invoice-capture', 'document_scanner'), ('notifications', 'notifications'),
  ('orgs', 'apartment'), ('payroll', 'group'), ('pos', 'point_of_sale'),
  ('products', 'inventory_2'), ('sales-orders', 'shopping_cart'), ('search', 'search'),
  ('settings', 'settings'), ('tour', 'school'), ('users', 'group')
) as v(id, icon)
where regb.module_catalog.id = v.id;
