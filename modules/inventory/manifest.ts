import { defineModule } from '@regb/module-registry'

/**
 * Inventario — modulo 48 del catalogo (§5.4).
 *
 * El primer modulo de pago del MVP comercial (Fase 4).
 */
export default defineModule({
  id: 'inventory',
  name: 'Inventario',
  description: 'Existencias multi-almacen, kardex, costo promedio y valorizacion.',
  icon: 'package_2',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 30,

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
    'inventory.warehouses.manage',
    'inventory.export',
  ],

  routes: [
    { path: '/inventory', label: 'Existencias', perm: 'inventory.view' },
    { path: '/inventory/movements', label: 'Movimientos', perm: 'inventory.view' },
    { path: '/inventory/transfers', label: 'Transferencias', perm: 'inventory.transfer' },
    { path: '/inventory/counts', label: 'Conteos', perm: 'inventory.count' },
    {
      path: '/inventory/warehouses',
      label: 'Almacenes',
      perm: 'inventory.warehouses.manage',
      hidden: true,
    },
  ],

  dashboardWidgets: ['stock-alerts', 'inventory-value'],
  reports: ['stock-valuation', 'movement-ledger'],

  events: {
    emits: ['inventory.stock.low', 'inventory.movement.created'],
    // OJO: el modulo se llama 'sales-orders', no 'sales' — un evento
    // 'sales.order.confirmed' NUNCA se emitiria (regla del contrato: todo
    // evento se prefija con el id del modulo que lo emite, ver S20).
    listens: ['sales-orders.order.confirmed', 'purchase-orders.receipt.posted'],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'count', 'transfer'],
})
