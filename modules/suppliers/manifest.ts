import { defineModule } from '@regb/module-registry'

/**
 * Proveedores — modulo 42 del catalogo (§5.4, F8/S43).
 *
 * La ficha basica (public.suppliers) ya existia desde purchase-orders
 * (0038) y ap (0042) -este modulo agrega documentos con vigencia
 * calculada, cuentas bancarias y evaluacion, y amplia la RLS de la
 * ficha basica para que purchase-orders, ap O suppliers la desbloqueen-.
 */
export default defineModule({
  id: 'suppliers',
  name: 'Proveedores',
  description: 'Ficha, evaluacion, documentos y homologacion.',
  icon: 'local_shipping',
  category: 'standard',
  version: '0.1.0',

  navSection: 'inventario',
  navOrder: 43,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['ap'],

  permissions: [
    'suppliers.view',
    'suppliers.manage',
    'suppliers.manage-documents',
    'suppliers.evaluate',
  ],

  routes: [{ path: '/proveedores', label: 'Proveedores', perm: 'suppliers.view' }],

  dashboardWidgets: ['suppliers-expiring-docs', 'suppliers-pending-qualification'],
  reports: ['supplier-scorecard'],

  events: {
    emits: ['suppliers.evaluation.recorded', 'suppliers.qualification.changed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
