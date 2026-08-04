import { app, BrowserWindow, ipcMain, shell, net } from 'electron'
import { join } from 'node:path'
import { ColaVentas, rutaPorDefecto } from './cola'
import { Sincronizador } from './sincronizador'
import { abrirGaveta } from './impresora'

/**
 * REGB ERP de mostrador (F5).
 *
 * No reimplementa el ERP: carga la misma app web. Duplicar las pantallas
 * en un segundo runtime es como acaban divergiendo, y el documento maestro
 * lo prohibe por eso mismo. Lo que anade el escritorio es lo unico que un
 * navegador no puede hacer:
 *
 *   1. imprimir sin dialogo,
 *   2. abrir la gaveta de efectivo,
 *   3. seguir vendiendo sin linea y subirlo despues sin duplicar.
 *
 * Las tres viven aqui y se exponen por un puente estrecho y tipado.
 */

const BASE = process.env.REGB_URL ?? 'http://localhost:3100'
const IMPRESORA = process.env.REGB_IMPRESORA ?? ''

let ventana: BrowserWindow | null = null
let cola: ColaVentas
let sync: Sincronizador

function crearVentana(): void {
  ventana = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    // El mostrador es de tablet o de monitor pequeno: arrancar maximizado
    // evita que el cajero pelee con la ventana en cada turno.
    show: false,
    title: 'REGB ERP',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      // Los tres innegociables. La ventana carga una web remota: sin esto,
      // cualquier script de esa pagina tendria Node entero en las manos.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  ventana.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(BASE)) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })

  void ventana.loadURL(`${BASE}/pos`)
  ventana.on('closed', () => (ventana = null))
}

app.whenReady().then(() => {
  cola = new ColaVentas(rutaPorDefecto(app.getPath('userData')))

  sync = new Sincronizador({
    base: BASE,
    cola,
    // Las cookies salen de la sesion de la propia ventana: la caja sube
    // como el cajero que esta al frente, no con una credencial de servicio
    // guardada en el equipo. Un equipo de mostrador se roba.
    cookies: async () => {
      const lista = await app
        .whenReady()
        .then(() => ventana?.webContents.session.cookies.get({ url: BASE }))
      return (lista ?? []).map((c) => `${c.name}=${c.value}`).join('; ')
    },
    alCambiar: (estado) => ventana?.webContents.send('sync:estado', estado),
  })
  sync.arrancar()

  crearVentana()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana()
  })
})

// En Windows y Linux cerrar la ventana es cerrar el programa. En un
// mostrador no se espera un icono viviendo en la bandeja.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Puente con la pantalla ───────────────────────────────────────────────

ipcMain.handle('imprimir:ticket', async (_e, url: string) => {
  // Se imprime en una ventana oculta con la MISMA pagina de 80 mm de la
  // version web: una sola maquetacion para los dos caminos.
  const oculta = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  try {
    await oculta.loadURL(url.startsWith('http') ? url : `${BASE}${url}`)
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

ipcMain.handle('gaveta:abrir', async () =>
  abrirGaveta(IMPRESORA ? { recursoCompartido: IMPRESORA } : {}),
)

ipcMain.handle('venta:encolar', async (_e, venta) => {
  const ref = cola.encolar(venta)
  // Se intenta subir de inmediato: si hay linea, la venta llega antes de
  // que el cajero termine de dar el vuelto y el ticket ya trae su numero.
  void sync.intentar()
  return { ok: true, clientRef: ref, pendientes: cola.pendientes }
})

ipcMain.handle('sync:estado', async () => sync.estado())
ipcMain.handle('sync:ahora', async () => {
  await sync.intentar()
  return sync.estado()
})
ipcMain.handle('sync:atascadas', async () => cola.atascadas())

/** ¿Hay linea de verdad? `navigator.onLine` miente: solo mira el cable. */
ipcMain.handle('red:estado', async () => ({ enLinea: net.isOnline() }))
