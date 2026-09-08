import { defineModule } from '@regb/module-registry'

/**
 * Portal de clientes — modulo 39 del catalogo (§5.3, F9/S58).
 *
 * El acceso del cliente es por invitacion con token -no un sistema de
 * autenticacion completo-. La pagina publica que el cliente visita
 * (`/portal-cliente/[token]`) NO pasa por el registry de modulos ni
 * por sesion de tenant -por eso no aparece en `routes` aqui abajo-:
 * usa la conexion de servicio, filtrando todo por el tenant/cliente
 * que el token exacto devuelve.
 *
 * Deliberadamente SIN requires. Recomienda `ar` para cuando el
 * cliente ya tiene facturas formales que ver en su portal.
 */
export default defineModule({
  id: 'customer-portal',
  name: 'Portal de clientes',
  description: 'El cliente ve sus facturas, paga, descarga y abre tickets.',
  icon: 'open_in_new',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 83,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['ar'],

  permissions: ['customer-portal.view', 'customer-portal.manage'],

  routes: [{ path: '/portal-clientes', label: 'Portal de clientes', perm: 'customer-portal.view' }],

  dashboardWidgets: ['portal-active-invites'],
  reports: ['portal-access-by-customer'],

  events: {
    emits: ['customer-portal.invite.activated', 'customer-portal.invite.revoked'],
    listens: [],
  },

  platforms: { web: true, desktop: false, mobile: true },
  mobileScope: ['customer-portal.view'],
})
