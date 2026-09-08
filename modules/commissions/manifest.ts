import { defineModule } from '@regb/module-registry'

/**
 * Comisiones — modulo 34 del catalogo (§5.3, F9/S57).
 *
 * calcularComision() es la unica formula: porcentaje sobre una base o
 * un monto fijo, nunca una mezcla ambigua. transicionValidaComision()
 * sigue el mismo criterio que un CAPA de quality: no se paga sin
 * aprobar primero.
 *
 * REQUIERE sales-orders: una comision se calcula sobre un pedido de
 * venta real, FK autentica hacia sales_orders. Recomienda payroll
 * para la liquidacion final, sin exigirlo.
 */
export default defineModule({
  id: 'commissions',
  name: 'Comisiones',
  description: 'Esquemas por vendedor, producto o margen, con liquidacion.',
  icon: 'percent',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 82,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['sales-orders'],
  recommends: ['payroll'],

  permissions: ['commissions.view', 'commissions.manage'],

  routes: [
    { path: '/comisiones', label: 'Comisiones', perm: 'commissions.view' },
    { path: '/comisiones/planes', label: 'Planes de comision', perm: 'commissions.manage' },
  ],

  dashboardWidgets: ['commissions-pending-approval'],
  reports: ['commissions-by-salesperson'],

  events: {
    emits: ['commissions.entry.approved', 'commissions.entry.paid'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['commissions.view'],
})
