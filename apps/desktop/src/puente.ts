/**
 * Contrato del puente escritorio ↔ web.
 *
 * ⚠️ ESTE ARCHIVO NO PUEDE TENER NADA EN TIEMPO DE EJECUCION: solo tipos.
 *
 * El preload corre con `sandbox: true`, y un preload en sandbox NO puede
 * hacer `require` de archivos del proyecto — su `require` solo resuelve
 * `electron` y un punado de modulos de Node. Si aqui apareciera una
 * constante, `preload.js` compilaria un `require('./puente')` que revienta
 * al arrancar y la ventana quedaria sin puente, en silencio y solo en el
 * build empaquetado. Mientras todo sea `interface` o `type`, TypeScript
 * borra el import y no queda rastro.
 *
 * Con eso el contrato vive en un solo sitio: el proceso principal declara
 * los handlers con estos tipos, el preload los llama con estos tipos, y
 * `apps/web` puede declarar `window.regb: PuenteEscritorio` copiando este
 * archivo (o moviendolo a `packages/` el dia que haga falta) sin volver a
 * escribir la forma a mano. Hoy la web la tiene duplicada en
 * `BarraEscritorio.tsx` y `PosTerminal.tsx`; eso queda pendiente y NO se
 * toca desde aqui.
 */

/** Resultado de algo que puede fallar por causas del mundo real (papel, red, gaveta). */
export interface ResultadoOperacion {
  ok: boolean
  /** En espanol y accionable: lo lee un cajero, no un programador. */
  error?: string
}

export interface ResultadoEncolado {
  ok: boolean
  /** Clave de idempotencia de la venta. Cadena vacia si no se encolo. */
  clientRef: string
  pendientes: number
  /** Por que no se encolo. Solo cuando `ok` es `false`. */
  error?: string
}

export interface EstadoSync {
  pendientes: number
  atascadas: number
  ultimoIntento: string | null
  ultimoError: string | null
  subiendo: boolean
}

export interface EstadoRed {
  enLinea: boolean
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

/**
 * Resumen de una venta que lleva muchos intentos fallidos.
 *
 * Va sin `cart` ni `payments` a proposito: la pantalla solo necesita saber
 * cual esta trabada y por que. Devolver el carrito entero seria mandar de
 * vuelta al navegador datos que no va a pintar.
 */
export interface VentaAtascada {
  clientRef: string
  soldAt: string
  shiftId: string
  intentos: number
  ultimoError: string | null
}

export interface InfoApp {
  /** Version del paquete `@regb/desktop`. Va en los reportes de soporte. */
  version: string
  /** `win32`, `darwin`, `linux`. */
  plataforma: string
  /** Contra que servidor esta hablando esta caja. */
  urlBase: string | null
}

/**
 * Canales de invocacion (renderer → principal → respuesta).
 *
 * El mapa existe para que anadir un canal en el preload sin escribir su
 * handler en el principal sea un error de compilacion y no un `undefined`
 * a las tres de la tarde con la fila llena.
 */
export interface ContratoIpc {
  'imprimir:ticket': { entrada: [ruta: string]; salida: ResultadoOperacion }
  'gaveta:abrir': { entrada: []; salida: ResultadoOperacion }
  'venta:encolar': { entrada: [venta: VentaParaEncolar]; salida: ResultadoEncolado }
  'sync:estado': { entrada: []; salida: EstadoSync }
  'sync:ahora': { entrada: []; salida: EstadoSync }
  'sync:atascadas': { entrada: []; salida: VentaAtascada[] }
  'red:estado': { entrada: []; salida: EstadoRed }
  'app:info': { entrada: []; salida: InfoApp }
}

export type Canal = keyof ContratoIpc

/**
 * Avisos que empuja el proceso principal sin que nadie pregunte.
 *
 * Nombres distintos a los de `ContratoIpc` aunque Electron los guarde en
 * mapas separados: `sync:estado` significando dos cosas segun quien llame
 * es como se lee mal un log a la primera.
 */
export interface EventosPrincipal {
  'sync:cambio': EstadoSync
  'ventana:navegar': string
}

/** Lo que ve la app web en `window.regb`. Nada mas que esto. */
export interface PuenteEscritorio {
  /** Marca de que corremos en escritorio: la web la consulta para pintar lo suyo. */
  esEscritorio: true

  /** Manda el ticket al papel sin dialogo. `ruta` es del propio ERP: `/pos/ticket/<id>`. */
  imprimirTicket: (ruta: string) => Promise<ResultadoOperacion>

  /** Pulso a la gaveta de efectivo. */
  abrirGaveta: () => Promise<ResultadoOperacion>

  /**
   * Guarda la venta para subirla. Devuelve su `clientRef`.
   *
   * Se llama SIEMPRE, haya linea o no: es lo que hace que un corte a mitad
   * del cobro no pueda perder ni duplicar la venta.
   */
  encolarVenta: (venta: VentaParaEncolar) => Promise<ResultadoEncolado>

  estadoSync: () => Promise<EstadoSync>
  sincronizarAhora: () => Promise<EstadoSync>
  ventasAtascadas: () => Promise<VentaAtascada[]>
  estadoRed: () => Promise<EstadoRed>
  info: () => Promise<InfoApp>

  /** Avisa cuando cambia la cola, para pintar el indicador sin preguntar en bucle. */
  alCambiarSync: (cb: (estado: EstadoSync) => void) => () => void

  /**
   * El menu o un atajo pidio ir a una ruta del ERP.
   *
   * Hoy NADIE en `apps/web` escucha esto: si nadie se suscribe, el proceso
   * principal navega el con `loadURL`, que recarga la pagina entera. Se
   * expone para que la web pueda adoptarlo y hacer un `router.push` que no
   * borre el carrito a medio cobrar.
   */
  alNavegar: (cb: (ruta: string) => void) => () => void
}
