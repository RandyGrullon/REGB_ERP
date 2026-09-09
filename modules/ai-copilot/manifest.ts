import { defineModule } from '@regb/module-registry'

/**
 * Copiloto IA — modulo 90 del catalogo (§5.3, F9/S65-66).
 *
 * El documento maestro senala este modulo como el mayor riesgo de
 * fuga entre tenants del proyecto. La respuesta de diseno: NUNCA
 * genera SQL libre ni llama a un modelo de lenguaje real todavia -la
 * pregunta se empareja por palabras clave contra el mismo catalogo
 * fijo de fuentes que ya usa `bi`-. La fuga entre tenants queda
 * eliminada por construccion, no por un filtro en tiempo de
 * ejecucion.
 *
 * Deliberadamente SIN requires; recomienda `bi`, cuyo catalogo de
 * fuentes vetadas se reutiliza aqui tal cual.
 */
export default defineModule({
  id: 'ai-copilot',
  name: 'Copiloto IA',
  description: 'Preguntas en lenguaje natural sobre tus datos, resumenes y sugerencias.',
  icon: 'auto_awesome',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 92,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: ['bi'],

  permissions: ['ai-copilot.view'],

  routes: [{ path: '/copiloto', label: 'Copiloto IA', perm: 'ai-copilot.view' }],

  dashboardWidgets: [],
  reports: [],

  events: {
    emits: [],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['ai-copilot.view'],
})
