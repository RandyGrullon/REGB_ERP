import { contextBridge, ipcRenderer } from 'electron'
import type {
  Canal,
  ContratoIpc,
  EstadoSync,
  EventosPrincipal,
  PuenteEscritorio,
  VentaParaEncolar,
} from './puente'

/**
 * Puente entre la app web y el escritorio.
 *
 * ⚠️ SOLO se puede importar `electron` y TIPOS. Este preload corre con
 * `sandbox: true`, y ahi `require` no resuelve archivos del proyecto: si
 * alguien importa un valor de `./puente` o de cualquier otro modulo local,
 * la ventana arranca sin puente y la caja deja de imprimir sin decir por
 * que. El import de arriba es `import type`, que TypeScript borra entero.
 *
 * Deliberadamente estrecho: expone ONCE funciones y ni una mas. La ventana
 * carga una pagina remota, asi que todo lo que se ponga aqui queda al
 * alcance de cualquier script que llegue a esa pagina. `ipcRenderer`
 * entero, o cualquier cosa que reciba una ruta de archivo, seria darle el
 * equipo del mostrador a quien logre inyectar un script.
 *
 * Ninguna de estas funciones acepta rutas del disco ni comandos: solo datos
 * de una venta y rutas del propio ERP, que ademas el proceso principal
 * vuelve a validar antes de usarlas. Lo de aqui es comodidad; la frontera
 * de verdad esta en `main.ts`.
 */

/**
 * Envoltura tipada de `invoke`.
 *
 * Existe para que un canal mal escrito sea un error de compilacion. Sin
 * esto, `ipcRenderer.invoke('sync:etsado')` compila igual y devuelve una
 * promesa que nunca resuelve: la barra de estado se queda en blanco para
 * siempre y no hay ni un error en consola.
 */
function invocar<C extends Canal>(
  canal: C,
  ...args: ContratoIpc[C]['entrada']
): Promise<ContratoIpc[C]['salida']> {
  return ipcRenderer.invoke(canal, ...args) as Promise<ContratoIpc[C]['salida']>
}

/** Igual, para los avisos que empuja el proceso principal. Devuelve como darse de baja. */
function escuchar<E extends keyof EventosPrincipal>(
  evento: E,
  cb: (dato: EventosPrincipal[E]) => void,
): () => void {
  const handler = (_e: unknown, dato: EventosPrincipal[E]): void => cb(dato)
  ipcRenderer.on(evento, handler)
  // Devolver la baja y no un `off(evento)` suelto: en React esto se llama
  // desde el cleanup de un `useEffect`, y dos componentes escuchando lo
  // mismo no pueden apagarse el uno al otro.
  return () => {
    ipcRenderer.off(evento, handler)
  }
}

const api: PuenteEscritorio = {
  esEscritorio: true,

  imprimirTicket: (ruta: string) => invocar('imprimir:ticket', ruta),
  abrirGaveta: () => invocar('gaveta:abrir'),
  encolarVenta: (venta: VentaParaEncolar) => invocar('venta:encolar', venta),

  estadoSync: () => invocar('sync:estado'),
  sincronizarAhora: () => invocar('sync:ahora'),
  ventasAtascadas: () => invocar('sync:atascadas'),
  estadoRed: () => invocar('red:estado'),
  info: () => invocar('app:info'),

  alCambiarSync: (cb: (estado: EstadoSync) => void) => escuchar('sync:cambio', cb),
  alNavegar: (cb: (ruta: string) => void) => escuchar('ventana:navegar', cb),
}

contextBridge.exposeInMainWorld('regb', api)

declare global {
  interface Window {
    regb?: PuenteEscritorio
  }
}
