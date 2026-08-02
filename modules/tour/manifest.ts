import { defineModule } from '@regb/module-registry'

/** Tutorial & Onboarding — modulo core 14 (§5.1). El ERP que te ensena a usarlo. */
export default defineModule({
  id: 'tour',
  name: 'Tutorial',
  description: 'Tours interactivos por modulo y checklist de primeros pasos con progreso.',
  icon: 'school',
  category: 'core',
  version: '0.1.0',

  navSection: 'ayuda',
  navOrder: 10,
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: ['tour.view', 'tour.create', 'tour.edit', 'tour.delete', 'tour.export'],
  routes: [{ path: '/tutorial', label: 'Tutorial', perm: 'tour.view' }],
  events: { emits: ['tour.step.completed', 'tour.finished'], listens: [] },
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
