import { defineModule } from '@regb/module-registry'

/**
 * Servicio en campo — modulo 74 del catalogo (§5.7, F10/S69).
 *
 * Movil-primero de verdad (§13.5): el tecnico no lleva laptop al sitio.
 * La regla que sostiene el modulo es que una orden no se cierra con
 * pasos obligatorios del checklist sin marcar ni sin la firma de quien
 * recibio -y esa regla vive en un trigger, no en la pantalla, porque el
 * telefono del tecnico es un cliente remoto y no se le cree nada-.
 *
 * Sin `requires`: un plomero que compra el repuesto en la ferreteria de
 * la esquina no tiene inventario y aun asi necesita ordenes de servicio.
 */
export default defineModule({
  id: 'field-service',
  name: 'Servicio en campo',
  description: 'Órdenes de servicio, agenda de técnicos, checklist móvil y repuestos.',
  icon: 'handyman',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'proyectos',
  navOrder: 97,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: ['inventory'],

  permissions: ['field-service.view', 'field-service.manage', 'field-service.execute'],

  routes: [{ path: '/servicio-en-campo', label: 'Servicio en campo', perm: 'field-service.view' }],

  dashboardWidgets: ['field-service-open'],
  reports: [],

  events: {
    emits: ['field-service.order.completed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'checklist', 'signature'],
})
