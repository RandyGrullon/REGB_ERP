/**
 * Título de cada sección de uso (`navSection` del manifest).
 *
 * Las secciones son de USO, no de precio: cada módulo declara la suya y el
 * registry ya las devuelve ordenadas. Las usan el menú lateral (Shell) y el
 * Inicio, que agrupa los widgets igual que el menú para que un indicador
 * se busque en el mismo sitio en los dos lugares.
 *
 * Vive fuera de `Shell.tsx` a propósito: Shell es un componente de cliente
 * y lo que exporta, visto desde el servidor, es una referencia y no el
 * objeto.
 *
 * `inicio` va sin encabezado: son una o dos entradas sueltas y un título
 * encima solo mete ruido.
 */
export const TITULO_SECCION: Record<string, string> = {
  inicio: '',
  // Áreas de negocio: las mismas del marketplace.
  ventas: 'Ventas y clientes',
  inventario: 'Inventario y compras',
  finanzas: 'Finanzas e impuestos',
  rrhh: 'Recursos humanos',
  produccion: 'Producción',
  proyectos: 'Proyectos y servicios',
  industria: 'Tu industria',
  // Lo que no es de un área: BI, copiloto, chat, automatizaciones, API.
  operacion: 'Herramientas',
  administracion: 'Administración',
  datos: 'Datos',
  ayuda: 'Ayuda',
}
