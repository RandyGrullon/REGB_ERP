import { defineModule } from '@regb/module-registry'

/**
 * Punto de venta — modulo 35 del catalogo (§5.3).
 *
 * El modulo que engancha a una PYME: vender en mostrador sin internet.
 */
export default defineModule({
  id: 'pos',
  name: 'Punto de venta',
  description: 'Tactil, offline, cajas, turnos, arqueo e impresora termica.',
  icon: 'CreditCard',
  category: 'standard',
  version: '0.1.0',

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['products'],
  recommends: ['inventory'],

  permissions: [
    'pos.view',
    'pos.sell',
    'pos.void',
    'pos.discount',
    'pos.shift.open',
    'pos.shift.close',
    'pos.report.view',
  ],

  routes: [
    { path: '/pos', label: 'Caja', perm: 'pos.sell' },
    { path: '/pos/shifts', label: 'Turnos', perm: 'pos.shift.open' },
    { path: '/pos/reports', label: 'Cierres', perm: 'pos.report.view' },
  ],

  dashboardWidgets: ['sales-today'],
  events: { emits: ['pos.sale.completed', 'pos.shift.closed'], listens: [] },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['sell', 'view'],
})
