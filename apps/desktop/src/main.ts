import { app, BrowserWindow, ipcMain, shell, net, Menu, dialog } from 'electron'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { ColaVentas, rutaPorDefecto, resumirAtascadas, validarVentaEntrante } from './cola'
import { Sincronizador } from './sincronizador'
import { abrirGaveta } from './impresora'
import { construirMenu } from './menu'
import {
  esEnlaceSeguroParaAbrir,
  esNavegacionInterna,
  explicarFallo,
  mismaPagina,
  paginaDeError,
  resolverUrlBase,
  urlDePaginaDeError,
  urlDeTicket,
} from './servidor'
import type { Canal, ContratoIpc, EventosPrincipal } from './puente'

/**
 * REGB ERP de mostrador (F5).
 *
 * No reimplementa el ERP: carga la misma app web de `apps/web`. Duplicar
 * las pantallas en un segundo runtime es como acaban divergiendo, y el
 * documento maestro lo prohibe por eso mismo. Lo que anade el escritorio es
 * lo unico que un navegador no puede hacer:
 *
 *   1. imprimir sin dialogo,
 *   2. abrir la gaveta de efectivo,
 *   3. seguir vendiendo sin linea y subirlo despues sin duplicar,
 *   4. un menu y unos atajos que se manejan sin raton.
 *
 * Todo eso vive aqui y se expone por un puente estrecho y tipado
 * (`puente.ts`). Cero logica de negocio: si aparece una regla de negocio en
 * este archivo, es un bug — va en `packages/`.
 */

/** Ruta de arranque. La caja es lo primero que abre un cajero. */
const RUTA_INICIO = process.env.REGB_RUTA_INICIO ?? '/pos'
const RUTA_CAJA = '/pos'
const IMPRESORA = process.env.REGB_IMPRESORA ?? ''

/**
 * Cada cuanto se reintenta solo cuando el servidor no contesta.
 *
 * Corto a proposito: el caso normal no es "el servidor murio", es "todavia
 * no termino de levantar" o "el router se reinicio". Diez segundos hacen
 * que la ventana se arregle sola antes de que nadie llame a soporte.
 */
const SEGUNDOS_REINTENTO = 10

let BASE: string | null = null
let ventana: BrowserWindow | null = null
let cola: ColaVentas
let sync: Sincronizador
let reintento: NodeJS.Timeout | null = null

// ── Ayudas tipadas del puente ────────────────────────────────────────────

/**
 * Registra un handler contra el contrato de `puente.ts`.
 *
 * Asi, un canal que el preload llama y aqui nadie atiende no compila. Sin
 * esto el sintoma es una promesa que jamas resuelve: la pantalla se queda
 * cargando para siempre y no hay ni un error en ningun log.
 */
function manejar<C extends Canal>(
  canal: C,
  fn: (...args: ContratoIpc[C]['entrada']) => Promise<ContratoIpc[C]['salida']>,
): void {
  ipcMain.handle(canal, (_e, ...args) => fn(...(args as ContratoIpc[C]['entrada'])))
}

function enviar<E extends keyof EventosPrincipal>(evento: E, dato: EventosPrincipal[E]): void {
  ventana?.webContents.send(evento, dato)
}

// ── Donde vive el ERP ────────────────────────────────────────────────────

/**
 * La direccion que dejo escrita quien instalo el equipo.
 *
 * Un archivo y no un ajuste dentro de la app: la app no puede pedir su
 * propia direccion desde una pantalla que todavia no ha podido cargar.
 * TODO honesto: no existe UI para editarlo, se escribe a mano por ahora.
 */
function servidorConfigurado(carpetaDatos: string): string | undefined {
  try {
    const datos = JSON.parse(readFileSync(join(carpetaDatos, 'servidor.json'), 'utf8')) as {
      url?: unknown
    }
    return typeof datos.url === 'string' ? datos.url : undefined
  } catch {
    // No existir es el caso normal en desarrollo, no un problema.
    return undefined
  }
}

// ── Ventana ──────────────────────────────────────────────────────────────

function crearVentana(): void {
  ventana = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    // El mostrador es de tablet o de monitor pequeno: arrancar maximizado
    // evita que el cajero pelee con la ventana en cada turno.
    show: false,
    title: 'REGB ERP',
    backgroundColor: '#101216',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      // Los tres innegociables. La ventana carga una web remota: sin esto,
      // cualquier script de esa pagina tendria Node entero en las manos.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Sin esto, `window.open` desde la web podria abrir una ventana con
      // los permisos por defecto en vez de los de arriba.
      webviewTag: false,
    },
  })

  ventana.once('ready-to-show', () => {
    ventana?.maximize()
    ventana?.show()
  })

  // Nada de navegar fuera del ERP dentro de la ventana de la caja: un
  // enlace externo se abre en el navegador del sistema, donde el usuario
  // ve la barra de direcciones y sabe donde esta.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (esEnlaceSeguroParaAbrir(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  ventana.webContents.on('will-navigate', (e, url) => {
    if (esNavegacionInterna(url, BASE)) return
    e.preventDefault()
    if (esEnlaceSeguroParaAbrir(url)) void shell.openExternal(url)
  })

  // La ventana en blanco es el peor fallo posible de un cliente remoto: no
  // dice si se rompio el programa, la red o el servidor. Cualquier fallo
  // del marco principal se convierte en una pantalla que lo explica.
  ventana.webContents.on('did-fail-load', (_e, codigo, descripcion, _url, esMarcoPrincipal) => {
    // -3 es ERR_ABORTED: lo dispara una navegacion que se cancela porque
    // empezo otra. Es rutina, no un fallo.
    if (!esMarcoPrincipal || codigo === -3) return
    mostrarError(explicarFallo(descripcion))
  })

  ventana.on('closed', () => {
    ventana = null
  })

  cargarApp()
}

function cargarApp(ruta: string = RUTA_INICIO): void {
  if (reintento !== null) {
    clearTimeout(reintento)
    reintento = null
  }
  if (ventana === null) return
  if (BASE === null) {
    mostrarError(undefined)
    return
  }
  // `did-fail-load` cubre el fallo de red; el `catch` esta por el rechazo
  // de la propia promesa, que es el mismo evento visto desde el otro lado.
  ventana.loadURL(`${BASE}${ruta}`).catch(() => {
    /* ya lo pinta did-fail-load */
  })
}

function mostrarError(detalle: string | undefined): void {
  if (ventana === null) return

  const html = paginaDeError({
    base: BASE,
    rutaInicio: RUTA_INICIO,
    segundosReintento: SEGUNDOS_REINTENTO,
    ...(detalle === undefined ? {} : { detalle }),
  })
  void ventana.loadURL(urlDePaginaDeError(html))

  // `ready-to-show` puede no haber llegado nunca si el primer intento
  // fallo: sin esto la ventana se quedaria invisible y el programa
  // parecería no haber arrancado.
  ventana.show()

  if (reintento !== null) clearTimeout(reintento)
  // Sin servidor configurado no hay a donde reintentar: reintentar seria
  // un bucle que no puede terminar bien.
  reintento =
    BASE === null ? null : setTimeout(() => cargarApp(), SEGUNDOS_REINTENTO * 1_000)
}

/**
 * Lleva la ventana a una ruta del ERP.
 *
 * Si ya estamos ahi NO se recarga: recargar el POS a mitad de un cobro
 * borra el carrito, y darle a un atajo por error no puede costarle una
 * venta a nadie. Se avisa igual por el puente para que la web pueda
 * reaccionar sin recargar el dia que lo implemente.
 */
function irA(ruta: string): void {
  if (ventana === null) return
  enviar('ventana:navegar', ruta)
  if (mismaPagina(ventana.webContents.getURL(), BASE, ruta)) return
  cargarApp(ruta)
}

function instalarMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      construirMenu(
        {
          abrirCaja: () => irA(RUTA_CAJA),
          abrirGaveta: () => {
            void abrirGaveta(IMPRESORA ? { recursoCompartido: IMPRESORA } : {}).then((r) => {
              if (!r.ok && ventana !== null) {
                void dialog.showMessageBox(ventana, {
                  type: 'warning',
                  title: 'Gaveta de efectivo',
                  message: 'No se pudo abrir la gaveta.',
                  // Va con spread y no como `detail: r.error`: el proyecto
                  // compila con `exactOptionalPropertyTypes`, asi que un
                  // `undefined` explicito no es lo mismo que no ponerlo.
                  ...(r.error === undefined ? {} : { detail: r.error }),
                  buttons: ['Entendido'],
                })
              }
            })
          },
          sincronizarAhora: () => void sync.intentar(),
          recargar: () => ventana?.webContents.reload(),
          alternarHerramientas: () => ventana?.webContents.toggleDevTools(),
          acercaDe: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'Acerca de REGB ERP',
              message: `REGB ERP para mostrador ${app.getVersion()}`,
              detail: [
                `Electron ${process.versions.electron}`,
                `Servidor: ${BASE ?? 'sin configurar'}`,
                `Ventas por subir: ${cola.pendientes}`,
              ].join('\n'),
              buttons: ['Cerrar'],
            })
          },
          salir: () => app.quit(),
        },
        process.platform === 'darwin',
      ),
    ),
  )
}

// ── Arranque ─────────────────────────────────────────────────────────────

/**
 * Una sola instancia, y no es cosmetico.
 *
 * Dos procesos abiertos serian dos `ColaVentas` escribiendo el MISMO
 * archivo de ventas pendientes: el ultimo en guardar se lleva por delante
 * las ventas que encolo el otro. En un mostrador donde se abre la app dos
 * veces por despiste, eso es dinero que desaparece.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (ventana === null) return
    if (ventana.isMinimized()) ventana.restore()
    ventana.focus()
  })

  void app.whenReady().then(() => {
    const carpetaDatos = app.getPath('userData')

    BASE = resolverUrlBase({
      env: process.env.REGB_URL,
      configurada: servidorConfigurado(carpetaDatos),
      empaquetada: app.isPackaged,
    })

    cola = new ColaVentas(rutaPorDefecto(carpetaDatos))

    sync = new Sincronizador({
      // El sincronizador se construye una vez con la base de este arranque.
      // Si `BASE` es null no hay a donde subir y los intentos fallaran solos,
      // que es lo correcto: las ventas se quedan en la cola, no se pierden.
      base: BASE ?? '',
      cola,
      // Las cookies salen de la sesion de la propia ventana: la caja sube
      // como el cajero que esta al frente, no con una credencial de servicio
      // guardada en el equipo. Un equipo de mostrador se roba.
      cookies: async () => {
        if (BASE === null || ventana === null) return ''
        const lista = await ventana.webContents.session.cookies.get({ url: BASE })
        return lista.map((c) => `${c.name}=${c.value}`).join('; ')
      },
      alCambiar: (estado) => enviar('sync:cambio', estado),
    })
    sync.arrancar()

    instalarMenu()
    crearVentana()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) crearVentana()
    })
  })
}

// En Windows y Linux cerrar la ventana es cerrar el programa. En un
// mostrador no se espera un icono viviendo en la bandeja.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Puente con la pantalla ───────────────────────────────────────────────

manejar('imprimir:ticket', async (ruta) => {
  // Se valida aqui y no solo en el preload: el preload vive en el mismo
  // proceso que la pagina remota, asi que su validacion es una comodidad,
  // no una frontera. Una ruta que apunte fuera del ERP se rechaza; si no,
  // cualquier script inyectado podria mandar a imprimir un sitio ajeno a
  // rollo lleno y en silencio.
  const url = urlDeTicket(ruta, BASE)
  if (url === null) return { ok: false, error: 'Ese ticket no es de este ERP.' }

  // Se imprime en una ventana oculta con la MISMA pagina de 80 mm de la
  // version web: una sola maquetacion para los dos caminos. Sin `preload`:
  // el ticket solo tiene que pintarse, no necesita el puente.
  const oculta = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // Aunque solo carga una URL ya validada del ERP, la ventana del ticket
  // no puede abrir nada ni irse a ningun lado: es papel, no un navegador.
  oculta.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  oculta.webContents.on('will-navigate', (e, destino) => {
    if (!esNavegacionInterna(destino, BASE)) e.preventDefault()
  })

  try {
    await oculta.loadURL(url)
    await new Promise((r) => setTimeout(r, 250)) // que asienten fuentes e iconos
    const ok = await new Promise<boolean>((resolve) => {
      oculta.webContents.print(
        { silent: true, printBackground: true, margins: { marginType: 'none' } },
        (exito) => resolve(exito),
      )
    })
    return ok
      ? { ok: true }
      : { ok: false, error: 'Windows rechazo el trabajo. Revisa que la impresora este lista.' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo imprimir.' }
  } finally {
    oculta.destroy()
  }
})

manejar('gaveta:abrir', async () =>
  abrirGaveta(IMPRESORA ? { recursoCompartido: IMPRESORA } : {}),
)

manejar('venta:encolar', async (venta) => {
  // Se valida aqui por lo mismo que el ticket: quien llama es una pagina
  // remota y el tipo no es una garantia en tiempo de ejecucion. Una venta
  // deforme dentro del archivo atasca al sincronizador y con el a todas
  // las ventas cobradas que vienen detras.
  const limpia = validarVentaEntrante(venta)
  if (limpia === null) {
    return {
      ok: false,
      clientRef: '',
      pendientes: cola.pendientes,
      error: 'La venta llego incompleta y no se encolo. Vuelve a cobrarla.',
    }
  }

  const clientRef = cola.encolar(limpia)
  // Se intenta subir de inmediato: si hay linea, la venta llega antes de
  // que el cajero termine de dar el vuelto y el ticket ya trae su numero.
  void sync.intentar()
  return { ok: true, clientRef, pendientes: cola.pendientes }
})

manejar('sync:estado', async () => sync.estado())
manejar('sync:ahora', async () => {
  await sync.intentar()
  return sync.estado()
})
manejar('sync:atascadas', async () => resumirAtascadas(cola.atascadas()))

/** ¿Hay linea de verdad? `navigator.onLine` miente: solo mira el cable. */
manejar('red:estado', async () => ({ enLinea: net.isOnline() }))

manejar('app:info', async () => ({
  version: app.getVersion(),
  plataforma: process.platform,
  urlBase: BASE,
}))
