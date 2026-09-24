import { defineModule } from '@regb/module-registry'

/**
 * Chat interno — modulo 92 del catalogo (§5.3, F9/S65-66).
 *
 * Un mensaje enviado es un hecho historico: inmutable desde el
 * insert, igual que un mensaje de ticket. Las menciones se eligen de
 * la lista real de usuarios del tenant al componer el mensaje -nunca
 * se parsean de texto libre-.
 *
 * Deliberadamente SIN requires: un canal es util aunque el negocio no
 * tenga ningun otro modulo activo.
 */
export default defineModule({
  id: 'chat',
  name: 'Chat interno',
  description: 'Canales por módulo, proyecto o sucursal, con hilos y menciones.',
  icon: 'chat',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 91,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: [],

  permissions: ['chat.view', 'chat.manage'],

  routes: [
    { path: '/chat', label: 'Chat interno', perm: 'chat.view' },
    { path: '/chat/:id', label: 'Canal', perm: 'chat.view', hidden: true },
  ],

  dashboardWidgets: ['chat-mentions-pending'],
  reports: [],

  events: {
    emits: ['chat.message.posted'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['chat.view', 'chat.manage'],
})
