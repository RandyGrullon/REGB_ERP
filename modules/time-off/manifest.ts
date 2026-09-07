import { defineModule } from '@regb/module-registry'

/**
 * Vacaciones & Permisos — modulo 64 del catalogo (§5.6, F7/S39).
 *
 * El saldo de vacaciones se deriva SIEMPRE de la fecha de contratacion
 * (Codigo de Trabajo Art. 177) y de lo ya aprobado -nunca se guarda-.
 * Solo el tipo 'vacation' tiene saldo calculado; el resto de ausencias
 * se registran y aprueban igual, sin un saldo legal.
 */
export default defineModule({
  id: 'time-off',
  name: 'Vacaciones & Permisos',
  description: 'Solicitud, aprobacion, saldos y calendario del equipo.',
  icon: 'beach_access',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 70,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['employees'],
  recommends: [],

  permissions: [
    'time-off.view',
    'time-off.request',
    'time-off.approve',
    'time-off.export',
  ],

  routes: [
    { path: '/vacaciones', label: 'Vacaciones', perm: 'time-off.view' },
    { path: '/vacaciones/aprobar', label: 'Aprobar solicitudes', perm: 'time-off.approve' },
  ],

  dashboardWidgets: ['time-off-pending', 'team-out-today'],
  reports: ['time-off-balance', 'absence-report'],

  events: {
    emits: [
      'time-off.request.requested',
      'time-off.request.approved',
      'time-off.request.rejected',
    ],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'request'],
})
