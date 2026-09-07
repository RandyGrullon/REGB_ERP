import { defineModule } from '@regb/module-registry'

/**
 * Recepciones — modulo 46 del catalogo (§5.4, F8/S45).
 *
 * `purchase-orders` ya recibe una linea a la vez; esto agrega lo que le
 * falta: un documento de recepcion que agrupa varias lineas de un mismo
 * camion, INSPECCION real (aceptado vs rechazado, no solo "cuanto
 * llego"), discrepancia detectada automaticamente contra lo esperado
 * (detectarDiscrepancia() en @regb/operations) y devolucion al
 * proveedor de lo rechazado, con su propio movimiento de inventario en
 * sentido contrario.
 *
 * Honesto sobre el alcance: la devolucion mueve inventario pero NO
 * genera nota de credito ni ajuste en `ap` automaticamente todavia.
 */
export default defineModule({
  id: 'receipts',
  name: 'Recepciones',
  description: 'Entrada de mercancia con inspeccion, discrepancias y devolucion al proveedor.',
  icon: 'inventory_2',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 47,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['purchase-orders'],
  recommends: ['inventory'],

  permissions: ['receipts.view', 'receipts.receive', 'receipts.return'],

  routes: [
    { path: '/recepciones', label: 'Recepciones', perm: 'receipts.view' },
    {
      path: '/recepciones/:orderId',
      label: 'Recibir orden',
      perm: 'receipts.receive',
      hidden: true,
    },
  ],

  dashboardWidgets: ['receipts-with-discrepancies'],
  reports: ['receiving-discrepancies'],

  events: {
    emits: ['receipts.receipt.registered', 'receipts.return.sent'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'receive'],
})
