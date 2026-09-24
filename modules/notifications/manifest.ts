import { defineModule } from '@regb/module-registry'

/** Notificaciones — modulo core 7 (§5.1). */
export default defineModule({
  id: 'notifications',
  name: 'Notificaciones',
  description: 'Avisos del sistema y de cada módulo: personales o para todo el equipo.',
  icon: 'notifications',
  category: 'core',
  version: '0.1.0',

  navSection: 'inicio',
  navOrder: 20,
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: [
    'notifications.view',
    'notifications.create',
    'notifications.edit',
    'notifications.delete',
    'notifications.export',
  ],
  routes: [{ path: '/notificaciones', label: 'Notificaciones', perm: 'notifications.view' }],
  events: { emits: ['notifications.notice.sent'], listens: [] },
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
