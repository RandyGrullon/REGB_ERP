import { defineModule } from '@regb/module-registry'

/** Auditoria — modulo core 9 (§5.1). La bitacora inmutable, visible. */
export default defineModule({
  id: 'audit',
  name: 'Auditoría',
  description: 'Quién hizo qué y cuándo: bitácora inmutable de cada cambio, con antes y después.',
  icon: 'receipt_long',
  category: 'core',
  version: '0.1.0',

  navSection: 'datos',
  navOrder: 40,
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: ['audit.view', 'audit.create', 'audit.edit', 'audit.delete', 'audit.export'],
  routes: [{ path: '/auditoria', label: 'Auditoria', perm: 'audit.view' }],
  platforms: { web: true, desktop: true, mobile: false },
})
