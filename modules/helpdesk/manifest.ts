import { defineModule } from '@regb/module-registry'

/**
 * Mesa de ayuda — modulo 40 del catalogo (§5.3, F9/S58).
 *
 * slaVigente() reutiliza certificadoVigente() de training.ts.
 * diasTicketAbierto() reutiliza diasAbierto() de quality.ts tal cual.
 * Un ticket resuelto SI se puede reabrir; uno cerrado es terminal de
 * verdad.
 *
 * Deliberadamente SIN requires: un ticket puede venir de una llamada
 * o un correo, no necesita que el cliente tenga portal. Recomienda
 * `customer-portal` para cuando el cliente abre sus propios tickets.
 */
export default defineModule({
  id: 'helpdesk',
  name: 'Mesa de ayuda',
  description: 'Tickets, SLA, base de conocimiento, chat y satisfaccion.',
  icon: 'support_agent',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 84,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['customer-portal'],

  permissions: ['helpdesk.view', 'helpdesk.manage'],

  routes: [
    { path: '/mesa-de-ayuda', label: 'Mesa de ayuda', perm: 'helpdesk.view' },
    { path: '/mesa-de-ayuda/:id', label: 'Detalle del ticket', perm: 'helpdesk.view', hidden: true },
  ],

  dashboardWidgets: ['helpdesk-open-tickets'],
  reports: ['helpdesk-sla-compliance'],

  events: {
    emits: ['helpdesk.ticket.resolved', 'helpdesk.ticket.closed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['helpdesk.view', 'helpdesk.manage'],
})
