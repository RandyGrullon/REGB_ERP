import { defineModule } from '@regb/module-registry'

/**
 * Oportunidades / Pipeline de ventas — modulo 30 del catalogo
 * (§5.3, F9/S55).
 *
 * transicionValidaEtapa() avanza un paso a la vez -no salta de
 * "prospecting" a "negotiation"-, con "lost" alcanzable desde
 * cualquier etapa no terminal. forecastPonderado() suma cada monto
 * por SU probabilidad, nunca el monto crudo. diasEnEtapa() reutiliza
 * diasEnPipeline() de recruiting.ts tal cual.
 *
 * REQUIERE crm: una oportunidad puede nacer de un lead real, ese
 * acoplamiento esta declarado y es legitimo.
 */
export default defineModule({
  id: 'pipeline',
  name: 'Oportunidades',
  description: 'Kanban de etapas, pronostico ponderado y motivos de perdida.',
  icon: 'trending_up',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 78,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['crm'],
  recommends: [],

  permissions: ['pipeline.view', 'pipeline.manage'],

  routes: [
    { path: '/pipeline', label: 'Oportunidades', perm: 'pipeline.view' },
    { path: '/pipeline/:id', label: 'Detalle de la oportunidad', perm: 'pipeline.view', hidden: true },
  ],

  dashboardWidgets: ['pipeline-weighted-forecast'],
  reports: ['pipeline-forecast-by-stage'],

  events: {
    emits: ['pipeline.opportunity.won', 'pipeline.opportunity.lost'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['pipeline.view'],
})
