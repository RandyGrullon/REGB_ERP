import { defineModule } from '@regb/module-registry'

/**
 * Contabilidad general — modulo 16 del catalogo (§5, F6/S28-29).
 *
 * El primero de la Fase 6: catalogo de cuentas, asientos de partida doble,
 * mayor y balanza de comprobacion. Deliberadamente NO incluye el e-CF
 * (comprobante fiscal electronico) ni los reportes 606/607/608 desde
 * contabilidad -eso es `e-invoice` (25) y `taxes` (24), y necesitan
 * certificado digital real de un contribuyente. Este modulo funciona
 * solo, sin ninguna credencial externa.
 *
 * Tampoco escucha eventos de otros modulos todavia (POS, AR, compras no
 * postean aqui solos): eso es trabajo futuro documentado en la ficha,
 * no algo que se invento sin que nadie lo pidiera.
 */
export default defineModule({
  id: 'accounting',
  name: 'Contabilidad',
  description: 'Catalogo de cuentas, asientos de partida doble, mayor y balanza.',
  icon: 'account_balance',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 60,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: ['ar', 'purchase-orders'],

  permissions: [
    'accounting.view',
    'accounting.accounts.manage',
    'accounting.entry.create',
    'accounting.entry.post',
    'accounting.entry.delete',
    'accounting.export',
  ],

  routes: [
    { path: '/contabilidad', label: 'Asientos', perm: 'accounting.view' },
    {
      path: '/contabilidad/cuentas',
      label: 'Catalogo de cuentas',
      perm: 'accounting.accounts.manage',
      icon: 'account_tree',
    },
    { path: '/contabilidad/mayor', label: 'Mayor', perm: 'accounting.view', icon: 'menu_book' },
    {
      path: '/contabilidad/balanza',
      label: 'Balanza de comprobacion',
      perm: 'accounting.view',
      icon: 'balance',
    },
  ],

  dashboardWidgets: ['draft-entries-pending', 'monthly-entries-posted'],
  reports: ['trial-balance', 'general-ledger'],

  events: {
    emits: ['accounting.entry.posted'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
