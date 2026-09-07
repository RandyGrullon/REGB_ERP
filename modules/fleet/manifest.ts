import { defineModule } from '@regb/module-registry'

/**
 * Flota & Vehiculos — modulo 54 del catalogo (§5.4, F8/S49).
 *
 * Vehiculos, combustible, mantenimiento (vencido por km o por fecha,
 * mantenimientoVencidoPorKm()/mantenimientoVencidoPorFecha()),
 * documentos con vigencia real (documentoVehiculoVigente(), reusa
 * certificadoVigente() de training.ts) y multas con flujo de estados.
 *
 * Sin telematica/GPS real -eso es logistics (53)- ni verificacion
 * contra el registro de transito real para las multas.
 */
export default defineModule({
  id: 'fleet',
  name: 'Flota & Vehiculos',
  description: 'Vehiculos, combustible, mantenimiento, licencias y multas.',
  icon: 'local_shipping',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 52,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['logistics'],

  permissions: ['fleet.view', 'fleet.manage', 'fleet.fines.manage'],

  routes: [
    { path: '/flota', label: 'Flota', perm: 'fleet.view' },
    { path: '/flota/:id', label: 'Detalle', perm: 'fleet.view', hidden: true },
  ],

  dashboardWidgets: ['fleet-maintenance-due'],
  reports: ['fleet-fuel-efficiency'],

  events: {
    emits: ['fleet.maintenance.recorded', 'fleet.fine.registered'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'manage'],
})
