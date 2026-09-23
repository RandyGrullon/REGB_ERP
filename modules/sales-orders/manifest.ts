import { defineModule } from '@regb/module-registry'

/**
 * Pedidos de venta — modulo 32 del catalogo (§5.3).
 *
 * Vender formalmente: confirmar, reservar stock, entregar por partes y
 * dejar constancia de lo que queda debiendo (backorder).
 */
export default defineModule({
  id: 'sales-orders',
  name: 'Pedidos',
  description: 'Confirmacion, reserva de stock, entregas parciales y backorder.',
  icon: 'shopping_cart',
  category: 'standard',
  version: '0.1.0',

  navSection: 'ventas',
  navOrder: 40,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['products'],
  // Sin inventario el pedido funciona, pero no aparta nada: se degrada a
  // "papel". El registry lo marca como degradado y la UI lo dice.
  recommends: ['inventory'],

  permissions: [
    'sales-orders.view',
    'sales-orders.create',
    'sales-orders.edit',
    'sales-orders.confirm',
    'sales-orders.deliver',
    'sales-orders.cancel',
    'sales-orders.discount',
    'sales-orders.customers.manage',
    'sales-orders.export',
  ],

  routes: [
    { path: '/pedidos', label: 'Pedidos', perm: 'sales-orders.view' },
    {
      path: '/pedidos/clientes',
      label: 'Clientes',
      perm: 'sales-orders.customers.manage',
      icon: 'contacts',
    },
    {
      path: '/pedidos/clientes/:id',
      label: 'Ficha del cliente',
      perm: 'sales-orders.customers.manage',
      hidden: true,
    },
    { path: '/pedidos/:id', label: 'Detalle', perm: 'sales-orders.view', hidden: true },
  ],

  dashboardWidgets: ['pending-orders', 'top-customers'],
  reports: ['sales-by-customer', 'backorder-list'],

  events: {
    emits: [
      'sales-orders.order.confirmed',
      'sales-orders.order.delivered',
      'sales-orders.order.cancelled',
    ],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'create'],
})
