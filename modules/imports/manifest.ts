import { defineModule } from '@regb/module-registry'

/** Importar / Exportar — modulo core 11 (§5.1). Con deshacer. */
export default defineModule({
  id: 'imports',
  name: 'Importar',
  description: 'Trae tus datos desde CSV con mapeo de columnas, validacion previa y deshacer.',
  icon: 'upload_file',
  category: 'core',
  version: '0.1.0',

  navSection: 'datos',
  navOrder: 10,
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },

  /**
   * Importar productos exige poder crear productos: el permiso del modulo
   * DESTINO manda, no solo el de importar. Se declara aqui para que esa
   * dependencia sea dato y no un acoplamiento escondido en el codigo —
   * `audit:registry` solo tolera referencias a lo que este declarado.
   */
  requires: ['products'],
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
