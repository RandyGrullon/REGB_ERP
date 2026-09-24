import { defineModule } from '@regb/module-registry'

/**
 * Conteos ciclicos — modulo 51 del catalogo (§5.4, F8/S47).
 *
 * No reemplaza `stock_counts`/`stock_count_lines` de `inventory`
 * (0019) -esa sigue funcionando para un conteo rapido sin
 * programacion-. Agrega programacion ABC real (clasificarAbc(),
 * @regb/operations), conteo CIEGO (la pantalla de contar no muestra el
 * numero del sistema) y ajuste que necesita aprobacion antes de tocar
 * inventory_movements/stock_levels.
 */
export default defineModule({
  id: 'stock-counts',
  name: 'Conteos cíclicos',
  description: 'Programación ABC, conteo ciego y ajustes con aprobación.',
  icon: 'checklist',
  category: 'standard',
  version: '0.1.0',

  navSection: 'inventario',
  navOrder: 50,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['inventory'],
  recommends: ['barcode'],

  permissions: ['stock-counts.view', 'stock-counts.manage', 'stock-counts.count', 'stock-counts.approve'],

  routes: [
    { path: '/conteos-ciclicos', label: 'Conteos ciclicos', perm: 'stock-counts.view' },
    { path: '/conteos-ciclicos/:id', label: 'Detalle', perm: 'stock-counts.view', hidden: true },
  ],

  dashboardWidgets: ['cycle-counts-pending-approval'],
  reports: ['abc-classification'],

  events: {
    emits: ['stock-counts.count.submitted', 'stock-counts.count.approved'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'count'],
})
