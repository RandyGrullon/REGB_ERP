import { defineModule } from '@regb/module-registry'

/**
 * Gastos & Reembolsos — modulo 68 del catalogo (§5.6, F7/S40).
 *
 * SIN OCR real -leer un recibo fotografiado pide un servicio de vision
 * por computadora con credenciales que este sistema no tiene-. El monto
 * y el proveedor se escriben a mano; el ITBIS deducible se calcula solo
 * si el proveedor dio un NCF fiscal valido (isValidNcf() en @regb/operations).
 */
export default defineModule({
  id: 'expenses',
  name: 'Gastos & Reembolsos',
  description: 'Foto del recibo con OCR, aprobación y reembolso en nómina.',
  icon: 'receipt_long',
  category: 'standard',
  version: '0.1.0',

  navSection: 'rrhh',
  navOrder: 71,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['employees'],
  recommends: ['payroll'],

  permissions: [
    'expenses.view',
    'expenses.submit',
    'expenses.approve',
    'expenses.reimburse',
    'expenses.export',
  ],

  routes: [
    { path: '/gastos', label: 'Gastos', perm: 'expenses.view' },
    { path: '/gastos/aprobar', label: 'Aprobar gastos', perm: 'expenses.approve' },
  ],

  dashboardWidgets: ['expenses-pending', 'expenses-owed'],
  reports: ['expenses-by-category', 'itbis-deductible'],

  events: {
    emits: [
      'expenses.expense.submitted',
      'expenses.expense.approved',
      'expenses.expense.rejected',
      'expenses.expense.reimbursed',
    ],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'submit'],
})
