import { defineModule } from '@regb/module-registry'

/**
 * Desempeno — modulo 66 del catalogo (§5.6, F7/S42).
 *
 * El progreso de un OKR se deriva SIEMPRE con progresoResultadoClave()/
 * progresoObjetivo() (@regb/operations), nunca se guarda. Una evaluacion
 * enviada es inmutable, un objetivo o un 1:1 no lo son -son registros
 * vivos, no hechos financieros-.
 */
export default defineModule({
  id: 'performance',
  name: 'Desempeno',
  description: 'OKR y KPI, evaluacion 360, reuniones 1:1 y planes de mejora.',
  icon: 'trending_up',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'rrhh',
  navOrder: 75,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: ['employees'],
  recommends: [],

  permissions: [
    'performance.view',
    'performance.manage-objectives',
    'performance.manage-one-on-ones',
    'performance.submit-review',
    'performance.manage-improvement-plans',
  ],

  routes: [{ path: '/desempeno', label: 'Desempeno', perm: 'performance.view' }],

  dashboardWidgets: ['objectives-progress', 'improvement-plans-active'],
  reports: ['okr-progress', 'review-summary'],

  events: {
    emits: [
      'performance.objective.created',
      'performance.review.submitted',
      'performance.improvement-plan.created',
    ],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
