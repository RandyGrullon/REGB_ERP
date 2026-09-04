import { defineModule } from '@regb/module-registry'

/**
 * Cuentas por pagar — modulo 18 del catalogo (§5, F6/S30).
 *
 * El contraparte de `ar`, con la flecha al reves: aqui el proveedor nos
 * factura a NOSOTROS. Reusa `public.suppliers`, que ya vive en
 * `purchase-orders` -mismo patron que `customers` es de `sales-orders`
 * y lo comparten `pos`/`ar`-.
 *
 * La retencion (impuesto que a veces hay que retenerle a un proveedor y
 * pagarle a la DGII en su lugar, en vez de al proveedor) se CAPTURA, no
 * se calcula: no hay una formula fija de cuando aplica ni de cuanto, y
 * calcularla mal seria peor que dejarla en manos de quien de verdad sabe
 * si aplica en ese caso. Mismo criterio ya usado en `ar` con el cargo por
 * mora.
 */
export default defineModule({
  id: 'ap',
  name: 'Cuentas por pagar',
  description: 'Facturas de proveedor, pagos y retenciones.',
  icon: 'request_page',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 55,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['purchase-orders'],
  recommends: ['accounting'],

  permissions: [
    'ap.view',
    'ap.invoice.create',
    'ap.invoice.void',
    'ap.payment.record',
    'ap.export',
  ],

  routes: [
    { path: '/pagar', label: 'Por pagar', perm: 'ap.view' },
    { path: '/pagar/:id', label: 'Factura', perm: 'ap.view', hidden: true },
  ],

  dashboardWidgets: ['overdue-payables', 'due-this-week'],
  reports: ['aging-payable', 'supplier-statement'],

  events: {
    emits: ['ap.invoice.recorded', 'ap.invoice.paid'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
