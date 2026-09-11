import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { VentaAtascada } from './puente'

/**
 * Cola de ventas pendientes de sincronizar.
 *
 * Vive en el proceso principal y en un archivo, NO en el navegador. Tres
 * razones, y las tres son de negocio antes que tecnicas:
 *
 *  1. Sobrevive a que el cajero cierre la ventana, a que Windows reinicie
 *     por una actualizacion y a que se vaya la luz. Las ventas de ocho
 *     horas sin linea no pueden depender de que nadie toque nada.
 *  2. El reintento sigue corriendo aunque la pantalla este en otra cosa.
 *  3. El almacenamiento del navegador esta atado al origen: si manana el
 *     ERP cambia de dominio, se perderia la cola con ventas dentro.
 *
 * Se escribe con archivo temporal + rename porque `rename` es atomico en
 * el sistema de archivos: un corte de luz a mitad deja el archivo viejo
 * intacto, nunca uno a medias. Escribir encima del bueno es exactamente
 * como se pierde un dia de ventas.
 */

export interface VentaPendiente {
  /** Clave de idempotencia. La genera la caja y NUNCA cambia entre reintentos. */
  clientRef: string
  /** Hora real del cobro, no la de sincronizacion. */
  soldAt: string
  shiftId: string
  customerId: string | null
  cart: unknown
  payments: unknown
  tenant?: string
  rol?: string
  /** Cuantas veces se ha intentado subir. Para diagnosticar, no para rendirse. */
  intentos: number
  ultimoError?: string
}

interface Archivo {
  version: 1
  ventas: VentaPendiente[]
}

export class ColaVentas {
  private ventas: VentaPendiente[] = []

  constructor(private readonly ruta: string) {
    this.cargar()
  }

  private cargar(): void {
    if (!existsSync(this.ruta)) {
      this.ventas = []
      return
    }
    try {
      const datos = JSON.parse(readFileSync(this.ruta, 'utf8')) as Archivo
      this.ventas = Array.isArray(datos.ventas) ? datos.ventas : []
    } catch {
      // Un archivo corrupto NO se borra: se aparta con marca de tiempo.
      // Dentro puede haber ventas de verdad, y borrarlas para que la app
      // arranque limpia es perder dinero de alguien por comodidad.
      const respaldo = `${this.ruta}.corrupto-${Date.now()}`
      try {
        renameSync(this.ruta, respaldo)
      } catch {
        /* si tampoco se puede mover, se sigue con la cola vacia */
      }
      this.ventas = []
    }
  }

  private guardar(): void {
    const dir = dirname(this.ruta)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${this.ruta}.tmp`
    const datos: Archivo = { version: 1, ventas: this.ventas }
    writeFileSync(tmp, JSON.stringify(datos, null, 1), 'utf8')
    renameSync(tmp, this.ruta)
  }

  /**
   * Encola una venta. Devuelve su `clientRef`.
   *
   * Si ya hay una con la misma referencia no la duplica: el terminal puede
   * reintentar el encolado sin pensarlo.
   */
  encolar(v: Omit<VentaPendiente, 'intentos' | 'clientRef'> & { clientRef?: string }): string {
    const clientRef = v.clientRef ?? randomUUID()
    if (this.ventas.some((x) => x.clientRef === clientRef)) return clientRef
    this.ventas.push({ ...v, clientRef, intentos: 0 })
    this.guardar()
    return clientRef
  }

  /** Las primeras `n`, en orden de cobro: el arqueo se lee cronologico. */
  siguientes(n = 50): VentaPendiente[] {
    return this.ventas.slice(0, n)
  }

  get pendientes(): number {
    return this.ventas.length
  }

  /** Fuera de la cola: el servidor confirmo que esta guardada. */
  confirmar(clientRefs: string[]): void {
    if (clientRefs.length === 0) return
    const fuera = new Set(clientRefs)
    this.ventas = this.ventas.filter((v) => !fuera.has(v.clientRef))
    this.guardar()
  }

  /**
   * Anota el fallo y la deja en la cola.
   *
   * No se descarta nunca por muchos intentos que lleve: una venta cobrada
   * que el sistema tira es dinero que entro y no aparece. Si algo la
   * bloquea, tiene que verse y arreglarse, no desaparecer sola.
   */
  fallo(clientRef: string, error: string): void {
    const v = this.ventas.find((x) => x.clientRef === clientRef)
    if (!v) return
    v.intentos += 1
    v.ultimoError = error.slice(0, 300)
    this.guardar()
  }

  /** Las que llevan muchos intentos: son las que hay que mirar a mano. */
  atascadas(desde = 5): VentaPendiente[] {
    return this.ventas.filter((v) => v.intentos >= desde)
  }
}

export function rutaPorDefecto(carpetaDatos: string): string {
  return join(carpetaDatos, 'ventas-pendientes.json')
}

/**
 * Deja las atascadas en lo justo que la pantalla necesita pintar.
 *
 * El carrito y los pagos se quedan aqui: ya salieron del navegador una vez
 * y devolverlos seria mandar de vuelta datos que nadie va a mirar. Lo que
 * el cajero necesita es cual esta trabada y por que.
 */
export function resumirAtascadas(ventas: VentaPendiente[]): VentaAtascada[] {
  return ventas.map((v) => ({
    clientRef: v.clientRef,
    soldAt: v.soldAt,
    shiftId: v.shiftId,
    intentos: v.intentos,
    ultimoError: v.ultimoError ?? null,
  }))
}
