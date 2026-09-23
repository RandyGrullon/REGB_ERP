import { defineModule } from '@regb/module-registry'

/** Usuarios & Perfiles — modulo core 2 (§5.1). */
export default defineModule({
  id: 'users',
  name: 'Usuarios',
  description: 'Miembros del equipo: perfiles, invitaciones y acceso por rol.',
  icon: 'group',
  category: 'core',
  version: '0.1.0',

  navSection: 'administracion',
  navOrder: 10,
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: ['users.view', 'users.create', 'users.edit', 'users.delete', 'users.export'],
  routes: [{ path: '/usuarios', label: 'Usuarios', perm: 'users.view' }],
  // invited: crear_invitacion() (0123) · joined: aceptar_invitacion() (0123)
  // · deactivated: alternarActivo() en /usuarios. Los tres por el outbox.
  events: {
    emits: ['users.member.invited', 'users.member.joined', 'users.member.deactivated'],
    listens: [],
  },
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})
