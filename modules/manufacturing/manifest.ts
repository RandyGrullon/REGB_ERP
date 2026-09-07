import { defineModule } from '@regb/module-registry'

/**
 * Ordenes de produccion — modulo 56 del catalogo (§5.4, F8.5/S50-51).
 *
 * Lanzamiento (libera y consume la explosion de materiales del BOM
 * activo), consumo (backflush al liberar, no proporcional al
 * avance), reporte de avance y mermas
 * (transicionValidaOrdenProduccion()/ordenCompleta()/tasaMerma() en
 * @regb/operations). Reutiliza explotarCantidad() de bom.ts y
 * progresoResultadoClave() de performance.ts sin duplicar.
 */
export default defineModule({
  id: 'manufacturing',
  name: 'Ordenes de produccion',
  description: 'Lanzamiento, consumo, reporte de avance y mermas.',
  icon: 'precision_manufacturing',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 55,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: ['bom'],
  recommends: ['inventory'],

  permissions: ['manufacturing.view', 'manufacturing.manage', 'manufacturing.report'],

  routes: [
    { path: '/produccion', label: 'Ordenes de produccion', perm: 'manufacturing.view' },
    { path: '/produccion/:id', label: 'Detalle', perm: 'manufacturing.view', hidden: true },
  ],

  dashboardWidgets: ['production-orders-in-progress'],
  reports: ['production-scrap-rate'],

  events: {
    emits: ['manufacturing.order.released', 'manufacturing.order.completed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'report'],
})
