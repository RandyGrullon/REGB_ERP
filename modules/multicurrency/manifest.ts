import { defineModule } from '@regb/module-registry'

/**
 * Multimoneda — modulo 26 del catalogo (§5, F6/S31).
 *
 * Catalogo de monedas, historial de tasas capturadas a mano -sin
 * integracion real a una API del BCRD, honesto sobre esa limitacion- y
 * una utilidad de conversion/diferencia cambiaria. Autocontenido: todavia
 * no conecta con ar/ap/treasury para que registren montos en moneda
 * extranjera, eso pide cambiar el esquema de esos modulos.
 */
export default defineModule({
  id: 'multicurrency',
  name: 'Multimoneda',
  description: 'Historial de tasas de cambio, conversion y diferencia cambiaria.',
  icon: 'currency_exchange',
  category: 'standard',
  version: '0.1.0',

  navSection: 'finanzas',
  navOrder: 66,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['accounting'],

  permissions: [
    'multicurrency.view',
    'multicurrency.rate.set',
    'multicurrency.export',
  ],

  routes: [
    { path: '/monedas', label: 'Monedas', perm: 'multicurrency.view' },
    { path: '/monedas/:code', label: 'Historial de tasa', perm: 'multicurrency.view', hidden: true },
  ],

  dashboardWidgets: ['exchange-rate-today', 'rate-staleness'],
  reports: ['exchange-rate-history'],

  events: {
    emits: ['multicurrency.rate.set'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
