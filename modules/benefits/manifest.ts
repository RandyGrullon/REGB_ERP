import { defineModule } from '@regb/module-registry'

/**
 * Beneficios — modulo 69 del catalogo (§5.6, F7/S41).
 *
 * SIN integracion real con aseguradoras -eso es hardware/API que este
 * sistema no controla, mismo criterio que el gateway de payments-. El
 * saldo de un prestamo se deriva SIEMPRE con saldoPrestamo()
 * (@regb/operations), nunca se guarda.
 */
export default defineModule({
  id: 'benefits',
  name: 'Beneficios',
  description: 'Seguros, prestamos internos, adelantos y plan de beneficios.',
  icon: 'volunteer_activism',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 73,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['employees'],
  recommends: ['payroll'],

  permissions: [
    'benefits.view',
    'benefits.manage-loans',
    'benefits.record-payment',
    'benefits.manage-enrollments',
  ],

  routes: [
    { path: '/beneficios', label: 'Prestamos & Adelantos', perm: 'benefits.view' },
    { path: '/beneficios/planes', label: 'Planes & Inscripciones', perm: 'benefits.manage-enrollments' },
  ],

  dashboardWidgets: ['loans-outstanding', 'benefits-cost'],
  reports: ['loan-balances', 'enrollment-summary'],

  events: {
    emits: [
      'benefits.loan.created',
      'benefits.loan.payment-recorded',
      'benefits.loan.paid',
      'benefits.enrollment.created',
      'benefits.enrollment.cancelled',
    ],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
