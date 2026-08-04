import { contextBridge, ipcRenderer } from 'electron'

/**
 * Puente entre la app web y el escritorio.
 *
 * Deliberadamente estrecho: expone SEIS funciones y ni una mas. La ventana
 * carga una pagina remota, asi que todo lo que se ponga aqui queda al
 * alcance de cualquier script que llegue a esa pagina. `ipcRenderer`
 * entero, o cualquier cosa que reciba una ruta de archivo, seria darle el
 * equipo del mostrador a quien logre inyectar un script.
 *
 * Ninguna de estas funciones acepta rutas ni comandos: solo datos de una
 * venta y una ruta relativa del propio ERP.
 */

export interface EstadoSync {
  pendientes: number
  atascadas: number
  ultimoIntento: string | null
  ultimoError: string | null
  subiendo: boolean
}

export interface VentaParaEncolar {
  clientRef?: string
  soldAt: string
  shiftId: string
  customerId: string | null
  cart: unknown
  payments: unknown
  tenant?: string
  rol?: string
}

const api = {
  /** Marca de que corremos en escritorio: la web lo consulta para mostrar lo suyo. */
  esEscritorio: true as const,

  /** Manda el ticket al papel sin dialogo. `ruta` es relativa: `/pos/ticket/<id>`. */
  imprimirTicket: (ruta: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('imprimir:ticket', ruta),

  /** Pulso a la gaveta de efectivo. */
  abrirGaveta: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('gaveta:abrir'),

  /**
   * Guarda la venta para subirla. Devuelve su `clientRef`.
   *
   * Se llama SIEMPRE, haya linea o no: es lo que hace que un corte a mitad
   * del cobro no pueda perder ni duplicar la venta.
   */
  encolarVenta: (
    v: VentaParaEncolar,
  ): Promise<{ ok: boolean; clientRef: string; pendientes: number }> =>
    ipcRenderer.invoke('venta:encolar', v),

  estadoSync: (): Promise<EstadoSync> => ipcRenderer.invoke('sync:estado'),
  sincronizarAhora: (): Promise<EstadoSync> => ipcRenderer.invoke('sync:ahora'),
  ventasAtascadas: (): Promise<unknown[]> => ipcRenderer.invoke('sync:atascadas'),
  estadoRed: (): Promise<{ enLinea: boolean }> => ipcRenderer.invoke('red:estado'),

  /** Avisa cuando cambia la cola, para pintar el indicador sin preguntar en bucle. */
  alCambiarSync: (cb: (e: EstadoSync) => void): (() => void) => {
    const handler = (_e: unknown, estado: EstadoSync) => cb(estado)
    ipcRenderer.on('sync:estado', handler)
    return () => ipcRenderer.off('sync:estado', handler)
  },
}

contextBridge.exposeInMainWorld('regb', api)

declare global {
  interface Window {
    regb?: typeof api
  }
}
