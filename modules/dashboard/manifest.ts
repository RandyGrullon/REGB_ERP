import { defineModule } from '@regb/module-registry'

/**
 * Dashboard & Widgets — modulo core 5 (§5.1).
 *
 * La pantalla de inicio. Cada modulo de negocio aporta widgets via su
 * propio manifest (`dashboardWidgets`); este solo pone el lienzo.
 */
export default defineModule({
  id: 'dashboard',
  name: 'Dashboard',
  description: 'Pantalla de inicio con indicadores y widgets de cada módulo activo.',
  icon: 'space_dashboard',
  category: 'core',
  version: '0.1.0',

  navSection: 'inicio',
  navOrder: 10,
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: [
    'dashboard.view',
    'dashboard.create',
    'dashboard.edit',
    'dashboard.delete',
    'dashboard.export',
  ],
  routes: [{ path: '/', label: 'Inicio', perm: 'dashboard.view' }],
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
