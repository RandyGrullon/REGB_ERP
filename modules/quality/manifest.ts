import { defineModule } from '@regb/module-registry'

/**
 * Control de calidad — modulo 58 del catalogo (§5.5, F8.5/S53).
 *
 * Resultado de inspeccion NO binario: un criterio critico reprobado
 * reprueba la inspeccion entera; uno menor la deja "condicional"
 * (resultadoInspeccion() en @regb/operations). Una no conformidad
 * solo se cierra pasando por un CAPA -no hay atajo directo a cerrada-,
 * y un CAPA solo se cierra despues de verificar la correccion.
 *
 * Deliberadamente SIN requires: una inspeccion de recepcion es util
 * para cualquier distribuidor, fabrique o no. Recomienda
 * `manufacturing` para quien ya tiene control de calidad en proceso.
 */
export default defineModule({
  id: 'quality',
  name: 'Control de calidad',
  description: 'Planes de inspeccion, no conformidades, CAPA y certificados.',
  icon: 'verified',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 57,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: ['manufacturing'],

  permissions: ['quality.view', 'quality.inspect', 'quality.manage'],

  routes: [
    { path: '/calidad', label: 'Control de calidad', perm: 'quality.view' },
    { path: '/calidad/planes', label: 'Planes de inspeccion', perm: 'quality.manage' },
    { path: '/calidad/planes/:id', label: 'Detalle del plan', perm: 'quality.manage', hidden: true },
    { path: '/calidad/inspecciones/nueva', label: 'Nueva inspeccion', perm: 'quality.inspect', hidden: true },
    { path: '/calidad/inspecciones/:id', label: 'Detalle de inspeccion', perm: 'quality.view', hidden: true },
    { path: '/calidad/no-conformidades', label: 'No conformidades', perm: 'quality.view' },
    { path: '/calidad/no-conformidades/:id', label: 'Detalle', perm: 'quality.view', hidden: true },
  ],

  dashboardWidgets: ['quality-open-capas'],
  reports: ['quality-inspection-pass-rate'],

  events: {
    emits: ['quality.inspection.completed', 'quality.nonconformance.opened', 'quality.capa.closed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
