import { defineModule } from '@regb/module-registry'

/**
 * Requisiciones — modulo 43 del catalogo (§5.4, F8/S44).
 *
 * El flujo de aprobacion por monto reutiliza max_amount, ya existente
 * en @regb/permissions -no un motor de aprobacion nuevo-. La jerarquia
 * es el sistema de roles mismo. transicionValidaRequisicion()
 * (@regb/operations) valida la maquina de estados.
 */
export default defineModule({
  id: 'requisitions',
  name: 'Requisiciones',
  description: 'Solicitud interna con flujo de aprobacion por monto y jerarquia.',
  icon: 'assignment',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 45,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['purchase-orders'],

  permissions: ['requisitions.view', 'requisitions.request', 'requisitions.approve'],

  routes: [{ path: '/requisiciones', label: 'Requisiciones', perm: 'requisitions.view' }],

  dashboardWidgets: ['requisitions-pending'],
  reports: ['requisitions-by-department'],

  events: {
    emits: [
      'requisitions.requisition.submitted',
      'requisitions.requisition.approved',
      'requisitions.requisition.rejected',
    ],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'request'],
})
