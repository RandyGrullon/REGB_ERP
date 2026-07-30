import { defineModule } from '@regb/module-registry'

/** Respaldos — modulo core 15 (§5.1). */
export default defineModule({
  id: 'backup',
  name: 'Respaldos',
  description: 'Copias de tus datos bajo demanda, descargables. Tu informacion es tuya.',
  icon: 'DatabaseBackup',
  category: 'core',
  version: '0.1.0',
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: ['backup.view', 'backup.create', 'backup.edit', 'backup.delete', 'backup.export'],
  routes: [{ path: '/respaldos', label: 'Respaldos', perm: 'backup.view' }],
  platforms: { web: true, desktop: true, mobile: false },
})
