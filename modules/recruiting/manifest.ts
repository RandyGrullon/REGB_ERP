import { defineModule } from '@regb/module-registry'

/**
 * Reclutamiento (ATS) — modulo 65 del catalogo (§5.6, F7/S41).
 *
 * SIN portal de empleo publico -este esquema nunca otorga acceso al rol
 * `anon` sobre datos de negocio-. Las transiciones de etapa se validan
 * con transicionValida() (@regb/operations), no en SQL.
 */
export default defineModule({
  id: 'recruiting',
  name: 'Reclutamiento (ATS)',
  description: 'Vacantes, portal de empleo, pipeline de candidatos y entrevistas.',
  icon: 'person_add',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 74,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: ['employees'],

  permissions: [
    'recruiting.view',
    'recruiting.manage-positions',
    'recruiting.manage-candidates',
    'recruiting.manage-pipeline',
  ],

  routes: [{ path: '/reclutamiento', label: 'Vacantes', perm: 'recruiting.view' }],

  dashboardWidgets: ['open-positions', 'pipeline-summary'],
  reports: ['time-to-hire', 'pipeline-by-stage'],

  events: {
    emits: [
      'recruiting.application.created',
      'recruiting.application.stage-changed',
      'recruiting.interview.scheduled',
    ],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
