import { defineModule } from '@regb/module-registry'

/**
 * Mantenimiento / CMMS — modulo 59 del catalogo (§5.5, F8.5/S53).
 *
 * El vencimiento preventivo reutiliza las mismas dos funciones de
 * `fleet.ts` (por uso acumulado y por fecha limite). calcularMtbfDias()
 * promedia intervalos ENTRE fallas consecutivas, no desde la primera
 * falla hasta hoy.
 *
 * Deliberadamente SIN requires: el equipo de este modulo es propio,
 * no depende de `fixed-assets` (financiero) ni de `fleet`
 * (vehiculos). Recomienda `inventory` porque los repuestos usados en
 * una orden son productos reales, pero el descuento del stock no es
 * automatico -inventory_movements exige el modulo inventory activo,
 * y este no lo declara como requires-.
 */
export default defineModule({
  id: 'maintenance',
  name: 'Mantenimiento (CMMS)',
  description: 'Preventivo y correctivo, ordenes de trabajo, repuestos y MTBF.',
  icon: 'build',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'produccion',
  navOrder: 58,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: ['inventory'],

  permissions: ['maintenance.view', 'maintenance.work', 'maintenance.manage'],

  routes: [
    { path: '/mantenimiento', label: 'Mantenimiento', perm: 'maintenance.view' },
    { path: '/mantenimiento/equipos', label: 'Equipos', perm: 'maintenance.manage' },
    { path: '/mantenimiento/equipos/:id', label: 'Detalle del equipo', perm: 'maintenance.manage', hidden: true },
    { path: '/mantenimiento/ordenes/:id', label: 'Detalle de orden', perm: 'maintenance.view', hidden: true },
  ],

  dashboardWidgets: ['maintenance-overdue-equipment'],
  reports: ['maintenance-mtbf-by-equipment'],

  events: {
    emits: ['maintenance.workorder.opened', 'maintenance.workorder.completed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
