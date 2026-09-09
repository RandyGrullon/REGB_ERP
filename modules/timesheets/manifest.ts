import { defineModule } from '@regb/module-registry'

/**
 * Hojas de tiempo — modulo 72 del catalogo (§5.3, F10/S67).
 *
 * Requiere `projects` de verdad: cada registro apunta a una tarea
 * real, con una FK autentica. Rechazado se corrige y se reenvia;
 * aprobado es terminal de verdad.
 */
export default defineModule({
  id: 'timesheets',
  name: 'Hojas de tiempo',
  description: 'Registro por tarea, aprobacion y facturacion por horas.',
  icon: 'timer',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 94,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['projects'],
  recommends: ['ar'],

  permissions: ['timesheets.view', 'timesheets.manage'],

  routes: [{ path: '/hojas-de-tiempo', label: 'Hojas de tiempo', perm: 'timesheets.view' }],

  dashboardWidgets: ['timesheets-pending-approval'],
  reports: [],

  events: {
    emits: ['timesheets.entry.approved'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['timesheets.view', 'timesheets.manage'],
})
