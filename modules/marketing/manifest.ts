import { defineModule } from '@regb/module-registry'

/**
 * Marketing & Campanas — modulo 37 del catalogo (§5.3, F9/S59).
 *
 * Honesto sobre lo que es: NO envia correos ni WhatsApp de verdad
 * todavia -no hay integracion con un proveedor externo-. "Enviar" una
 * campana toma la foto de los leads que hoy cumplen el filtro de
 * segmento y crea un destinatario real por cada uno.
 *
 * Requiere `crm` de verdad: el segmento y la atribucion de conversion
 * se apoyan en una FK real hacia los leads, no en una lista suelta.
 */
export default defineModule({
  id: 'marketing',
  name: 'Marketing & Campanas',
  description: 'Segmentos, email/WhatsApp masivo, landing, UTM y atribucion.',
  icon: 'campaign',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 86,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: ['crm'],
  recommends: [],

  permissions: ['marketing.view', 'marketing.manage'],

  routes: [
    { path: '/marketing', label: 'Marketing & Campanas', perm: 'marketing.view' },
    { path: '/marketing/:id', label: 'Detalle de campana', perm: 'marketing.view', hidden: true },
  ],

  dashboardWidgets: ['marketing-campaigns-in-progress'],
  reports: ['marketing-campaign-performance'],

  events: {
    emits: ['marketing.campaign.sent', 'marketing.lead.attributed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
