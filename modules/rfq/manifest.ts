import { defineModule } from '@regb/module-registry'

/**
 * Cotizacion a proveedores (RFQ) — modulo 44 del catalogo (§5.4, F8/S44).
 *
 * SIN portal de proveedores -mismo criterio que recruiting: este
 * esquema nunca otorga acceso a datos de negocio al rol `anon`-. El
 * comparativo automatico SI se resuelve con mejorCotizacion()
 * (@regb/operations): menor monto, desempate por menor plazo de entrega.
 */
export default defineModule({
  id: 'rfq',
  name: 'Cotización a proveedores',
  description: 'RFQ multi-proveedor, comparativo automático y adjudicación.',
  icon: 'compare_arrows',
  category: 'standard',
  version: '0.1.0',

  navSection: 'inventario',
  navOrder: 46,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['suppliers'],
  recommends: [],

  permissions: ['rfq.view', 'rfq.manage', 'rfq.award'],

  routes: [{ path: '/cotizaciones', label: 'Cotizaciones', perm: 'rfq.view' }],

  dashboardWidgets: ['rfqs-open'],
  reports: ['rfq-comparison'],

  events: {
    emits: ['rfq.quote.recorded', 'rfq.supplier.awarded'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
