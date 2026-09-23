import { defineModule } from '@regb/module-registry'

/**
 * Nomina — modulo 62 del catalogo (§5.6, F7/S37-38).
 *
 * No corre en movil a proposito: nadie cierra una nomina de 300 empleados
 * desde el celular, y exponerla ahi solo agrega superficie de riesgo.
 *
 * Requiere `employees` de verdad -payroll_lines referencia
 * public.employees, sin empleados no hay a quien pagarle-. El scaffold
 * original de este manifest traia requires vacio porque se escribio
 * antes de que existiera employees; corregido en la 0052, mismo criterio
 * que la 0043/0047 ya aplicaron para accounting/ap/budgets.
 *
 * Recomienda `benefits` y `expenses` desde 0132: con ellos activos, la
 * nomina descuenta las cuotas de prestamos y paga los reembolsos
 * asignados al periodo. Sin ellos, simplemente no hay nada que descontar
 * ni que reembolsar -la RLS devuelve cero filas-.
 */
export default defineModule({
  id: 'payroll',
  name: 'Nomina',
  description: 'Calculo con TSS, AFP, ARS e ISR; prestaciones, regalia y volantes.',
  icon: 'group',
  category: 'advanced',
  version: '0.1.0',

  navSection: 'rrhh',
  navOrder: 70,

  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
    perUser: { pyme: 0, mediano: 2, grande: 2 },
  },

  requires: ['employees'],
  recommends: ['accounting', 'benefits', 'expenses'],

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

  dashboardWidgets: ['payroll-next-run', 'payroll-cost'],
  reports: ['payroll-summary', 'tss-report'],
  events: { emits: ['payroll.period.closed'], listens: [] },

  platforms: { web: true, desktop: true, mobile: false },
  mobileScope: [],
})
