import { defineModule } from '@regb/module-registry'

/**
 * Cuentas por cobrar — modulo 17 del catalogo (§5.2).
 *
 * Cierra el ciclo del MVP: vender ya funciona, ahora hay que cobrar. Sin
 * esto un negocio a credito no sabe quien le debe ni desde cuando, que es
 * la razon numero uno por la que una PYME vuelve a Excel.
 */
export default defineModule({
  id: 'ar',
  name: 'Por cobrar',
  description: 'Facturas, antiguedad de saldos, recordatorios y notas de credito.',
  icon: 'request_quote',
  category: 'standard',
  version: '0.1.0',

  navSection: 'finanzas',
  navOrder: 50,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  // Sin clientes no hay a quien cobrarle, y los clientes viven con pedidos.
  requires: ['sales-orders'],
  recommends: ['accounting'],

  permissions: [
    'ar.view',
    'ar.invoice.create',
    'ar.invoice.void',
    'ar.payment.record',
    // Reversar un cobro mal registrado (no se borra: queda tachado, con motivo).
    'ar.payment.reverse',
    'ar.latefee.apply',
    // Nota de credito B04: devolucion o rebaja sobre una factura.
    'ar.creditnote.create',
    // Fijar el limite de credito de un cliente y la politica de dias vencidos.
    'ar.credit.manage',
    // Vender a credito por encima del limite o con vencidas: queda firmado.
    'ar.credit.override',
    'ar.export',
  ],

  routes: [
    { path: '/cobrar', label: 'Por cobrar', perm: 'ar.view' },
    { path: '/cobrar/cartera', label: 'Cartera', perm: 'ar.view', icon: 'monitoring' },
    {
      path: '/cobrar/ncf',
      label: 'Comprobantes',
      perm: 'ar.invoice.create',
      icon: 'verified',
    },
    { path: '/cobrar/dgii', label: 'Reportes DGII', perm: 'ar.export', icon: 'account_balance' },
    { path: '/cobrar/:id', label: 'Factura', perm: 'ar.view', hidden: true },
    { path: '/cobrar/:id/imprimir', label: 'Imprimir factura', perm: 'ar.view', hidden: true },
  ],

  dashboardWidgets: ['overdue-receivables', 'aging-summary'],
  reports: ['aging-report', 'customer-statement'],

  events: {
    emits: [
      'ar.invoice.issued',
      'ar.invoice.paid',
      'ar.invoice.overdue',
      // Desde la tabla (0131): cada cobro, cada anulacion y cada cargo por
      // mora, por cualquier camino que escriba la fila.
      'ar.payment.received',
      'ar.invoice.voided',
      'ar.late-fee.applied',
      // Desde las acciones de cobrar (0130).
      'ar.payment.reversed',
      'ar.credit-note.issued',
      'ar.credit.overridden',
    ],
    listens: ['sales-orders.order.delivered'],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
