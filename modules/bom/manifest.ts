import { defineModule } from '@regb/module-registry'

/**
 * Lista de materiales / BOM — modulo 55 del catalogo (§5.4, F8.5/S50-51).
 *
 * Multinivel real (costoUnitarioMultinivel() en @regb/operations
 * resuelve recursivamente cuando un componente tiene su propia
 * receta), versiones (solo una `active` por producto a la vez;
 * corregirla crea la version siguiente), sustitutos
 * (elegirComponente() decide segun stock disponible).
 */
export default defineModule({
  id: 'bom',
  name: 'Lista de materiales',
  description: 'Multinivel, versiones, sustitutos y costeo del producto.',
  icon: 'account_tree',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 54,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: ['products'],
  recommends: ['inventory'],

  permissions: ['bom.view', 'bom.manage'],

  routes: [
    { path: '/bom', label: 'Lista de materiales', perm: 'bom.view' },
    { path: '/bom/:id', label: 'Detalle', perm: 'bom.view', hidden: true },
  ],

  dashboardWidgets: ['boms-active'],
  reports: ['bom-cost-rollup'],

  events: {
    emits: ['bom.version.activated'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
