/**
 * A donde se puede mandar a alguien despues de entrar.
 *
 * `siguiente` llega en la URL (/login?siguiente=...) y no es de fiar: sin
 * este filtro, un enlace preparado -`/login?siguiente=//otro-sitio.com`-
 * dejaba a la persona, con la sesion recien abierta, en un dominio ajeno
 * que imita el login. `startsWith('/')` no basta: `//x.com` y `/\x.com`
 * empiezan por `/` y el navegador los lee como otro dominio.
 *
 * Solo pasan rutas de ESTA app. Cualquier otra cosa vuelve al inicio.
 */
export function rutaInterna(valor: string | null | undefined): string {
  if (!valor || !valor.startsWith('/')) return '/'
  if (valor.startsWith('//')) return '/'
  // `\` lo normaliza el navegador a `/`; y un control (tab, salto) lo
  // borra antes de interpretar la URL: `/\t/x.com` acaba en `//x.com`.
  // eslint-disable-next-line no-control-regex -- justo lo que se quiere rechazar
  if (/[\\\u0000-\u001f\u007f]/.test(valor)) return '/'
  return valor
}
