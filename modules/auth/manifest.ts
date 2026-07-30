import { defineModule } from '@regb/module-registry'

/**
 * Autenticacion & SSO — modulo core 1 (§5.1).
 *
 * El login vive fuera del shell (/login); aqui solo la pagina de perfil y
 * seguridad del usuario. MFA y SSO empresarial llegan con Supabase real.
 */
export default defineModule({
  id: 'auth',
  name: 'Mi cuenta',
  description: 'Tu perfil, tu contrasena y tus sesiones. MFA y SSO segun el plan.',
  icon: 'ShieldCheck',
  category: 'core',
  version: '0.1.0',
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: ['auth.view', 'auth.create', 'auth.edit', 'auth.delete', 'auth.export'],
  routes: [{ path: '/perfil', label: 'Mi cuenta', perm: 'auth.view', hidden: true }],
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
