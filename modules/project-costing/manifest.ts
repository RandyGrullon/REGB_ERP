import { defineModule } from '@regb/module-registry'

/**
 * Costeo de proyectos — modulo 73 del catalogo (§5.3, F10/S68).
 *
 * El margen, la desviacion y el WIP NO se guardan: se derivan de las
 * lineas de presupuesto y de los costos reales -mismo criterio que
 * `loyalty_balance()` con los puntos y `bank_account_balance()` con el
 * saldo-. Un costo real es un hecho historico inmutable desde el
 * insert.
 *
 * Requiere `projects` de verdad: un presupuesto es de un proyecto
 * real, con FK autentica.
 */
export default defineModule({
  id: 'project-costing',
  name: 'Costeo de proyectos',
  description: 'Presupuesto contra real, margen, WIP y avance de obra.',
  icon: 'query_stats',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'proyectos',
  navOrder: 95,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: ['projects'],
  recommends: ['accounting'],

  permissions: ['project-costing.view', 'project-costing.manage'],

  routes: [
    { path: '/costeo-proyectos', label: 'Costeo de proyectos', perm: 'project-costing.view' },
    { path: '/costeo-proyectos/:id', label: 'Costeo del proyecto', perm: 'project-costing.view', hidden: true },
  ],

  dashboardWidgets: ['project-costing-over-budget'],
  reports: [],

  events: {
    emits: [],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
