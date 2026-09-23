import { defineModule } from '@regb/module-registry'

/**
 * Logistica & Rutas — modulo 53 del catalogo (§5.4, F8/S49).
 *
 * Planificacion de rutas y prueba de entrega -quien recibio, no una
 * firma digital-. transicionValidaRuta()/rutaCompleta()/tasaEntregaExitosa()
 * (@regb/operations) son las funciones nuevas.
 *
 * Sin GPS real -ningun dispositivo conectado- ni optimizacion de ruta
 * por distancia -pediria geocodificacion que este sistema no tiene-.
 * Sin acoplamiento duro a `fleet`: el vehiculo es texto libre (la
 * placa), no una referencia, porque logistics solo RECOMIENDA
 * sales-orders, no requiere fleet.
 */
export default defineModule({
  id: 'logistics',
  name: 'Logistica & Rutas',
  description: 'Planificacion de rutas, seguimiento GPS y prueba de entrega.',
  icon: 'route',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'inventario',
  navOrder: 53,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: ['sales-orders'],

  permissions: ['logistics.view', 'logistics.manage', 'logistics.deliver'],

  routes: [
    { path: '/rutas', label: 'Rutas', perm: 'logistics.view' },
    { path: '/rutas/:id', label: 'Detalle', perm: 'logistics.view', hidden: true },
  ],

  dashboardWidgets: ['routes-in-progress'],
  reports: ['delivery-success-rate'],

  events: {
    emits: ['logistics.route.completed', 'logistics.stop.delivered'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'deliver'],
})
