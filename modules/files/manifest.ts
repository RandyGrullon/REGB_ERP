import { defineModule } from '@regb/module-registry'

/** Gestor documental — modulo core 10 (§5.1). */
export default defineModule({
  id: 'files',
  name: 'Archivos',
  description: 'Documentos del negocio: sube, descarga y organiza. Nada se borra de verdad.',
  icon: 'folder_open',
  category: 'core',
  version: '0.1.0',

  navSection: 'datos',
  navOrder: 20,
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: ['files.view', 'files.create', 'files.edit', 'files.delete', 'files.export'],
  routes: [{ path: '/archivos', label: 'Archivos', perm: 'files.view' }],
  events: { emits: ['files.file.uploaded'], listens: [] },
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'upload'],
})
