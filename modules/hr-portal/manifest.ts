import { defineModule } from '@regb/module-registry'

/**
 * Portal del Empleado — modulo 70 del catalogo (§5.6, F7/S40).
 *
 * Ventana de autoservicio: "quien mira" se resuelve por correo entre
 * public.user_profiles y public.employees -este esquema no tiene un
 * employees.user_id formal-. Sin ese correo coincidente, el portal no
 * encuentra expediente y lo dice explicitamente, nunca falla en silencio
 * ni muestra el de otra persona.
 */
export default defineModule({
  id: 'hr-portal',
  name: 'Portal del Empleado',
  description: 'Autoservicio: volantes, vacaciones, datos personales y anuncios.',
  icon: 'badge',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
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
