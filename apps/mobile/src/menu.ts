/**
 * Que secciones existen en el telefono.
 *
 * ── Por que es un dato aparte y no esta en la pantalla ────────────────
 *
 * Para poder comprobarlo. Un `permiso` mal escrito -un punto de mas, un
 * modulo renombrado- no da error: simplemente `can()` devuelve false y
 * la seccion desaparece del menu para TODO el mundo, en silencio. La
 * prueba de `menu.test.ts` cruza esta tabla con los manifests y se cae
 * si alguno no existe.
 *
 * ── Por que vive en la app y no en el core ────────────────────────────
 *
 * Porque es la app la que sabe que pantallas tiene compiladas. El core
 * no puede conocer modulos (§2.2), y una lista de rutas de expo-router
 * no le sirve de nada.
 *
 * Cada modulo declara en su manifest que parte suya vale la pena en un
 * telefono (`mobileScope`). Esta tabla es la otra mitad: lo que de eso
 * ya esta construido.
 */
export interface Seccion {
  moduleId: string
  /** El permiso que hace falta para que la pantalla sirva de algo. */
  permiso: string
  titulo: string
  descripcion: string
  ruta: string
}

export const SECCIONES: Seccion[] = [
  {
    moduleId: 'inventory',
    permiso: 'inventory.view',
    titulo: 'Existencias',
    descripcion: 'Cuanto hay y en que almacen, desde el piso de venta',
    ruta: '/(app)/existencias',
  },
  {
    moduleId: 'inventory',
    // Contar es ESCRIBIR: no basta con poder ver el inventario.
    permiso: 'inventory.count',
    titulo: 'Contar inventario',
    descripcion: 'Los conteos abiertos, para hacerlos de pie en el almacen',
    ruta: '/(app)/conteos',
  },
  {
    moduleId: 'inventory',
    permiso: 'inventory.transfer',
    titulo: 'Transferir',
    descripcion: 'Mover mercancia de un almacen a otro sin papeles',
    ruta: '/(app)/transferir',
  },
  {
    moduleId: 'time-off',
    // `request` y no `view`: la pantalla existe para PEDIR. Quien solo
    // puede mirar lo hace mejor desde la computadora.
    permiso: 'time-off.request',
    titulo: 'Vacaciones',
    descripcion: 'Pedir dias libres y ver en que va lo que pediste',
    ruta: '/(app)/vacaciones',
  },
  {
    moduleId: 'expenses',
    permiso: 'expenses.submit',
    titulo: 'Gastos',
    descripcion: 'Reportar un gasto cuando te dan el comprobante',
    ruta: '/(app)/gastos',
  },
  {
    moduleId: 'chat',
    permiso: 'chat.view',
    titulo: 'Chat interno',
    descripcion: 'Lo que se habla del trabajo, donde se trabaja',
    ruta: '/(app)/chat',
  },
]
