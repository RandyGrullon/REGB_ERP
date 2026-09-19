import { defineModule } from '@regb/module-registry'

/**
 * Impuestos — modulo 24 del catalogo (§5, advanced).
 *
 * Tasas de ITBIS configurables, reglas de retencion por proveedor,
 * liquidacion IT-1 y calendario de vencimientos. La logica que cambia por
 * decreto -tasas, bases de retencion, dias limite- vive en taxes.ts
 * (@regb/operations), aislada y con pruebas, por el mismo motivo que
 * dgii.ts: un cambio de norma se atiende en un archivo.
 *
 * NO incluye los formatos 606/607/608. Ya existen completos en `ap` y
 * `ar` -vistas dgii_606/607/608, /api/dgii/[reporte] y /cobrar/dgii-, y
 * el comentario del manifiesto de `accounting` que se los atribuye a este
 * modulo quedo viejo. El calendario enlaza alli en vez de duplicarlos:
 * dos verdades sobre lo que se le declara a la DGII es peor que ninguna.
 *
 * Sin `requires` a proposito. La liquidacion IT-1 SI necesita `ap` y `ar`
 * para sumar -por eso los recomienda-, pero las tasas, las reglas y el
 * calendario funcionan solos, y exigir dos modulos para poder nombrar el
 * 18% seria cobrarle al cliente tres modulos por una tabla de catalogo.
 * Cuando falta uno, la pantalla lo DICE en vez de sumar cero en silencio.
 */
export default defineModule({
  id: 'taxes',
  name: 'Impuestos',
  description:
    'Tasas de ITBIS configurables, reglas de retencion por proveedor, liquidacion IT-1 y calendario fiscal.',
  icon: 'percent',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 26,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },

  requires: [],
  recommends: ['ap', 'ar', 'accounting'],

  permissions: [
    'taxes.view',
    'taxes.rate.manage',
    'taxes.rule.manage',
    'taxes.profile.assign',
    'taxes.filing.close',
    'taxes.export',
  ],

  routes: [
    { path: '/impuestos', label: 'Impuestos', perm: 'taxes.view' },
    {
      path: '/impuestos/retenciones',
      label: 'Retenciones',
      perm: 'taxes.view',
      icon: 'account_balance_wallet',
    },
    {
      path: '/impuestos/liquidacion',
      label: 'Liquidacion IT-1',
      perm: 'taxes.view',
      icon: 'calculate',
    },
    {
      path: '/impuestos/calendario',
      label: 'Calendario fiscal',
      perm: 'taxes.view',
      icon: 'event',
    },
  ],

  dashboardWidgets: ['taxes-next-due', 'taxes-itbis-due'],
  reports: [],

  events: {
    emits: ['taxes.filing.closed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
