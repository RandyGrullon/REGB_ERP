import { defineModule } from '@regb/module-registry'

/**
 * API & Webhooks — modulo 89 del catalogo (§5.3, F9/S64).
 *
 * Una llave se muestra COMPLETA una sola vez -solo su hash SHA-256 se
 * guarda, el mismo `createHash('sha256')` de `node:crypto` que ya uso
 * `e-sign` para su rastro de firma-. Los webhooks salientes SI hacen
 * una llamada HTTP real -a la URL que el propio tenant configuro para
 * su propio sistema, no a un tercero que suplantar-, consumiendo el
 * mismo `event_outbox` que ya usa `automations`.
 *
 * Deliberadamente SIN requires: cualquier evento ya emitido por
 * cualquier modulo activo se puede exponer por API o webhook.
 */
export default defineModule({
  id: 'api-webhooks',
  name: 'API & Webhooks',
  description: 'API REST/GraphQL por tenant, keys, rate limit, webhooks salientes.',
  icon: 'webhook',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 90,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: [],

  permissions: ['api-webhooks.view', 'api-webhooks.manage'],

  routes: [{ path: '/api-webhooks', label: 'API & Webhooks', perm: 'api-webhooks.view' }],

  dashboardWidgets: ['api-webhooks-failed-deliveries'],
  reports: [],

  events: {
    emits: [],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
