import { defineModule } from '@regb/module-registry'

/**
 * Fidelizacion — modulo 38 del catalogo (§5.3, F9/S59).
 *
 * El saldo de puntos se deriva del historial de transacciones -nunca
 * se guarda-, mismo criterio que el saldo de una cuenta bancaria en
 * treasury. El nivel (bronce/plata/oro) se decide por puntos de por
 * vida GANADOS, no por el saldo actual: redimir un premio nunca baja
 * de nivel a nadie.
 *
 * Deliberadamente SIN requires: la fidelizacion es util aunque el
 * negocio todavia no venda por caja. Recomienda `pos` para ganar
 * puntos automaticamente en cada venta.
 */
export default defineModule({
  id: 'loyalty',
  name: 'Fidelización',
  description: 'Puntos, niveles, cupones, referidos y monedero del cliente.',
  icon: 'redeem',
  category: 'standard',
  version: '0.1.0',

  navSection: 'ventas',
  navOrder: 85,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['pos'],

  permissions: ['loyalty.view', 'loyalty.manage'],

  routes: [
    { path: '/fidelizacion', label: 'Fidelizacion', perm: 'loyalty.view' },
    { path: '/fidelizacion/cupones', label: 'Cupones', perm: 'loyalty.view' },
    { path: '/fidelizacion/:customerId', label: 'Monedero del cliente', perm: 'loyalty.view', hidden: true },
  ],

  dashboardWidgets: ['loyalty-active-coupons'],
  reports: ['loyalty-points-issued-vs-redeemed'],

  events: {
    emits: ['loyalty.referral.completed', 'loyalty.coupon.redeemed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['loyalty.view'],
})
