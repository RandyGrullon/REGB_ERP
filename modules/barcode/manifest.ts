import { defineModule } from '@regb/module-registry'

/**
 * Codigos de barra & RFID — modulo 52 del catalogo (§5.4, F8/S48).
 *
 * Escribe sobre `products.barcode`, que ya existia (0016) con su
 * indice unico parcial -no agrega columna nueva-. Genera EAN-13 real
 * (generarEan13()/digitoVerificadorEan13(), @regb/operations), dibuja
 * el codigo de barras completo para imprimir (patronBarrasEan13(),
 * sin libreria externa), y escanea con la camara del celular via
 * BarcodeDetector cuando el navegador lo soporta, con entrada manual
 * como respaldo -identico a como trabaja un lector fisico-.
 *
 * Sin RFID: el nombre lo menciona, pero no hay hardware de lectura
 * RFID que integrar. Optico solamente.
 */
export default defineModule({
  id: 'barcode',
  name: 'Códigos de barra & RFID',
  description: 'Generacion, etiquetas y escaneo con la camara del celular.',
  icon: 'qr_code_scanner',
  category: 'standard',
  version: '0.1.0',

  navSection: 'inventario',
  navOrder: 51,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: ['products'],
  recommends: [],

  permissions: ['barcode.view', 'barcode.generate', 'barcode.scan'],

  routes: [
    { path: '/codigos-barra', label: 'Codigos de barra', perm: 'barcode.view' },
    { path: '/codigos-barra/etiquetas', label: 'Etiquetas', perm: 'barcode.view' },
    { path: '/codigos-barra/escaneo', label: 'Escaneo', perm: 'barcode.scan' },
  ],

  dashboardWidgets: ['products-without-barcode'],
  reports: [],

  events: {
    emits: ['barcode.code.generated', 'barcode.product.scanned'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'scan'],
})
