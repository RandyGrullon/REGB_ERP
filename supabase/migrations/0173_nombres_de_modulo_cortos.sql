-- ═══════════════════════════════════════════════════════════════════════
--  0173 — Nombres de módulo cortos, en castellano y sin siglas
--
--  En el menú, «Códigos de barra & RFID» y «Mantenimiento (CMMS)» se
--  cortaban con «…», y el marketplace y Roles y permisos enseñaban siglas
--  que el dueño de un negocio no usa (CMMS, ATS, LMS, KDS, SSO) y el «&»
--  en vez de «y». Aquí se dejan nombres que caben y se entienden; los
--  manifests dicen lo mismo.
--
--  Solo cambia el nombre, y solo si sigue siendo el de antes: un nombre
--  que otra migración ya cambió no se pisa. Ningún id, precio, categoría
--  ni dependencia se toca.
-- ═══════════════════════════════════════════════════════════════════════

update regb.module_catalog c
set name = n.nuevo
from (values
  ('api-webhooks', 'API & Webhooks', 'API y webhooks'),
  ('attendance', 'Asistencia & Ponches', 'Asistencia y ponches'),
  ('barcode', 'Códigos de barra & RFID', 'Códigos de barra'),
  ('bi', 'BI & Reportes', 'BI y reportes'),
  ('contracts', 'Contratos & Suscripciones', 'Contratos y suscripciones'),
  ('crm', 'CRM / Leads', 'CRM y prospectos'),
  ('expenses', 'Gastos & Reembolsos', 'Gastos y reembolsos'),
  ('fleet', 'Flota & Vehículos', 'Flota de vehículos'),
  ('logistics', 'Logística & Rutas', 'Rutas de reparto'),
  ('maintenance', 'Mantenimiento (CMMS)', 'Mantenimiento de equipos'),
  ('marketing', 'Marketing & Campañas', 'Marketing y campañas'),
  ('mrp', 'Planificación MRP', 'Planificación de materiales'),
  ('projects', 'Proyectos & Tareas', 'Proyectos y tareas'),
  ('recruiting', 'Reclutamiento (ATS)', 'Reclutamiento'),
  ('time-off', 'Vacaciones & Permisos', 'Vacaciones y permisos'),
  ('training', 'Capacitación (LMS)', 'Capacitación'),
  ('treasury', 'Tesorería & Bancos', 'Tesorería y bancos'),
  ('auth', 'Autenticación & SSO', 'Inicio de sesión'),
  ('branches', 'Sucursales & Ubicaciones', 'Sucursales'),
  ('clinic', 'Clínica & Citas', 'Clínica y citas'),
  ('dashboard', 'Dashboard & Widgets', 'Inicio'),
  ('gym', 'Gimnasio & Membresías', 'Gimnasio y membresías'),
  ('imports', 'Importar / Exportar', 'Importar y exportar'),
  ('laundry', 'Lavandería / Servicios', 'Lavandería'),
  ('rbac', 'Roles & Permisos', 'Roles y permisos'),
  ('restaurant', 'Restaurante & KDS', 'Restaurante y cocina'),
  ('tour', 'Tutorial & Onboarding', 'Tutorial'),
  ('users', 'Usuarios & Perfiles', 'Usuarios'),
  ('workshop', 'Taller & Servicio técnico', 'Taller y servicio técnico')
) as n(id, viejo, nuevo)
where c.id = n.id and c.name = n.viejo;
