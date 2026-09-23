import { defineModule } from '@regb/module-registry'

/**
 * Listas de precios — modulo 41 del catalogo (§5.4, F8/S43).
 *
 * Que lista aplica y que precio corresponde se resuelven SIEMPRE con
 * listaAplicable()/precioPorVolumen() (@regb/operations), nunca en SQL.
 * Reemplaza customers.price_list -una columna de texto libre que nunca
 * se leyo desde ningun codigo- por customers.price_list_id, una
 * referencia real a este modulo.
 */
export default defineModule({
  id: 'price-lists',
  name: 'Listas de precios',
  description: 'Por cliente, canal o volumen, con descuentos y vigencias.',
  icon: 'sell',
  category: 'standard',
  version: '0.1.0',

  navSection: 'ventas',
  navOrder: 44,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['products'],
  recommends: [],

  permissions: ['price-lists.view', 'price-lists.manage'],

  routes: [{ path: '/listas-precio', label: 'Listas de precio', perm: 'price-lists.view' }],

  dashboardWidgets: ['active-price-lists'],
  reports: ['price-list-coverage'],

  events: {
    emits: ['price-lists.list.created'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
