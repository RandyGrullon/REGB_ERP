import { defineModule } from '@regb/module-registry'

/**
 * Firma electronica — modulo 91 del catalogo (§5.9, F9/S56).
 *
 * Deliberadamente NO es una firma criptografica con certificado ni
 * PKI: es un flujo de "clic para firmar" con rastro de auditoria real
 * (signature_events, inmutable) -da trazabilidad, no la validez legal
 * de una firma digital certificada-.
 *
 * SIN requires: `contracts` (33) todavia no existe en este catalogo
 * construido, y `quotes` solo se recomienda. `document_id` es
 * deliberadamente un uuid sin FK -polimorfico por `document_type`-.
 */
export default defineModule({
  id: 'e-sign',
  name: 'Firma electrónica',
  description: 'Firma de contratos y cotizaciones con validez legal y trazabilidad.',
  icon: 'draw',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'ventas',
  navOrder: 80,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: ['quotes', 'contracts'],

  permissions: ['e-sign.view', 'e-sign.manage'],

  routes: [
    { path: '/firma-electronica', label: 'Firma electrónica', perm: 'e-sign.view' },
    { path: '/firma-electronica/:id', label: 'Detalle de la firma', perm: 'e-sign.view', hidden: true },
  ],

  dashboardWidgets: ['esign-pending-signatures'],
  reports: ['esign-turnaround-time'],

  events: {
    emits: ['e-sign.request.signed', 'e-sign.request.declined'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['e-sign.view'],
})
