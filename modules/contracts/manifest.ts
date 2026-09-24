import { defineModule } from '@regb/module-registry'

/**
 * Contratos & Suscripciones — modulo 33 del catalogo (§5.3, F9/S57).
 *
 * La vigencia reutiliza certificadoVigente() de training.ts.
 * calcularEscalamiento() aplica la clausula de precio al renovar.
 * Renovar NO reabre el contrato -crea uno nuevo con renewed_from_id
 * apuntando al anterior, mismo criterio de versionado que quotes con
 * supersedes_id-.
 *
 * Deliberadamente SIN requires: un contrato es util por su cuenta.
 * Recomienda ar para quien ya factura la recurrencia formalmente.
 */
export default defineModule({
  id: 'contracts',
  name: 'Contratos & Suscripciones',
  description: 'Recurrencia, renovacion automática y escalamiento de precio.',
  icon: 'assignment',
  category: 'standard',
  version: '0.1.0',

  navSection: 'proyectos',
  navOrder: 81,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['ar'],

  permissions: ['contracts.view', 'contracts.manage'],

  routes: [
    { path: '/contratos', label: 'Contratos', perm: 'contracts.view' },
    { path: '/contratos/:id', label: 'Detalle del contrato', perm: 'contracts.view', hidden: true },
  ],

  dashboardWidgets: ['contracts-expiring-soon'],
  reports: ['contracts-renewal-forecast'],

  events: {
    emits: ['contracts.contract.renewed', 'contracts.contract.cancelled'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
