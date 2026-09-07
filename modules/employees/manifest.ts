import { defineModule } from '@regb/module-registry'

/**
 * Empleados — modulo 61 del catalogo (§5.6, F7/S36).
 *
 * Expediente, contratos (historial, nunca sobreescrito), organigrama
 * -derivado de manager_id, nunca una tabla aparte- y antiguedad. Puerta
 * de entrada a toda la fase de RRHH: `payroll` todavia es solo un
 * manifest sin esquema real.
 */
export default defineModule({
  id: 'employees',
  name: 'Empleados',
  description: 'Expediente, contratos, organigrama e historial de cada empleado.',
  icon: 'badge',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 68,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['payroll'],

  permissions: [
    'employees.view',
    'employees.employee.create',
    'employees.contract.create',
    'employees.employee.terminate',
    'employees.export',
  ],

  routes: [
    { path: '/empleados', label: 'Empleados', perm: 'employees.view' },
    { path: '/empleados/organigrama', label: 'Organigrama', perm: 'employees.view' },
    { path: '/empleados/:id', label: 'Empleado', perm: 'employees.view', hidden: true },
  ],

  dashboardWidgets: ['headcount', 'new-hires'],
  reports: ['employee-roster', 'org-chart'],

  events: {
    emits: ['employees.employee.created', 'employees.employee.terminated'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
