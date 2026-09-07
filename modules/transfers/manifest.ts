import { defineModule } from '@regb/module-registry'

/**
 * Transferencias — modulo 50 del catalogo (§5.4, F8/S47).
 *
 * No reemplaza la transferencia simple de un paso que ya trae
 * `inventory` (0019, `stock_transfers`) -esta agrega el flujo completo
 * con estado de transito para quien de verdad lo necesita:
 * despachado mueve el origen, recibido mueve el destino, y la
 * discrepancia se ve si lo que llega no es lo que salio
 * (detectarDiscrepancia() de @regb/operations).
 */
export default defineModule({
  id: 'transfers',
  name: 'Transferencias',
  description: 'Entre almacenes y sucursales, con transito y confirmacion.',
  icon: 'local_shipping',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 49,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['inventory'],
  recommends: [],

  permissions: ['transfers.view', 'transfers.create', 'transfers.dispatch', 'transfers.receive'],

  routes: [
    { path: '/transferencias', label: 'Transferencias', perm: 'transfers.view' },
    { path: '/transferencias/:id', label: 'Detalle', perm: 'transfers.view', hidden: true },
  ],

  dashboardWidgets: ['transfers-in-transit'],
  reports: ['transfer-variance'],

  events: {
    emits: ['transfers.order.dispatched', 'transfers.order.received'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'receive'],
})
