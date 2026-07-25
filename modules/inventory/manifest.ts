import { defineModule } from '@nexus/module-registry'

/**
 * Inventario — modulo 48 del catalogo (§5.4).
 *
 * El primer modulo de pago del MVP comercial (Fase 4).
 */
export default defineModule({
  id: 'inventory',
  name: 'Inventario',
  description: 'Existencias multi-almacen, kardex, costo promedio y valorizacion.',
  icon: 'Package',
  category: 'standard',
  version: '0.1.0',

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
    metered: [{ key: 'sku', included: 500, overageUnit: 100, price: 5 }],
  },

  requires: ['products'],
  recommends: ['purchase-orders'],

  permissions: [
    'inventory.view',
    'inventory.adjust',
    'inventory.transfer',
    'inventory.count',
    'inventory.cost.view',
    'inventory.export',
  ],

  routes: [
    { path: '/inventory', label: 'Existencias', perm: 'inventory.view' },
    { path: '/inventory/movements', label: 'Movimientos', perm: 'inventory.view' },
    { path: '/inventory/transfers', label: 'Transferencias', perm: 'inventory.transfer' },
    { path: '/inventory/counts', label: 'Conteos', perm: 'inventory.count' },
  ],

  dashboardWidgets: ['stock-alerts', 'inventory-value'],
  reports: ['stock-valuation', 'movement-ledger'],

  events: {
    emits: ['inventory.stock.low', 'inventory.movement.created'],
    listens: ['sales.order.confirmed', 'purchase-orders.receipt.posted'],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'count', 'transfer'],
})
