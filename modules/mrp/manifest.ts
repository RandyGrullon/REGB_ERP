import { defineModule } from '@regb/module-registry'

/**
 * Planificacion MRP — modulo 57 del catalogo (§5.4, F8.5/S52).
 *
 * Explosion de necesidades real (explotarNecesidadesMrp() en
 * @regb/operations, recorre el arbol multinivel del BOM sumando la
 * misma materia prima entre ramas repetidas) y necesidad neta
 * (necesidadNeta(): bruta menos disponible, nunca negativa).
 *
 * Aceptar una sugerencia de "producir" crea una orden de produccion
 * en borrador -manufacturing es requires, acoplamiento legitimo-.
 * Aceptar una de "comprar" NO crea una orden de compra ni una
 * requisicion sola -ese acoplamiento no esta declarado-.
 */
export default defineModule({
  id: 'mrp',
  name: 'Planificacion MRP',
  description: 'Explosion de necesidades y sugerencias de compra o produccion.',
  icon: 'insights',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'produccion',
  navOrder: 56,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: ['manufacturing'],
  recommends: ['purchase-orders'],

  permissions: ['mrp.view', 'mrp.run', 'mrp.resolve'],

  routes: [
    { path: '/mrp', label: 'Planificacion MRP', perm: 'mrp.view' },
    { path: '/mrp/:id', label: 'Detalle', perm: 'mrp.view', hidden: true },
  ],

  dashboardWidgets: ['mrp-suggestions-pending'],
  reports: ['mrp-net-requirements'],

  events: {
    emits: ['mrp.run.completed', 'mrp.suggestion.accepted'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
