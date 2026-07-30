import { defineModule } from '@regb/module-registry'

/** Multi-empresa — modulo core 3 (§5.1). Varias razones sociales (RNC) bajo un tenant. */
export default defineModule({
  id: 'orgs',
  name: 'Empresas',
  description: 'Varias razones sociales (RNC) bajo la misma cuenta, con herencia de configuracion.',
  icon: 'Building2',
  category: 'core',
  version: '0.1.0',
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: ['orgs.view', 'orgs.create', 'orgs.edit', 'orgs.delete', 'orgs.export'],
  routes: [{ path: '/empresas', label: 'Empresas', perm: 'orgs.view' }],
  events: { emits: ['orgs.company.created'], listens: [] },
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
