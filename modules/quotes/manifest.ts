import { defineModule } from '@regb/module-registry'

/**
 * Cotizaciones — modulo 31 del catalogo (§5.3, F9/S56).
 *
 * Los totales reutilizan documentTotals()/lineTotals() de
 * documents.ts tal cual. La vigencia reutiliza certificadoVigente()
 * de training.ts. Una cotizacion tiene versiones reales: revisarla
 * crea una fila nueva y marca la anterior 'superseded', nunca se
 * sobrescribe.
 *
 * REQUIERE products (el catalogo de lo que se cotiza). Recomienda
 * crm -sin FK real, ese acoplamiento no esta declarado como
 * requires-.
 */
export default defineModule({
  id: 'quotes',
  name: 'Cotizaciones',
  description: 'Plantillas, versiones, aprobacion y firma electronica.',
  icon: 'description',
  category: 'standard',
  version: '0.1.0',

  navSection: 'ventas',
  navOrder: 79,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['products'],
  recommends: ['crm'],

  permissions: ['quotes.view', 'quotes.manage'],

  routes: [
    { path: '/cotizaciones-venta', label: 'Cotizaciones', perm: 'quotes.view' },
    { path: '/cotizaciones-venta/:id', label: 'Detalle de la cotizacion', perm: 'quotes.view', hidden: true },
  ],

  dashboardWidgets: ['quotes-pending-approval'],
  reports: ['quotes-conversion-rate'],

  events: {
    emits: ['quotes.quote.sent', 'quotes.quote.approved', 'quotes.quote.rejected'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['quotes.view'],
})
