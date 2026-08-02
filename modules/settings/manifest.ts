import { defineModule } from '@regb/module-registry'

/** Configuracion — modulo core 13 (§5.1). Lo que el cliente decide solo. */
export default defineModule({
  id: 'settings',
  name: 'Configuracion',
  description: 'Nombre comercial, zona horaria, moneda, formato de fecha y preferencias.',
  icon: 'settings',
  category: 'core',
  version: '0.1.0',

  navSection: 'administracion',
  navOrder: 40,
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: ['settings.view', 'settings.edit', 'settings.branding.edit'],
  routes: [{ path: '/configuracion', label: 'Configuracion', perm: 'settings.view' }],
  events: { emits: ['settings.prefs.changed'], listens: [] },
  platforms: { web: true, desktop: true, mobile: false },
})
