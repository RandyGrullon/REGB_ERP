import { defineModule } from '@regb/module-registry'

/**
 * Lotes, series y vencimientos — modulo 49 del catalogo (§5.4, F8/S46).
 *
 * FEFO real: seleccionFefo() (@regb/operations) elige de que lote sacar
 * cada unidad -el que vence mas pronto primero-. Un item serializado es
 * un lote de cantidad 1 cuyo numero de lote ES el numero de serie, sin
 * columna aparte. Consumir stock corre el algoritmo por accion manual;
 * todavia NO esta conectado al checkout de sales-orders/pos.
 */
export default defineModule({
  id: 'lots-serials',
  name: 'Lotes, series y vencimientos',
  description: 'Trazabilidad completa, FEFO, alertas de caducidad y recall.',
  icon: 'qr_code_2',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 48,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: ['inventory'],
  recommends: [],

  permissions: ['lots-serials.view', 'lots-serials.manage', 'lots-serials.recall'],

  routes: [{ path: '/lotes', label: 'Lotes y series', perm: 'lots-serials.view' }],

  dashboardWidgets: ['lots-expiring-soon'],
  reports: ['lot-traceability'],

  events: {
    emits: ['lots-serials.lot.registered', 'lots-serials.recall.opened'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
