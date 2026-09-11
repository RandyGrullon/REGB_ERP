/**
 * Donde vive el ERP, y que hacer cuando no contesta.
 *
 * Todo lo de este archivo es puro: recibe cadenas y devuelve cadenas. No
 * importa `electron` a proposito, para poder probarlo con vitest en Node
 * sin levantar un navegador. La parte que si necesita Electron (crear la
 * ventana, cargarla, reintentar) vive en `main.ts` y solo llama a esto.
 */

/** El `dev` de `apps/web` levanta Next en 3100. Ver `.claude/launch.json`. */
export const URL_DEV = 'http://localhost:3100'

/**
 * Deja la base en forma canonica o dice que no sirve.
 *
 * Se quita la barra final porque despues se concatena (`${base}/pos`) y
 * `http://x//pos` es una ruta distinta para Next: rompe el enrutado sin
 * dar un error claro.
 */
export function normalizarBase(valor: string): string | null {
  const v = valor.trim().replace(/\/+$/, '')
  if (v === '') return null
  try {
    const u = new URL(v)
    // Solo http/https. Un `file:` o un protocolo raro aqui convertiria la
    // ventana del mostrador en un visor de archivos locales.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return v
  } catch {
    return null
  }
}

export interface OrigenUrl {
  /** `REGB_URL` del entorno. Manda sobre todo: es como se depura en sitio. */
  env?: string | undefined
  /** Lo que dejo escrito el instalador en `servidor.json`. */
  configurada?: string | undefined
  /** `app.isPackaged`. */
  empaquetada: boolean
}

/**
 * Decide contra que servidor habla esta caja. `null` = no hay ninguno.
 *
 * En desarrollo cae en `localhost:3100` porque es donde corre `apps/web`.
 *
 * En el build empaquetado NO hay a donde caer, y es deliberado: `apps/web`
 * es un Next con rutas de API y server actions contra Postgres, asi que no
 * existe un "build estatico" que Electron pueda cargar desde disco. El ERP
 * es multi-tenant y vive en un servidor; el escritorio es un cliente suyo.
 * Sin URL configurada preferimos una pantalla que lo diga a un localhost
 * inventado que nunca va a responder.
 */
export function resolverUrlBase(o: OrigenUrl): string | null {
  for (const candidata of [o.env, o.configurada]) {
    if (candidata === undefined) continue
    const n = normalizarBase(candidata)
    if (n !== null) return n
  }
  return o.empaquetada ? null : URL_DEV
}

/**
 * ¿Esa URL es del propio ERP?
 *
 * Se comparan ORIGENES, no prefijos. `startsWith` compara texto y deja
 * pasar `http://localhost:31000` cuando la base es `http://localhost:3100`,
 * que es justo el truco con el que se cuela un sitio ajeno dentro de la
 * ventana de la caja — con las cookies de sesion delante.
 */
export function esNavegacionInterna(url: string, base: string | null): boolean {
  if (base === null) return false
  try {
    return new URL(url).origin === new URL(base).origin
  } catch {
    return false
  }
}

/**
 * Convierte lo que pidio la pagina en una URL de ticket imprimible.
 *
 * Devuelve `null` si apunta fuera del ERP. Sin este filtro, cualquier
 * script que llegue a la pagina podria mandar a imprimir un sitio
 * cualquiera, en silencio y a rollo lleno.
 */
export function urlDeTicket(ruta: string, base: string | null): string | null {
  if (base === null) return null
  // `//otro-sitio.com/x` es una URL protocolo-relativa: `new URL` la
  // resuelve contra OTRO dominio, no contra la base. Fuera de una.
  if (ruta.startsWith('//')) return null
  let absoluta: string
  try {
    absoluta = new URL(ruta, `${base}/`).toString()
  } catch {
    return null
  }
  return esNavegacionInterna(absoluta, base) ? absoluta : null
}

/** ¿La ventana ya esta en esa ruta? Si lo esta, recargar borraria el carrito. */
export function mismaPagina(actual: string, base: string | null, ruta: string): boolean {
  if (base === null) return false
  try {
    const a = new URL(actual)
    const b = new URL(ruta, `${base}/`)
    return a.origin === b.origin && a.pathname === b.pathname
  } catch {
    return false
  }
}

/**
 * ¿Se le puede pasar al navegador del sistema?
 *
 * `shell.openExternal` se lo entrega al sistema operativo tal cual, y el
 * sistema sabe abrir mucho mas que paginas web. Un `file:` abriria una
 * carpeta del equipo y un protocolo registrado por otro programa puede
 * llegar a ejecutar cosas. Lista blanca, no lista negra.
 */
export function esEnlaceSeguroParaAbrir(url: string): boolean {
  try {
    const p = new URL(url).protocol
    return p === 'http:' || p === 'https:' || p === 'mailto:' || p === 'tel:'
  } catch {
    return false
  }
}

/**
 * Traduce el fallo de Chromium a algo que sirva de verdad.
 *
 * El cajero no puede hacer nada con `ERR_CONNECTION_REFUSED`, pero si con
 * "el servidor no esta encendido". Y quien instala necesita saber cual de
 * los tres problemas tipicos es: no arranco, no resuelve el nombre, o el
 * certificado esta vencido.
 */
export function explicarFallo(descripcion: string): string {
  const d = descripcion.trim()
  switch (d) {
    case 'ERR_CONNECTION_REFUSED':
      return 'El servidor no acepto la conexion. Lo mas probable es que no este encendido.'
    case 'ERR_NAME_NOT_RESOLVED':
      return 'No se pudo resolver el nombre del servidor. Revisa la direccion y el DNS.'
    case 'ERR_CONNECTION_TIMED_OUT':
    case 'ERR_TIMED_OUT':
      return 'El servidor tardo demasiado en contestar. Puede ser la red del local.'
    case 'ERR_INTERNET_DISCONNECTED':
      return 'Este equipo no tiene conexion de red.'
    case 'ERR_CERT_DATE_INVALID':
    case 'ERR_CERT_AUTHORITY_INVALID':
    case 'ERR_CERT_COMMON_NAME_INVALID':
      return 'El certificado del servidor no es valido. Avisa a soporte antes de seguir.'
    default:
      return d === '' ? 'No se pudo cargar la pagina.' : d
  }
}

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface DatosPaginaError {
  /** Contra que se intento. `null` = no habia ninguna configurada. */
  base: string | null
  /** A donde manda el boton de reintentar. La misma que carga el arranque. */
  rutaInicio: string
  /** El motivo tecnico, ya traducido por `explicarFallo`. */
  detalle?: string | undefined
  /** Cada cuanto reintenta solo el proceso principal. */
  segundosReintento: number
}

/**
 * La pantalla que ve el cajero cuando el servidor no esta.
 *
 * Existe porque la alternativa de Electron es una ventana en blanco, y una
 * ventana en blanco no dice si el problema es el programa, la red o el
 * servidor. Aqui se dice exactamente que se intento, contra que direccion y
 * que hacer. Sin logos ni animaciones: es una pantalla de fallo, no un
 * producto.
 *
 * Va sin conexion a internet ninguna —fuentes del sistema, cero recursos
 * externos— porque se muestra precisamente cuando la red no funciona.
 */
export function paginaDeError(d: DatosPaginaError): string {
  const sinServidor = d.base === null
  const titulo = sinServidor
    ? 'REGB ERP no sabe a que servidor conectarse'
    : 'No se pudo conectar con el servidor de REGB ERP'

  const cuerpo = sinServidor
    ? `<p>Esta copia del programa no tiene configurada la direccion del servidor.</p>
       <p>Quien instalo el equipo tiene que dejarla en la variable de entorno
       <code>REGB_URL</code> o en el archivo <code>servidor.json</code> de la
       carpeta de datos de la aplicacion.</p>`
    : `<p>El programa esta bien; lo que no contesta es el servidor.</p>
       <p class="dato">Se intento contra <code>${escaparHtml(d.base ?? '')}</code></p>
       ${d.detalle === undefined ? '' : `<p class="dato">${escaparHtml(d.detalle)}</p>`}
       <p>Mientras tanto, <strong>las ventas que ya estaban en la cola no se
       pierden</strong>: siguen guardadas en este equipo y suben solas cuando
       el servidor vuelva.</p>`

  // El boton es un enlace normal, no un script con IPC: asi la pantalla de
  // error no necesita el puente ni una ventana aparte, y `will-navigate` la
  // deja pasar sola por ser el mismo origen del ERP.
  const reintento = sinServidor
    ? ''
    : `<p class="reintento">Reintentando solo cada ${d.segundosReintento} segundos&hellip;</p>
       <p><a class="boton" href="${escaparHtml(`${d.base ?? ''}${d.rutaInicio}`)}">Reintentar ahora</a></p>`

  return `<meta charset="utf-8">
<title>REGB ERP — sin conexion con el servidor</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.55 system-ui, "Segoe UI", sans-serif;
    background: #f6f7f9; color: #16181d;
  }
  @media (prefers-color-scheme: dark) { body { background: #101216; color: #e7e9ee; } }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font-size: 1.35rem; line-height: 1.3; margin: 0 0 1rem; }
  p { margin: 0 0 .85rem; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: .9em; }
  .dato { opacity: .75; }
  .reintento { opacity: .6; font-size: .9rem; }
  .boton {
    display: inline-block; margin-top: .35rem; padding: .55rem 1.1rem;
    border: 1px solid currentColor; border-radius: .5rem;
    color: inherit; text-decoration: none;
  }
  .boton:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
<main>
  <h1>${escaparHtml(titulo)}</h1>
  ${cuerpo}
  ${reintento}
</main>`
}

/**
 * Empaqueta la pantalla de error como `data:` para cargarla sin tocar disco.
 *
 * Escribirla a un archivo temporal seria una cosa mas que puede fallar
 * justo cuando ya algo fallo (disco lleno, permisos, antivirus).
 */
export function urlDePaginaDeError(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
