/**
 * Contenido de los tours (§5.1 core 14, S13).
 *
 * Los pasos son DATOS, no codigo: cada modulo aporta su tour y el motor
 * los pinta igual. Un modulo nuevo trae su tour sin tocar el core.
 */

export interface TourStep {
  title: string
  body: string
  /** A donde lleva "Hazlo ahora". Relativo, sin query string. */
  action?: { label: string; path: string }
  /** Lo que sabe quien ya lleva tiempo usando un ERP. */
  tip?: string
}

export interface Tour {
  id: string
  /** Modulo que lo aporta: si no esta licenciado, el tour no aparece. */
  moduleId: string
  title: string
  summary: string
  xp: number
  steps: TourStep[]
}

export const TOURS: Tour[] = [
  {
    id: 'core.bienvenida',
    moduleId: 'tour',
    title: 'Primeros pasos en REGB',
    summary: 'Lo minimo para dejar de usar Excel: tu empresa, tu gente y tu catalogo.',
    xp: 50,
    steps: [
      {
        title: 'Confirma los datos de tu empresa',
        body: 'Tu razon social y tu RNC salen en cada factura. Revisalos una vez y olvidate.',
        action: { label: 'Ir a Empresas', path: '/empresas' },
        tip: 'Si facturas con mas de un RNC, agregalos todos ahora: cambiar despues obliga a re-emitir comprobantes.',
      },
      {
        title: 'Abre tus sucursales',
        body: 'Cada local, almacen o punto de venta es una sucursal. El inventario se cuenta por sucursal.',
        action: { label: 'Ir a Sucursales', path: '/sucursales' },
      },
      {
        title: 'Invita a tu equipo',
        body: 'Cada quien entra con su propio usuario. Nunca compartas una clave: la bitacora deja de servir si dos personas son "el mismo" usuario.',
        action: { label: 'Ir a Usuarios', path: '/usuarios' },
        tip: 'Empieza con roles estrechos. Ampliar permisos es facil; explicar un descuadre no.',
      },
      {
        title: 'Sube tu catalogo',
        body: 'Exporta tus productos a CSV desde donde los tengas hoy y subelos. Si algo sale mal, deshaces la importacion completa.',
        action: { label: 'Ir a Importar', path: '/importar' },
      },
      {
        title: 'Ajusta lo que ve cada rol',
        body: 'El cajero no necesita ver los costos. Oculta modulos por rol y la ruta directa devuelve 403, no datos.',
        action: { label: 'Ir a Roles y permisos', path: '/roles' },
      },
    ],
  },
  {
    id: 'core.permisos',
    moduleId: 'rbac',
    title: 'Como ocultar modulos a un rol',
    summary: 'Quien ve que, y por que la URL directa tampoco funciona.',
    xp: 30,
    steps: [
      {
        title: 'Un rol es una lista de permisos',
        body: 'Cada modulo declara los suyos (ver, crear, editar, borrar). El rol concede o niega.',
        action: { label: 'Abrir Roles', path: '/roles' },
      },
      {
        title: 'Negar siempre gana',
        body: 'Si un rol concede "ventas.*" pero niega "ventas.descuento", el descuento queda negado. La denegacion pesa mas que el comodin.',
      },
      {
        title: 'El servidor tambien comprueba',
        body: 'Ocultar el boton no es seguridad. Cada ruta y cada accion vuelven a verificar el permiso en el servidor, y la base de datos filtra por su cuenta.',
        tip: 'Pruebalo: cambia de rol arriba a la derecha y escribe una ruta que ese rol no tenga. Sale 404.',
      },
    ],
  },
  {
    id: 'core.marketplace',
    moduleId: 'marketplace',
    title: 'Como funciona el marketplace',
    summary: 'Empieza con lo minimo y agrega piezas cuando el negocio las pida.',
    xp: 20,
    steps: [
      {
        title: 'Pagas por lo que activas',
        body: 'Cada modulo tiene precio de instalacion y mensualidad, distintos segun tu plan. Lo ves antes de activar.',
        action: { label: 'Abrir Marketplace', path: '/marketplace' },
      },
      {
        title: 'Prueba 14 dias gratis',
        body: 'Casi todo modulo se puede probar. Si no lo activas al terminar, deja de verse — pero tus datos quedan intactos por si vuelves.',
      },
      {
        title: 'Desinstalar nunca borra',
        body: 'Apagar un modulo lo esconde y deja de cobrarse. Los datos siguen ahi el dia que lo reactives.',
      },
    ],
  },
]

export function toursFor(licensedModules: Set<string>): Tour[] {
  return TOURS.filter((t) => licensedModules.has(t.moduleId))
}
