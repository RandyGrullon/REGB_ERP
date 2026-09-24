import { defineModule } from '@regb/module-registry'

/**
 * Portal del Empleado — modulo 70 del catalogo (§5.6, F7/S40).
 *
 * Ventana de autoservicio: "quien mira" es el expediente que RRHH vinculo
 * a la cuenta (`employees.user_id`, unico por cliente, 0132) y se le
 * pregunta a la base por el token (`mi_expediente()`, `mis_volantes()`).
 * Hasta 0132 se emparejaba por correo, sin unicidad, y la demo le
 * enseñaba a una persona el volante de otra. Sin vinculo, el portal lo
 * dice: nunca adivina ni muestra el de otra persona.
 */
export default defineModule({
  id: 'hr-portal',
  name: 'Portal del empleado',
  description: 'Autoservicio: volantes, vacaciones, datos personales y anuncios.',
  icon: 'badge',
  category: 'standard',
  version: '0.1.0',

  navSection: 'rrhh',
  navOrder: 72,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['employees'],
  recommends: [],

  permissions: [
    'hr-portal.view',
    'hr-portal.request-time-off',
    'hr-portal.edit-profile',
    'hr-portal.manage-announcements',
  ],

  routes: [
    { path: '/portal', label: 'Mi portal', perm: 'hr-portal.view' },
    { path: '/portal/anuncios', label: 'Anuncios', perm: 'hr-portal.manage-announcements' },
  ],

  dashboardWidgets: ['recent-announcements'],
  reports: [],

  events: {
    emits: ['hr-portal.announcement.published'],
    listens: [],
  },

  platforms: { web: true, desktop: false, mobile: true },
  mobileScope: ['view', 'request-time-off'],
})
