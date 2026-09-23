import { defineModule } from '@regb/module-registry'

/**
 * Capacitacion (LMS) — modulo 67 del catalogo (§5.6, F7/S42).
 *
 * Sistema de registro (LMS de seguimiento), no una plataforma de
 * contenido: aproboEvaluacion() y certificadoVigente() (@regb/operations)
 * calculan siempre contra el minimo del curso y la fecha real, nunca se
 * guardan como bandera aparte.
 */
export default defineModule({
  id: 'training',
  name: 'Capacitacion (LMS)',
  description: 'Cursos, evaluaciones, certificados y matriz de competencias.',
  icon: 'school',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'rrhh',
  navOrder: 76,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: ['employees'],
  recommends: [],

  permissions: [
    'training.view',
    'training.manage-courses',
    'training.manage-enrollments',
    'training.manage-competencies',
  ],

  routes: [{ path: '/capacitacion', label: 'Capacitacion', perm: 'training.view' }],

  dashboardWidgets: ['enrollments-in-progress', 'certificates-expiring'],
  reports: ['completion-rate', 'competency-matrix'],

  events: {
    emits: [
      'training.enrollment.completed',
      'training.certificate.issued',
    ],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
