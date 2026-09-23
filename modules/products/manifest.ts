import { defineModule } from '@regb/module-registry'

/**
 * Productos & Catalogo — modulo 47 del catalogo (§5.4).
 *
 * Core: va incluido en todos los planes. Nada funciona sin catalogo.
 */
export default defineModule({
  id: 'products',
  name: 'Productos',
  description: 'Catalogo de productos con precios, impuestos, categorias y punto de reorden.',
  icon: 'inventory_2',
  category: 'core',
  version: '0.1.0',

  navSection: 'inventario',
  navOrder: 20,

  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },

  permissions: [
    'products.view',
    'products.create',
    'products.edit',
    'products.delete',
    'products.price.view',
    'products.price.edit',
    'products.categories.manage',
    'products.export',
  ],

  routes: [
    { path: '/products', label: 'Catalogo', perm: 'products.view' },
    {
      path: '/products/categories',
      label: 'Categorias',
      perm: 'products.categories.manage',
    },
    { path: '/products/:id', label: 'Detalle', perm: 'products.view', hidden: true },
  ],

  dashboardWidgets: ['top-products', 'catalog-completeness'],
  events: { emits: ['products.item.created', 'products.price.changed'], listens: [] },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'scan'],
})
