import { defineModule } from '@regb/module-registry'

/**
 * Centros de costo — modulo 23 del catalogo (§5, F6/S35).
 *
 * Distribucion y prorrateo de gasto entre sucursales, departamentos o
 * proyectos. El prorrateo -repartir un monto por peso relativo, cuadrando
 * exacto contra el total- vive en splitAmount() (@regb/operations).
 *
 * No exige `accounting`: una asignacion puede ser manual, o etiquetar una
 * linea de asiento si accounting esta activo -recomendado, no requerido-.
 */
export default defineModule({
  id: 'cost-centers',
  name: 'Centros de costo',
  description: 'Distribucion, prorrateo y seguimiento de gasto por centro.',
  icon: 'call_split',
  category: 'standard',
  version: '0.1.0',

  navSection: 'finanzas',
  navOrder: 65,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['accounting', 'budgets'],

  permissions: [
    'cost-centers.view',
    'cost-centers.center.create',
    'cost-centers.allocation.create',
    'cost-centers.export',
  ],

  routes: [
    { path: '/centros-costo', label: 'Centros de costo', perm: 'cost-centers.view' },
    { path: '/centros-costo/:id', label: 'Centro de costo', perm: 'cost-centers.view', hidden: true },
  ],

  dashboardWidgets: ['cost-center-top', 'cost-center-total'],
  reports: ['cost-center-distribution'],

  events: {
    emits: ['cost-centers.allocation.created'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
