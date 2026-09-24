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
 * Se contabiliza sola (ADR 0001, migracion 0131): ESCUCHA los eventos de
 * caja, cuentas por cobrar y cuentas por pagar y escribe su asiento ya
 * contabilizado, con las cuentas del mapa del cliente
 * (/contabilidad/mapa). Ninguno de esos modulos la importa ni la llama:
 * si contabilidad esta apagada, venden y cobran igual y no hay asiento.
 */
export default defineModule({
  id: 'accounting',
  name: 'Contabilidad',
  description: 'Catálogo de cuentas, asientos de partida doble, mayor y balanza.',
  icon: 'account_balance',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'finanzas',
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
      label: 'Catálogo de cuentas',
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
    {
      path: '/contabilidad/mapa',
      label: 'Mapa de cuentas',
      perm: 'accounting.view',
      icon: 'alt_route',
    },
  ],

  dashboardWidgets: ['draft-entries-pending', 'monthly-entries-posted'],
  reports: ['trial-balance', 'general-ledger'],

  events: {
    emits: ['accounting.entry.posted'],
    // Handlers en apps/web/src/lib/contabilidad-automatica.ts.
    listens: [
      'pos.sale.completed',
      'pos.sale.voided',
      'ar.invoice.issued',
      'ar.invoice.voided',
      'ar.payment.received',
      'ar.payment.reversed',
      'ar.credit-note.issued',
      'ar.late-fee.applied',
      'ap.invoice.recorded',
      'ap.invoice.voided',
      'ap.payment.recorded',
    ],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
