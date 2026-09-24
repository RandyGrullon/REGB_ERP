import { defineModule } from '@regb/module-registry'

/** Respaldos — modulo core 15 (§5.1). */
export default defineModule({
  id: 'backup',
  name: 'Respaldos',
  description: 'Copias de tus datos bajo demanda, descargables. Tu información es tuya.',
  icon: 'backup',
  category: 'core',
  version: '0.1.0',

  navSection: 'datos',
  navOrder: 30,
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: ['backup.view', 'backup.create', 'backup.edit', 'backup.delete', 'backup.export'],
  routes: [{ path: '/respaldos', label: 'Respaldos', perm: 'backup.view' }],

  // Payload con numeros e ids, nunca con datos: el outbox lo leen
  // automatizaciones y webhooks que salen a sistemas de terceros.
  //  - created: lo emite public.crear_respaldo() (0122), en la misma
  //    transaccion. { backup_id, kind, tablas, filas, size_bytes }
  //  - downloaded: la ruta de descarga, la PRIMERA vez que el archivo
  //    sale completo. { backup_id, formato }
  events: {
    emits: ['backup.snapshot.created', 'backup.snapshot.downloaded'],
    listens: [],
  },
  platforms: { web: true, desktop: true, mobile: false },
})
