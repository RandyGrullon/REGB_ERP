import { defineModule } from '@regb/module-registry'

/**
 * Pasarelas de cobro — modulo 27 del catalogo (§5, F6/S34).
 *
 * SIN integracion real a Stripe/Azul/CardNet/PayPal -eso pide
 * credenciales de comercio reales y una revision de seguridad que este
 * primer corte no tiene-. Genera links de cobro y cobros recurrentes;
 * confirmar el pago es siempre una accion manual, igual que un cobro de
 * ar o un pago de ap.
 */
export default defineModule({
  id: 'payments',
  name: 'Pasarelas de cobro',
  description: 'Links de cobro y cobro recurrente, con confirmacion manual del pago.',
  icon: 'payments',
  category: 'standard',
  version: '0.1.0',

  navSection: 'ventas',
  navOrder: 67,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['ar'],

  permissions: [
    'payments.view',
    'payments.link.create',
    'payments.link.confirm',
    'payments.recurring.create',
    'payments.export',
  ],

  routes: [
    { path: '/cobros', label: 'Cobros', perm: 'payments.view' },
  ],

  dashboardWidgets: ['payment-links-pending', 'recurring-charges-due'],
  reports: ['payment-links-status'],

  events: {
    emits: ['payments.link.created', 'payments.link.paid'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
