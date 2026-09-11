import { defineModule } from '@regb/module-registry'

/**
 * Facturacion electronica — modulo 25 del catalogo (§5.2, F6).
 *
 * La ley 32-23 lo vuelve obligatorio para un negocio pequeño desde el
 * 15 de noviembre de 2026.
 *
 * Lo que casi nadie ve venir: esto NO es un cliente HTTP. Al postular,
 * el contribuyente declara TRES URL suyas y la DGII le pega a ellas. Por
 * eso el modulo expone rutas publicas ademas de su pantalla, y por eso
 * cada tenant tiene un token opaco en esas URL -sin sesion, el token es
 * lo unico que dice de quien es un comprobante que llega-.
 *
 * Sin `requires` a proposito: recomienda `taxes`, pero un negocio puede
 * necesitar emitir e-CF antes de tener toda su contabilidad montada, y
 * la ley no espera.
 */
export default defineModule({
  id: 'e-invoice',
  name: 'Facturacion electronica',
  description: 'e-CF de la DGII, acuses, modo contingencia y las URL que la DGII invoca.',
  icon: 'receipt_long',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 27,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: ['taxes'],

  permissions: ['e-invoice.view', 'e-invoice.manage', 'e-invoice.emit'],

  routes: [
    { path: '/facturacion-electronica', label: 'Facturacion electronica', perm: 'e-invoice.view' },
  ],

  dashboardWidgets: ['ecf-por-remitir'],
  reports: [],

  events: {
    emits: ['e-invoice.ecf.emitido', 'e-invoice.ecf.recibido'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
