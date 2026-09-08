import { defineModule } from '@regb/module-registry'

/**
 * BI & Reportes — modulo 87 del catalogo (§5.3, F9/S61-62).
 *
 * El "constructor visual" en realidad elige entre un catalogo FIJO de
 * fuentes ya vetadas -nunca acepta SQL libre del tenant, para nunca
 * arriesgar una fuga de datos entre clientes-. Cada fuente respeta
 * RLS y `module_active()` de las tablas que consulta por debajo.
 *
 * Deliberadamente SIN requires: reportar sobre lo que YA existe no
 * depende de ningun modulo en particular.
 */
export default defineModule({
  id: 'bi',
  name: 'BI & Reportes',
  description: 'Constructor visual de reportes, dashboards y export programado.',
  icon: 'bar_chart',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 88,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: [],

  permissions: ['bi.view', 'bi.manage'],

  routes: [
    { path: '/reportes', label: 'BI & Reportes', perm: 'bi.view' },
    { path: '/reportes/:id', label: 'Detalle del reporte', perm: 'bi.view', hidden: true },
  ],

  dashboardWidgets: ['bi-scheduled-exports-due'],
  reports: [],

  events: {
    emits: ['bi.export.executed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['bi.view'],
})
