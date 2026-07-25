import { defineModule } from '@nexus/module-registry'

/**
 * Nomina — modulo 62 del catalogo (§5.6).
 *
 * No corre en movil a proposito: nadie cierra una nomina de 300 empleados
 * desde el celular, y exponerla ahi solo agrega superficie de riesgo.
 */
export default defineModule({
  id: 'payroll',
  name: 'Nomina',
  description: 'Calculo con TSS, AFP, ARS e ISR; prestaciones, regalia y volantes.',
  icon: 'Users',
  category: 'advanced',
  version: '0.1.0',

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
    perUser: { pyme: 0, mediano: 2, grande: 2 },
  },

  requires: [],
  recommends: ['accounting'],

  permissions: [
    'payroll.view',
    'payroll.run',
    'payroll.approve',
    'payroll.export',
    'payroll.view.own',
  ],

  routes: [
    { path: '/payroll', label: 'Nominas', perm: 'payroll.view' },
    { path: '/payroll/run', label: 'Procesar', perm: 'payroll.run' },
    { path: '/payroll/reports', label: 'TSS y reportes', perm: 'payroll.export' },
  ],

  dashboardWidgets: ['payroll-next-run'],
  events: { emits: ['payroll.period.closed'], listens: [] },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
