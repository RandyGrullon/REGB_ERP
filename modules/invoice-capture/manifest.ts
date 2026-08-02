import { defineModule } from '@regb/module-registry'

/**
 * Captura de facturas — modulo 93 del catalogo (§5.2).
 *
 * Fotografias la factura del proveedor y el sistema extrae RNC, NCF, fecha,
 * ITBIS y lineas. En RD el 606 se arma con estas facturas: teclearlas una a
 * una es donde una contabilidad pierde mas horas y comete mas errores.
 *
 * DOS REGLAS QUE NO SE NEGOCIAN:
 *
 * 1. NUNCA contabiliza solo. Siempre genera un borrador que una persona
 *    aprueba. Una extraccion con 94% de confianza sigue siendo un 6% de
 *    facturas mal contabilizadas, y en fiscalidad eso no se perdona.
 *
 * 2. La imagen se cifra y se purga a los 90 dias de aprobada la factura.
 *    Contiene RNC y montos de terceros; el dato que importa ya vive en `ap`.
 */
export default defineModule({
  id: 'invoice-capture',
  name: 'Captura de facturas',
  description: 'Fotografia la factura del proveedor y extrae RNC, NCF, fecha, ITBIS y lineas.',
  icon: 'document_scanner',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 60,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
    // Cada documento consume OCR y un modelo de vision: sin consumo medido,
    // el cliente que sube 3.000 facturas al mes se come el margen entero.
    metered: [{ key: 'document', included: 100, overageUnit: 1, price: 0.04 }],
  },

  requires: [],
  // Funciona solo — un contador externo que lleva 15 empresas pequenas lo
  // quiere sin comprar contabilidad completa. Con `ap` crea la factura directa.
  recommends: ['ap', 'taxes', 'files'],

  permissions: [
    'invoice-capture.view',
    'invoice-capture.upload',
    'invoice-capture.review',
    'invoice-capture.approve',
    'invoice-capture.reject',
    'invoice-capture.export',
  ],

  routes: [
    { path: '/invoice-capture', label: 'Bandeja', perm: 'invoice-capture.view' },
    { path: '/invoice-capture/review', label: 'Por revisar', perm: 'invoice-capture.review' },
    { path: '/invoice-capture/history', label: 'Historial', perm: 'invoice-capture.view' },
    {
      path: '/invoice-capture/:id',
      label: 'Documento',
      perm: 'invoice-capture.view',
      hidden: true,
    },
  ],

  dashboardWidgets: ['pending-review', 'capture-accuracy'],
  reports: ['extraction-quality', 'monthly-volume'],

  events: {
    emits: ['invoice-capture.document.extracted', 'invoice-capture.document.rejected'],
    listens: [],
  },

  // Movil-primero: el caso real es fotografiar la factura al recibir la
  // mercancia, no subirla desde un escritorio tres dias despues.
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['upload', 'view'],
})
