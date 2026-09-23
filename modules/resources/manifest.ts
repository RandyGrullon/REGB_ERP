import { defineModule } from '@regb/module-registry'

/**
 * Planificacion de recursos — modulo 75 del catalogo (§5.3, F10/S68).
 *
 * La sobrecarga NO se guarda como bandera: se deriva sumando las horas
 * asignadas de la semana contra la capacidad. Asignar EXACTAMENTE la
 * capacidad no es sobrecarga -es una semana llena, que es distinto de
 * una imposible-, por eso `estaSobrecargado()` usa mayor estricto.
 *
 * Requiere `projects` de verdad: una asignacion es de una tarea real.
 */
export default defineModule({
  id: 'resources',
  name: 'Planificacion de recursos',
  description: 'Capacidad, asignacion, sobrecarga y calendario maestro.',
  icon: 'calendar_month',
  category: 'standard',
  version: '0.1.0',

  navSection: 'proyectos',
  navOrder: 96,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['projects'],
  recommends: [],

  permissions: ['resources.view', 'resources.manage'],

  routes: [{ path: '/recursos', label: 'Planificacion de recursos', perm: 'resources.view' }],

  dashboardWidgets: ['resources-overloaded'],
  reports: [],

  events: {
    emits: [],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
