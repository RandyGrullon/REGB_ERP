import { defineModule } from '@regb/module-registry'

/**
 * Asistencia & Ponches — modulo 63 del catalogo (§5.6, F7/S39).
 *
 * SIN biometrico real -hardware que este sistema no controla-. Geocerca
 * se resuelve de verdad con haversineDistanceMeters()/isWithinGeofence()
 * (@regb/operations). Horas extra y tardanza se derivan siempre de
 * check_in/check_out, nunca se guardan.
 */
export default defineModule({
  id: 'attendance',
  name: 'Asistencia & Ponches',
  description: 'Marcaje con geocerca y QR, horas extra y tardanzas calculadas.',
  icon: 'fingerprint',
  category: 'standard',
  version: '0.1.0',

  navSection: 'rrhh',
  navOrder: 69,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['employees'],
  recommends: ['payroll'],

  permissions: [
    'attendance.view',
    'attendance.check-in',
    'attendance.geofence.manage',
    'attendance.export',
  ],

  routes: [
    { path: '/asistencia', label: 'Asistencia', perm: 'attendance.view' },
    { path: '/asistencia/geocercas', label: 'Geocercas', perm: 'attendance.geofence.manage' },
  ],

  dashboardWidgets: ['attendance-today', 'late-arrivals'],
  reports: ['attendance-summary', 'overtime-report'],

  events: {
    emits: ['attendance.record.checked-in', 'attendance.record.checked-out'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'check-in'],
})
