import { defineModule } from '@regb/module-registry'

/**
 * Tesoreria & Bancos — modulo 19 del catalogo (§5, F6/S30).
 *
 * Las cuentas bancarias del negocio, sus movimientos y las transferencias
 * entre ellas. El saldo se deriva siempre de los movimientos: nunca se
 * escribe a mano, y un movimiento registrado no se edita ni se borra -se
 * corrige con el movimiento contrario, igual que un asiento contabilizado-.
 *
 * El flujo de caja proyectado junta ese saldo real con lo que `ar` espera
 * cobrar y lo que `ap` tiene que pagar. Los recomienda pero no los exige:
 * sin ellos el flujo simplemente no tiene esas dos columnas.
 */
export default defineModule({
  id: 'treasury',
  name: 'Tesorería & Bancos',
  description: 'Cuentas bancarias, flujo de caja proyectado y transferencias.',
  icon: 'account_balance',
  category: 'standard',
  version: '0.1.0',

  navSection: 'finanzas',
  navOrder: 62,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['ar', 'ap', 'accounting'],

  permissions: [
    'treasury.view',
    'treasury.account.create',
    'treasury.transaction.record',
    'treasury.transfer.create',
    'treasury.export',
  ],

  routes: [
    { path: '/tesoreria', label: 'Tesoreria', perm: 'treasury.view' },
    { path: '/tesoreria/flujo', label: 'Flujo de caja', perm: 'treasury.view' },
    { path: '/tesoreria/:id', label: 'Cuenta bancaria', perm: 'treasury.view', hidden: true },
  ],

  dashboardWidgets: ['cash-position', 'cash-flow-warning'],
  reports: ['cash-flow-projection', 'bank-statement'],

  events: {
    emits: ['treasury.transaction.recorded', 'treasury.transfer.recorded'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
