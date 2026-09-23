import { defineModule } from '@regb/module-registry'

/**
 * Piso de planta / OEE — modulo 60 del catalogo (§5.5, F8.5/S54).
 * Ultimo modulo de F8: al completarlo, F8 (Cadena de suministro y
 * produccion) queda en 18/18.
 *
 * OEE = disponibilidad x rendimiento x calidad (calcularOee() en
 * @regb/operations), cada factor recortado a [0,1] antes de
 * multiplicar. El tiempo trabajado reutiliza workedHours() de
 * attendance.ts; la calidad reutiliza tasaMerma() de
 * manufacturing.ts -calidad es 1 menos la merma-.
 *
 * REQUIERE manufacturing: el terminal marca tiempos y paros sobre una
 * orden de produccion real, no existe sin ella.
 */
export default defineModule({
  id: 'shopfloor',
  name: 'Piso de planta',
  description: 'Terminal tactil para operarios, marcaje de tiempos y OEE.',
  icon: 'precision_manufacturing',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'produccion',
  navOrder: 59,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: ['manufacturing'],
  recommends: [],

  permissions: ['shopfloor.view', 'shopfloor.operate'],

  routes: [
    { path: '/piso-de-planta', label: 'Piso de planta', perm: 'shopfloor.view' },
    { path: '/piso-de-planta/:id', label: 'Terminal', perm: 'shopfloor.operate', hidden: true },
  ],

  dashboardWidgets: ['shopfloor-active-sessions'],
  reports: ['shopfloor-oee-by-order'],

  events: {
    emits: ['shopfloor.session.closed', 'shopfloor.downtime.closed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['shopfloor.view', 'shopfloor.operate'],
})
