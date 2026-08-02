import { defineModule } from '@regb/module-registry'

/**
 * Busqueda global — modulo core 6 (§5.1). Ctrl+K.
 *
 * Sin rutas propias: es una superposicion que vive en el shell y busca
 * modulos, registros, acciones y articulos del tutorial.
 */
export default defineModule({
  id: 'search',
  name: 'Busqueda global',
  description: 'Ctrl+K: encuentra modulos, registros, acciones y ayuda desde cualquier pantalla.',
  icon: 'search',
  category: 'core',
  version: '0.1.0',

  navSection: 'ayuda',
  navOrder: 20,
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: ['search.view', 'search.create', 'search.edit', 'search.delete', 'search.export'],
  routes: [],
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
