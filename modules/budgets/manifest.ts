import { defineModule } from '@regb/module-registry'

/**
 * Presupuestos — modulo 22 del catalogo (§5, F6/S35).
 *
 * Por cuenta y por mes -la unica dimension real disponible hoy; el
 * catalogo tambien promete "por centro o proyecto", eso llega despues-.
 * El real se lee de los asientos contabilizados de `accounting`, en la
 * misma direccion normal de la cuenta que usa el presupuesto.
 *
 * Requiere `accounting` de verdad -budget_lines referencia
 * public.accounts-, aunque la siembra original del catalogo (0009) traia
 * requires vacio; se corrigio en la 0047, mismo criterio que la 0043 ya
 * aplico para accounting/ap.
 */
export default defineModule({
  id: 'budgets',
  name: 'Presupuestos',
  description: 'Presupuesto por cuenta y por mes, comparado contra el real de contabilidad.',
  icon: 'savings',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 61,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['accounting'],
  recommends: ['cost-centers'],

  permissions: [
    'budgets.view',
    'budgets.budget.create',
    'budgets.line.set',
    'budgets.budget.close',
    'budgets.export',
  ],

  routes: [
    { path: '/presupuestos', label: 'Presupuestos', perm: 'budgets.view' },
    { path: '/presupuestos/:id', label: 'Presupuesto', perm: 'budgets.view', hidden: true },
  ],

  dashboardWidgets: ['budget-alerts', 'budget-ytd-variance'],
  reports: ['budget-vs-actual'],

  events: {
    emits: ['budgets.budget.created', 'budgets.budget.closed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
