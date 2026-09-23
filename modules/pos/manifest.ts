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
  icon: 'point_of_sale',
  category: 'standard',
  version: '0.1.0',

  navSection: 'ventas',
  navOrder: 10,

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
    // Lo fiscal de la caja, sin depender de `ar` (0129). Un colmado que
    // solo vende en mostrador emite NCF en cada ticket y declara su 607:
    // antes las dos pantallas vivian en Por cobrar, que exige Pedidos, y
    // el colmado recibia un 404. Mismo reparto que en `ar`: cargar rangos
    // es del dueño (`ar.invoice.create` alla), bajar el 607/608 es
    // exportar (`ar.export` alla).
    'pos.ncf.manage',
    'pos.export',
  ],

  routes: [
    { path: '/pos', label: 'Caja', perm: 'pos.sell' },
    { path: '/pos/shifts', label: 'Turnos', perm: 'pos.shift.open' },
    { path: '/pos/reports', label: 'Cierres', perm: 'pos.report.view' },
    { path: '/pos/ticket/:id', label: 'Ticket', perm: 'pos.report.view', hidden: true },
    { path: '/pos/comprobantes', label: 'Comprobantes', perm: 'pos.ncf.manage', icon: 'verified' },
    { path: '/pos/dgii', label: 'Reportes DGII', perm: 'pos.export', icon: 'account_balance' },
  ],

  dashboardWidgets: ['sales-today', 'open-shifts'],
  events: { emits: ['pos.sale.completed', 'pos.sale.voided', 'pos.shift.closed'], listens: [] },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['sell', 'view'],
})
