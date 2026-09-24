import { defineModule } from '@regb/module-registry'

/**
 * CRM / Leads — modulo 29 del catalogo (§5.3, F9/S55).
 * Primer modulo de F9 (Ventas avanzado, BI e inteligencia).
 *
 * puntuarLead() es una regla explicita -email, telefono, calidad de
 * la fuente-, no un modelo de IA: cualquiera puede explicar el
 * numero. asignarRoundRobin() reparte leads nuevos entre vendedores
 * activos recordando donde se quedo la ultima vuelta.
 *
 * Deliberadamente SIN requires: un CRM de leads es util por su
 * cuenta. Recomienda `pipeline` para quien formaliza oportunidades.
 */
export default defineModule({
  id: 'crm',
  name: 'CRM / Leads',
  description: 'Captura, puntuación, asignación automática y línea de tiempo.',
  icon: 'contacts',
  category: 'standard',
  version: '0.1.0',

  navSection: 'ventas',
  navOrder: 77,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['pipeline'],

  permissions: ['crm.view', 'crm.manage'],

  routes: [
    { path: '/crm', label: 'CRM / Leads', perm: 'crm.view' },
    { path: '/crm/:id', label: 'Detalle del lead', perm: 'crm.view', hidden: true },
  ],

  dashboardWidgets: ['crm-unassigned-leads'],
  reports: ['crm-leads-by-source'],

  events: {
    emits: ['crm.lead.qualified', 'crm.lead.converted'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['crm.view', 'crm.manage'],
})
