import { defineModule } from '@regb/module-registry'

/** Sucursales & Ubicaciones — modulo core 4 (§5.1). */
export default defineModule({
  id: 'branches',
  name: 'Sucursales',
  description: 'Sucursales y ubicaciones de cada empresa, con acceso por rol y por sucursal.',
  icon: 'storefront',
  category: 'core',
  version: '0.1.0',

  navSection: 'administracion',
  navOrder: 30,
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: [
    'branches.view',
    'branches.create',
    'branches.edit',
    'branches.delete',
    'branches.export',
  ],
  routes: [{ path: '/sucursales', label: 'Sucursales', perm: 'branches.view' }],
  events: { emits: ['branches.branch.created'], listens: [] },
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
