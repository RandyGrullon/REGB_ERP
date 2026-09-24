import { defineModule } from '@regb/module-registry'

/**
 * Automatizaciones — modulo 88 del catalogo (§5.3, F9/S63).
 *
 * Consume el mismo outbox de eventos que ya usan mas de veinte
 * modulos via `emit_event()`. Solo LEE `event_outbox` -nunca llama
 * `claim_events()`/`settle_event()`, revocados de `authenticated` a
 * proposito porque son del despachador global de fondo- y lleva su
 * propia bitacora en `automation_runs`, sin interferir con el
 * despachador real. La accion es un catalogo FIJO -hoy solo crear una
 * notificacion real-, nunca codigo arbitrario.
 *
 * Deliberadamente SIN requires: una regla puede escuchar cualquier
 * evento ya emitido por cualquier modulo activo.
 */
export default defineModule({
  id: 'automations',
  name: 'Automatizaciones',
  description: 'Reglas si-esto-entonces-aquello, sin código, entre módulos.',
  icon: 'bolt',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 89,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: [],

  permissions: ['automations.view', 'automations.manage'],

  routes: [{ path: '/automatizaciones', label: 'Automatizaciones', perm: 'automations.view' }],

  dashboardWidgets: ['automations-active-rules'],
  reports: [],

  events: {
    emits: [],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
