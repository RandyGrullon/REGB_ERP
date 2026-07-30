import { defineModule } from '@regb/module-registry'

/** Importar / Exportar — modulo core 11 (§5.1). Con deshacer. */
export default defineModule({
  id: 'imports',
  name: 'Importar',
  description: 'Trae tus datos desde CSV con mapeo de columnas, validacion previa y deshacer.',
  icon: 'Upload',
  category: 'core',
  version: '0.1.0',
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: [
    'imports.view',
    'imports.create',
    'imports.edit',
    'imports.delete',
    'imports.export',
  ],
  routes: [{ path: '/importar', label: 'Importar', perm: 'imports.view' }],
  events: { emits: ['imports.batch.completed', 'imports.batch.undone'], listens: [] },
  platforms: { web: true, desktop: true, mobile: false },
})
