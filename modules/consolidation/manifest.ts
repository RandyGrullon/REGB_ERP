import { defineModule } from '@regb/module-registry'

/**
 * Consolidacion — modulo 28 del catalogo (§5, F11/S80).
 *
 * Suma los estados de varias empresas del mismo cliente en una sola
 * balanza de grupo, quitando lo que se deben y se venden entre ellas. La
 * hoja de trabajo -una columna por empresa, una de eliminaciones, una
 * consolidada- se calcula en buildConsolidationWorksheet()
 * (@regb/operations), no en SQL: se pinta en vivo mientras el contador
 * teclea eliminaciones sobre una corrida en borrador.
 *
 * Exige `accounting` (de ahi salen los saldos) y `orgs` (de ahi salen las
 * empresas). Sin cualquiera de los dos no hay nada que consolidar, asi que
 * es requires, no recommends.
 *
 * Sin movil: una consolidacion es una hoja de siete columnas que alguien
 * revisa cuenta por cuenta. En una pantalla de telefono no se lee.
 */
export default defineModule({
  id: 'consolidation',
  name: 'Consolidacion',
  description: 'Estados consolidados multi-empresa con eliminaciones inter-compania.',
  icon: 'layers',
  category: 'enterprise',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 67,

  pricing: {
    install: { pyme: 0, mediano: 0, grande: 12000 },
    monthly: { pyme: 0, mediano: 0, grande: 900 },
  },

  requires: ['accounting', 'orgs'],
  recommends: [],

  permissions: [
    'consolidation.view',
    'consolidation.group.manage',
    'consolidation.run.create',
    'consolidation.elimination.create',
    'consolidation.run.close',
    'consolidation.export',
  ],

  routes: [
    { path: '/consolidacion', label: 'Consolidacion', perm: 'consolidation.view' },
    {
      path: '/consolidacion/:id',
      label: 'Corrida de consolidacion',
      perm: 'consolidation.view',
      hidden: true,
    },
  ],

  dashboardWidgets: ['consolidation-impacto', 'consolidation-ultima-corrida'],
  reports: ['consolidation-worksheet'],

  events: {
    emits: ['consolidation.run.created', 'consolidation.run.closed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
