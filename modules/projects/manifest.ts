import { defineModule } from '@regb/module-registry'

/**
 * Proyectos & Tareas — modulo 71 del catalogo (§5.3, F10/S67).
 *
 * Primer modulo de F10. No es un vertical -no le aplica la "regla de
 * oro" de §12.1 que exige un cliente pagando antes de publicar
 * restaurant/clinic/etc-.
 *
 * Una tarea no puede avanzar a en curso o hecha con dependencias
 * abiertas -lo exige un trigger de base de datos, no solo la UI-.
 *
 * Deliberadamente SIN requires; recomienda `timesheets`.
 */
export default defineModule({
  id: 'projects',
  name: 'Proyectos & Tareas',
  description: 'Kanban, Gantt, dependencias, hitos y plantillas.',
  icon: 'view_kanban',
  category: 'standard',
  version: '0.1.0',

  navSection: 'operacion',
  navOrder: 93,

  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },

  requires: [],
  recommends: ['timesheets'],

  permissions: ['projects.view', 'projects.manage'],

  routes: [
    { path: '/proyectos', label: 'Proyectos & Tareas', perm: 'projects.view' },
    { path: '/proyectos/:id', label: 'Detalle del proyecto', perm: 'projects.view', hidden: true },
  ],

  dashboardWidgets: ['projects-overdue-milestones'],
  reports: [],

  events: {
    emits: ['projects.task.completed'],
    listens: [],
  },

  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['projects.view', 'projects.manage'],
})
