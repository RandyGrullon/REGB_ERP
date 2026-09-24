import { defineModule } from '@regb/module-registry'

/**
 * Conciliacion bancaria — modulo 20 del catalogo (§5, F6/S30-31).
 *
 * Importa las lineas del estado de cuenta del banco y las empareja
 * contra los movimientos que `treasury` (19) ya registro. El
 * "emparejamiento asistido con IA" del catalogo es un heuristico
 * determinista -mismo monto, mismo signo, fecha cercana-, nunca un
 * modelo entrenado, y SIEMPRE es una sugerencia: la persona confirma
 * cada emparejamiento, el sistema nunca concilia solo.
 */
export default defineModule({
  id: 'bank-rec',
  name: 'Conciliación bancaria',
  description: 'Import de estados de cuenta y emparejamiento asistido con partidas pendientes.',
  icon: 'compare_arrows',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'finanzas',
  navOrder: 63,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: ['treasury'],
  recommends: ['accounting'],

  permissions: [
    'bank-rec.view',
    'bank-rec.import.create',
    'bank-rec.match.confirm',
    'bank-rec.export',
  ],

  routes: [
    { path: '/conciliacion', label: 'Conciliación', perm: 'bank-rec.view' },
    { path: '/conciliacion/:id', label: 'Import', perm: 'bank-rec.view', hidden: true },
  ],

  dashboardWidgets: ['pending-reconciliation', 'last-import-status'],
  reports: ['reconciliation-status'],

  events: {
    emits: ['bank-rec.import.created', 'bank-rec.line.matched'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
