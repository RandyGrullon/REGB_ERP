-- ═══════════════════════════════════════════════════════════════════════
--  0009 — El catalogo completo: 93 modulos
--
--  Datos de producto, no de un cliente: por eso va en migracion y no en
--  seed. El marketplace lee de aqui, y el motor de precios de la Fase 3
--  tambien. Documento maestro §5 y §6.3.
--
--  `is_published` distingue lo que se puede comprar HOY de lo que esta en
--  el catalogo pero todavia no existe. Un cliente solo ve lo publicado.
-- ═══════════════════════════════════════════════════════════════════════

insert into regb.module_catalog
  (id, name, category, description, icon, version, requires, recommends, platforms, is_published)
values
-- ── 5.1 Plataforma / Core (1-15) ───────────────────────────────────────
('auth','Autenticacion & SSO','core','Login, MFA, enlace magico, SSO, politicas de contrasena y sesiones activas.','KeyRound','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":true}',true),
('users','Usuarios & Perfiles','core','Alta y baja, perfil, avatar, preferencias, idioma y zona horaria.','User','0.1.0','{auth}','{}','{"web":true,"desktop":true,"mobile":true}',true),
('rbac','Roles & Permisos','core','Roles, permisos granulares, visibilidad de modulos y alcance por sucursal o monto.','ShieldCheck','0.1.0','{users}','{}','{"web":true,"desktop":true,"mobile":false}',true),
('orgs','Multi-empresa','core','Varias razones sociales bajo un mismo cliente, con consolidacion.','Building2','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":false}',true),
('branches','Sucursales & Ubicaciones','core','Jerarquia de sucursales, horarios y geocerca.','MapPin','0.1.0','{orgs}','{}','{"web":true,"desktop":true,"mobile":true}',true),
('dashboard','Dashboard & Widgets','core','Inicio configurable por rol, con widgets de cada modulo activo.','LayoutDashboard','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":true}',true),
('search','Busqueda global','core','Ctrl+K sobre todas las entidades, texto completo y difusa.','Search','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":true}',true),
('notifications','Notificaciones','core','En la app, push, correo y WhatsApp, con centro de notificaciones.','Bell','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":true}',true),
('audit','Auditoria','core','Quien hizo que, cuando y desde donde; diff antes y despues; export firmado.','ScrollText','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":false}',true),
('settings','Configuracion','core','Ajustes por cliente, empresa, sucursal y usuario, con herencia.','Settings','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":false}',true),
('files','Gestor documental','core','Carpetas, versiones, OCR, previsualizacion y adjuntos.','FolderOpen','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":true}',true),
('tour','Tutorial & Onboarding','core','Tours interactivos, checklist gamificado y academia.','GraduationCap','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":true}',true),
('marketplace','Marketplace de modulos','core','Explorar, probar 14 dias, activar y ver el precio en vivo.','Blocks','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":false}',true),
('imports','Importar / Exportar','core','CSV y XLSX con mapeo visual, validacion previa y deshacer.','ArrowUpDown','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":false}',true),
('backup','Respaldos','core','Snapshots programados, export total y restauracion a un punto.','DatabaseBackup','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":false}',true),

-- ── 5.2 Finanzas & Contabilidad (16-28, 93) ────────────────────────────
('accounting','Contabilidad general','advanced','Catalogo de cuentas, asientos, mayor, balanza y cierres.','Calculator','0.1.0','{}','{cost-centers}','{"web":true,"desktop":true,"mobile":false}',false),
('ar','Cuentas por cobrar','standard','Facturas, antiguedad de saldos, recordatorios y notas de credito.','ArrowDownToLine','0.1.0','{}','{accounting}','{"web":true,"desktop":true,"mobile":true}',false),
('ap','Cuentas por pagar','standard','Facturas de proveedor, programacion de pagos y retenciones.','ArrowUpFromLine','0.1.0','{}','{accounting}','{"web":true,"desktop":true,"mobile":false}',false),
('treasury','Tesoreria & Bancos','standard','Cuentas bancarias, flujo de caja proyectado y transferencias.','Landmark','0.1.0','{}','{accounting}','{"web":true,"desktop":true,"mobile":false}',false),
('bank-rec','Conciliacion bancaria','advanced','Import de estados y emparejamiento asistido con partidas pendientes.','GitCompare','0.1.0','{treasury}','{accounting}','{"web":true,"desktop":true,"mobile":false}',false),
('fixed-assets','Activos fijos','standard','Alta, depreciacion, revaluo y baja.','Building','0.1.0','{}','{accounting}','{"web":true,"desktop":true,"mobile":false}',false),
('budgets','Presupuestos','standard','Por cuenta, centro o proyecto, con comparativo y alertas.','Target','0.1.0','{}','{accounting}','{"web":true,"desktop":true,"mobile":false}',false),
('cost-centers','Centros de costo','standard','Distribucion, prorrateo y rentabilidad por centro.','Split','0.1.0','{}','{accounting}','{"web":true,"desktop":true,"mobile":false}',false),
('taxes','Impuestos','advanced','ITBIS, retenciones, formatos 606/607/608 y calendario fiscal.','Receipt','0.1.0','{}','{accounting}','{"web":true,"desktop":true,"mobile":false}',false),
('e-invoice','Facturacion electronica','advanced','e-CF de la DGII, firma digital y modo contingencia.','FileCheck','0.1.0','{}','{taxes}','{"web":true,"desktop":true,"mobile":false}',false),
('multicurrency','Multimoneda','standard','Tasas automaticas, diferencia cambiaria y reexpresion.','Coins','0.1.0','{}','{accounting}','{"web":true,"desktop":true,"mobile":false}',false),
('payments','Pasarelas de cobro','standard','Stripe, Azul, CardNet y PayPal; links de pago y cobro recurrente.','CreditCard','0.1.0','{}','{ar}','{"web":true,"desktop":true,"mobile":true}',false),
('consolidation','Consolidacion','enterprise','Estados consolidados multi-empresa con eliminaciones inter-compania.','Layers','0.1.0','{accounting,orgs}','{}','{"web":true,"desktop":true,"mobile":false}',false),

-- ── 5.3 Ventas & CRM (29-41) ───────────────────────────────────────────
('crm','CRM / Leads','standard','Captura, puntuacion, asignacion automatica y linea de tiempo.','Users2','0.1.0','{}','{pipeline}','{"web":true,"desktop":true,"mobile":true}',false),
('pipeline','Oportunidades','standard','Kanban de etapas, pronostico ponderado y motivos de perdida.','Trello','0.1.0','{crm}','{}','{"web":true,"desktop":true,"mobile":true}',false),
('quotes','Cotizaciones','standard','Plantillas, versiones, aprobacion y firma electronica.','FileText','0.1.0','{products}','{crm}','{"web":true,"desktop":true,"mobile":true}',false),
('sales-orders','Pedidos de venta','standard','Confirmacion, reserva de stock, entregas parciales y backorder.','ShoppingCart','0.1.0','{products}','{inventory}','{"web":true,"desktop":true,"mobile":true}',false),
('contracts','Contratos & Suscripciones','standard','Recurrencia, renovacion automatica y escalamiento de precio.','FileSignature','0.1.0','{}','{ar}','{"web":true,"desktop":true,"mobile":false}',false),
('commissions','Comisiones','standard','Esquemas por vendedor, producto o margen, con liquidacion.','Percent','0.1.0','{sales-orders}','{payroll}','{"web":true,"desktop":true,"mobile":true}',false),
('ecommerce','E-commerce sync','advanced','Shopify, WooCommerce y Tiendanube: catalogo, stock y pedidos.','Globe','0.1.0','{products}','{inventory}','{"web":true,"desktop":true,"mobile":false}',false),
('marketing','Marketing & Campanas','advanced','Segmentos, correo y WhatsApp masivo, landing, UTM y atribucion.','Megaphone','0.1.0','{crm}','{}','{"web":true,"desktop":true,"mobile":false}',false),
('loyalty','Fidelizacion','standard','Puntos, niveles, cupones, referidos y monedero del cliente.','Gift','0.1.0','{}','{pos}','{"web":true,"desktop":true,"mobile":true}',false),
('customer-portal','Portal de clientes','standard','El cliente ve sus facturas, paga, descarga y abre tickets.','ExternalLink','0.1.0','{}','{ar}','{"web":true,"desktop":false,"mobile":true}',false),
('helpdesk','Mesa de ayuda','standard','Tickets, SLA, base de conocimiento, chat y satisfaccion.','LifeBuoy','0.1.0','{}','{customer-portal}','{"web":true,"desktop":true,"mobile":true}',false),
('price-lists','Listas de precios','standard','Por cliente, canal o volumen, con descuentos y vigencias.','Tags','0.1.0','{products}','{}','{"web":true,"desktop":true,"mobile":false}',false),

-- ── 5.4 Compras & Cadena de suministro (42-54) ─────────────────────────
('suppliers','Proveedores','standard','Ficha, evaluacion, documentos y homologacion.','Truck','0.1.0','{}','{ap}','{"web":true,"desktop":true,"mobile":false}',false),
('requisitions','Requisiciones','standard','Solicitud interna con flujo de aprobacion por monto y jerarquia.','ClipboardList','0.1.0','{}','{purchase-orders}','{"web":true,"desktop":true,"mobile":true}',false),
('rfq','Cotizacion a proveedores','standard','RFQ multi-proveedor, comparativo automatico y adjudicacion.','GitPullRequest','0.1.0','{suppliers}','{}','{"web":true,"desktop":true,"mobile":false}',false),
('purchase-orders','Ordenes de compra','standard','Emision, seguimiento, recepcion parcial y cierre.','FileInput','0.1.0','{suppliers}','{inventory}','{"web":true,"desktop":true,"mobile":true}',false),
('receipts','Recepciones','standard','Entrada de mercancia, inspeccion, discrepancias y devolucion.','PackageCheck','0.1.0','{purchase-orders}','{inventory}','{"web":true,"desktop":true,"mobile":true}',false),
('lots-serials','Lotes, series y vencimientos','advanced','Trazabilidad completa, FEFO, alertas de caducidad y recall.','Barcode','0.1.0','{inventory}','{}','{"web":true,"desktop":true,"mobile":true}',false),
('transfers','Transferencias','standard','Entre almacenes y sucursales, con transito y confirmacion.','ArrowLeftRight','0.1.0','{inventory}','{}','{"web":true,"desktop":true,"mobile":true}',false),
('stock-counts','Conteos ciclicos','standard','Programacion ABC, conteo ciego y ajustes con aprobacion.','ListChecks','0.1.0','{inventory}','{barcode}','{"web":true,"desktop":true,"mobile":true}',false),
('barcode','Codigos de barra & RFID','standard','Generacion, etiquetas y escaneo con la camara del celular.','ScanBarcode','0.1.0','{products}','{}','{"web":true,"desktop":true,"mobile":true}',false),
('logistics','Logistica & Rutas','advanced','Planificacion de rutas, seguimiento GPS y prueba de entrega.','Route','0.1.0','{}','{sales-orders}','{"web":true,"desktop":true,"mobile":true}',false),
('fleet','Flota & Vehiculos','standard','Vehiculos, combustible, mantenimiento, licencias y multas.','Car','0.1.0','{}','{logistics}','{"web":true,"desktop":true,"mobile":true}',false),

-- ── 5.5 Produccion & Operaciones (55-60) ───────────────────────────────
('bom','Lista de materiales','advanced','Multinivel, versiones, sustitutos y costeo del producto.','Network','0.1.0','{products}','{inventory}','{"web":true,"desktop":true,"mobile":false}',false),
('manufacturing','Ordenes de produccion','advanced','Lanzamiento, consumo, reporte de avance y mermas.','Factory','0.1.0','{bom}','{inventory}','{"web":true,"desktop":true,"mobile":true}',false),
('mrp','Planificacion MRP','advanced','Explosion de necesidades y sugerencias de compra o produccion.','GitBranch','0.1.0','{manufacturing}','{purchase-orders}','{"web":true,"desktop":true,"mobile":false}',false),
('quality','Control de calidad','advanced','Planes de inspeccion, no conformidades, CAPA y certificados.','BadgeCheck','0.1.0','{}','{manufacturing}','{"web":true,"desktop":true,"mobile":true}',false),
('maintenance','Mantenimiento (CMMS)','advanced','Preventivo y correctivo, ordenes de trabajo, repuestos y MTBF.','Wrench','0.1.0','{}','{inventory}','{"web":true,"desktop":true,"mobile":true}',false),
('shopfloor','Piso de planta','advanced','Terminal tactil para operarios, marcaje de tiempos y OEE.','MonitorCog','0.1.0','{manufacturing}','{}','{"web":true,"desktop":true,"mobile":true}',false),

-- ── 5.6 Recursos Humanos (61-70) ───────────────────────────────────────
('employees','Empleados','standard','Expediente, contratos, documentos, organigrama e historial.','IdCard','0.1.0','{}','{payroll}','{"web":true,"desktop":true,"mobile":false}',false),
('attendance','Asistencia & Ponches','standard','Biometrico, geocerca, QR, horas extra y tardanzas.','Fingerprint','0.1.0','{employees}','{payroll}','{"web":true,"desktop":true,"mobile":true}',false),
('time-off','Vacaciones & Permisos','standard','Solicitud, aprobacion, saldos y calendario del equipo.','CalendarDays','0.1.0','{employees}','{}','{"web":true,"desktop":true,"mobile":true}',false),
('recruiting','Reclutamiento (ATS)','advanced','Vacantes, portal de empleo, pipeline de candidatos y entrevistas.','UserPlus','0.1.0','{}','{employees}','{"web":true,"desktop":true,"mobile":false}',false),
('performance','Desempeno','advanced','OKR y KPI, evaluacion 360, reuniones 1:1 y planes de mejora.','TrendingUp','0.1.0','{employees}','{}','{"web":true,"desktop":true,"mobile":true}',false),
('training','Capacitacion (LMS)','advanced','Cursos, evaluaciones, certificados y matriz de competencias.','BookOpen','0.1.0','{employees}','{}','{"web":true,"desktop":true,"mobile":true}',false),
('expenses','Gastos & Reembolsos','standard','Foto del recibo con OCR, aprobacion y reembolso en nomina.','ReceiptText','0.1.0','{employees}','{payroll}','{"web":true,"desktop":true,"mobile":true}',false),
('benefits','Beneficios','standard','Seguros, prestamos internos, adelantos y plan de beneficios.','HeartHandshake','0.1.0','{employees}','{payroll}','{"web":true,"desktop":true,"mobile":false}',false),
('hr-portal','Portal del empleado','standard','Autoservicio: volantes, vacaciones, datos personales y anuncios.','UserCircle','0.1.0','{employees}','{}','{"web":true,"desktop":false,"mobile":true}',false),

-- ── 5.7 Proyectos & Servicios (71-75) ──────────────────────────────────
('projects','Proyectos & Tareas','standard','Kanban, Gantt, dependencias, hitos y plantillas.','FolderKanban','0.1.0','{}','{timesheets}','{"web":true,"desktop":true,"mobile":true}',false),
('timesheets','Hojas de tiempo','standard','Registro por tarea, aprobacion y facturacion por horas.','Timer','0.1.0','{projects}','{ar}','{"web":true,"desktop":true,"mobile":true}',false),
('project-costing','Costeo de proyectos','advanced','Presupuesto contra real, margen, WIP y avance de obra.','ChartNoAxesCombined','0.1.0','{projects}','{accounting}','{"web":true,"desktop":true,"mobile":false}',false),
('field-service','Servicio en campo','advanced','Ordenes de servicio, agenda de tecnicos, checklist y repuestos.','Hammer','0.1.0','{}','{inventory}','{"web":true,"desktop":true,"mobile":true}',false),
('resources','Planificacion de recursos','standard','Capacidad, asignacion, sobrecarga y calendario maestro.','CalendarRange','0.1.0','{projects}','{}','{"web":true,"desktop":true,"mobile":false}',false),

-- ── 5.8 Verticales (76-86) ─────────────────────────────────────────────
('restaurant','Restaurante & KDS','vertical','Mesas, comandas, cocina, delivery, recetas y food cost.','UtensilsCrossed','0.1.0','{products}','{pos,inventory}','{"web":true,"desktop":true,"mobile":true}',false),
('clinic','Clinica & Citas','vertical','Agenda medica, historia clinica, recetas y seguros.','Stethoscope','0.1.0','{}','{ar}','{"web":true,"desktop":true,"mobile":true}',false),
('hotel','Hoteleria','vertical','Reservas, rack de habitaciones, check-in y housekeeping.','BedDouble','0.1.0','{}','{ar}','{"web":true,"desktop":true,"mobile":true}',false),
('workshop','Taller & Servicio tecnico','vertical','Recepcion de equipos, diagnostico, presupuesto y garantias.','Cog','0.1.0','{}','{inventory}','{"web":true,"desktop":true,"mobile":true}',false),
('real-estate','Inmobiliaria','vertical','Propiedades, alquileres, contratos, cobros y mantenimiento.','Home','0.1.0','{}','{ar,contracts}','{"web":true,"desktop":true,"mobile":true}',false),
('education','Educacion','vertical','Estudiantes, matricula, cursos, calificaciones y mensualidades.','School','0.1.0','{}','{ar}','{"web":true,"desktop":true,"mobile":true}',false),
('gym','Gimnasio & Membresias','vertical','Planes, accesos, clases, entrenadores y congelamientos.','Dumbbell','0.1.0','{}','{contracts}','{"web":true,"desktop":true,"mobile":true}',false),
('pharmacy','Farmacia','vertical','Recetas, controlados, vencimientos y seguros medicos.','Pill','0.1.0','{products}','{lots-serials,pos}','{"web":true,"desktop":true,"mobile":true}',false),
('agro','Agropecuario','vertical','Lotes, siembra, cosecha, ganado y tratamientos.','Sprout','0.1.0','{}','{inventory}','{"web":true,"desktop":true,"mobile":true}',false),
('construction','Construccion','vertical','Partidas, cubicaciones, avance de obra y subcontratos.','HardHat','0.1.0','{}','{projects}','{"web":true,"desktop":true,"mobile":true}',false),
('laundry','Lavanderia / Servicios','vertical','Ordenes, prendas, rutas de recogida y tickets.','Shirt','0.1.0','{}','{pos}','{"web":true,"desktop":true,"mobile":true}',false),

-- ── 5.9 Inteligencia & Plataforma avanzada (87-92) ─────────────────────
('bi','BI & Reportes','advanced','Constructor visual de reportes, dashboards y export programado.','ChartColumn','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":true}',false),
('automations','Automatizaciones','advanced','Reglas si-esto-entonces-aquello, sin codigo, entre modulos.','Workflow','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":false}',false),
('api-webhooks','API & Webhooks','advanced','API REST y GraphQL por cliente, llaves, limite de uso y webhooks.','Webhook','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":false}',false),
('ai-copilot','Copiloto IA','advanced','Preguntas en lenguaje natural sobre tus datos, resumenes y sugerencias.','Sparkles','0.1.0','{}','{bi}','{"web":true,"desktop":true,"mobile":true}',false),
('e-sign','Firma electronica','advanced','Firma de contratos y cotizaciones con validez legal y trazabilidad.','PenTool','0.1.0','{}','{quotes,contracts}','{"web":true,"desktop":true,"mobile":true}',false),
('chat','Chat interno','standard','Canales por modulo, proyecto o sucursal, con hilos y menciones.','MessageSquare','0.1.0','{}','{}','{"web":true,"desktop":true,"mobile":true}',false)

on conflict (id) do update
  set name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      icon = excluded.icon,
      requires = excluded.requires,
      recommends = excluded.recommends,
      platforms = excluded.platforms;

-- ═══════════════════════════════════════════════════════════════════════
--  Precios — la matriz de §6.3 aplicada a todo el catalogo
--
--  Se derivan de la categoria en vez de escribirse uno a uno: 93 modulos
--  por 3 tiers son 279 filas, y a mano eso son 279 oportunidades de
--  equivocarse. `pnpm audit:manifests` verifica que cada manifest coincida.
-- ═══════════════════════════════════════════════════════════════════════
insert into regb.module_pricing (module_id, tier, install_price, monthly_price, per_user)
select
  mc.id,
  t.tier,
  case mc.category
    when 'core'       then 0
    when 'standard'   then (array[150, 600, 1800])[t.idx]
    when 'advanced'   then (array[400, 1500, 4000])[t.idx]
    when 'vertical'   then (array[600, 2200, 6000])[t.idx]
    when 'enterprise' then (array[0, 0, 12000])[t.idx]
  end,
  case mc.category
    when 'core'       then 0
    when 'standard'   then (array[19, 69, 190])[t.idx]
    when 'advanced'   then (array[45, 160, 420])[t.idx]
    when 'vertical'   then (array[59, 210, 550])[t.idx]
    when 'enterprise' then (array[0, 0, 900])[t.idx]
  end,
  0
from regb.module_catalog mc
cross join (values
  ('pyme'::regb.tenant_tier, 1),
  ('mediano'::regb.tenant_tier, 2),
  ('grande'::regb.tenant_tier, 3)
) as t(tier, idx)
on conflict (module_id, tier) do update
  set install_price = excluded.install_price,
      monthly_price = excluded.monthly_price;

-- Enterprise no se vende a PYME ni a Mediano: se despublica su precio
-- poniendolo en cero y el marketplace lo oculta para esos tiers.
comment on table regb.module_pricing is
  'Precio por modulo y tier. Los enterprise valen 0 en pyme/mediano porque no se les vende (§6.3).';
