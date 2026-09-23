import { defineModule } from '@regb/module-registry'

/**
 * E-commerce sync — modulo 36 del catalogo (§5.3, F9/S60).
 *
 * Honesto sobre lo que es: NO llama a la API de Shopify/WooCommerce/
 * Tiendanube de verdad -no hay integracion con un proveedor externo
 * todavia-. Un pedido entrante se registra TAL CUAL llega -su total
 * nunca se recalcula, porque ya lo calculo el canal externo-.
 *
 * Requiere `products` de verdad: el vinculo de catalogo es una FK
 * real, no un SKU suelto. Recomienda `inventory` para reflejar el
 * stock disponible al sincronizar.
 */
export default defineModule({
  id: 'ecommerce',
  name: 'E-commerce sync',
  description: 'Shopify/WooCommerce/Tiendanube: catalogo, stock y pedidos bidireccional.',
  icon: 'storefront',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'ventas',
  navOrder: 87,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: ['products'],
  recommends: ['inventory'],

  permissions: ['ecommerce.view', 'ecommerce.manage'],

  routes: [
    { path: '/ecommerce', label: 'E-commerce sync', perm: 'ecommerce.view' },
    { path: '/ecommerce/:id', label: 'Detalle del pedido', perm: 'ecommerce.view', hidden: true },
  ],

  dashboardWidgets: ['ecommerce-orders-pending'],
  reports: ['ecommerce-orders-by-channel'],

  events: {
    emits: ['ecommerce.order.received', 'ecommerce.order.imported'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
