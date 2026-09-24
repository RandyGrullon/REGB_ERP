import { defineModule } from '@regb/module-registry'

/**
 * Activos fijos — modulo 21 del catalogo (§5, F6/S34).
 *
 * Alta, depreciacion (linea recta o acelerada), revaluo y baja. El saldo
 * en libros se deriva siempre de la base actual menos la depreciacion
 * acumulada -nunca se guarda-. Cada corrida de depreciacion y cada
 * revaluo son registros historicos inmutables.
 */
export default defineModule({
  id: 'fixed-assets',
  name: 'Activos fijos',
  description: 'Alta, depreciación, revalúo y baja de vehículos, equipos y otros activos.',
  icon: 'directions_car',
  category: 'standard',
  version: '0.1.0',

  navSection: 'finanzas',
  navOrder: 64,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['accounting'],

  permissions: [
    'fixed-assets.view',
    'fixed-assets.asset.create',
    'fixed-assets.depreciation.run',
    'fixed-assets.asset.revalue',
    'fixed-assets.asset.dispose',
    'fixed-assets.export',
  ],

  routes: [
    { path: '/activos-fijos', label: 'Activos fijos', perm: 'fixed-assets.view' },
    { path: '/activos-fijos/:id', label: 'Activo', perm: 'fixed-assets.view', hidden: true },
  ],

  dashboardWidgets: ['fixed-assets-book-value', 'fixed-assets-due-this-month'],
  reports: ['depreciation-schedule', 'fixed-asset-register'],

  events: {
    emits: [
      'fixed-assets.asset.created',
      'fixed-assets.depreciation.run',
      'fixed-assets.asset.disposed',
    ],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
