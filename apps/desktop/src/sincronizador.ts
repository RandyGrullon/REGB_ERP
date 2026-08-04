import type { ColaVentas } from './cola'

/**
 * Sube las ventas encoladas cuando hay linea.
 *
 * Reintento con espera creciente y tope: 5 s, 10 s, 20 s… hasta 5 minutos.
 * Sin tope, una caida larga acaba reintentando cada hora y las ventas
 * tardarian en subir mucho despues de que la linea volviera; sin espera
 * creciente, una caida de media hora son cientos de peticiones inutiles
 * contra un servidor que ya esta mal.
 *
 * No decide si una venta esta "muy vieja" ni la descarta: eso lo decide
 * una persona mirando la cola. Una venta cobrada que el sistema tira sola
 * es dinero que entro y no aparece en ningun lado.
 */

const ESPERA_MIN = 5_000
const ESPERA_MAX = 300_000

export interface ResultadoSync {
  aceptadas: number
  rechazadas: number
  resultados: { clientRef: string; ok: boolean; error?: string }[]
}

export interface OpcionesSync {
  /** A donde subir. Ej. `https://erp.midominio.do`. */
  base: string
  /** Cookies de la sesion; la caja sube como el cajero, no como nadie. */
  cookies: () => Promise<string>
  cola: ColaVentas
  alCambiar?: (estado: EstadoSync) => void
}

export interface EstadoSync {
  pendientes: number
  atascadas: number
  ultimoIntento: string | null
  ultimoError: string | null
  subiendo: boolean
}

export class Sincronizador {
  private timer: NodeJS.Timeout | null = null
  private espera = ESPERA_MIN
  private subiendo = false
  private ultimoIntento: string | null = null
  private ultimoError: string | null = null

  constructor(private readonly o: OpcionesSync) {}

  estado(): EstadoSync {
    return {
      pendientes: this.o.cola.pendientes,
      atascadas: this.o.cola.atascadas().length,
      ultimoIntento: this.ultimoIntento,
      ultimoError: this.ultimoError,
      subiendo: this.subiendo,
    }
  }

  arrancar(): void {
    if (this.timer) return
    void this.intentar()
  }

  parar(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private programar(exito: boolean): void {
    // Al primer exito se vuelve al minimo: la linea volvio y lo que queda
    // de cola tiene que subir rapido, no esperar los 5 minutos del ultimo
    // fallo.
    this.espera = exito ? ESPERA_MIN : Math.min(this.espera * 2, ESPERA_MAX)
    this.timer = setTimeout(() => void this.intentar(), this.espera)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  /** Sube un lote. Publico para que "Reintentar ahora" no espere al reloj. */
  async intentar(): Promise<ResultadoSync | null> {
    if (this.subiendo) return null
    const lote = this.o.cola.siguientes(50)
    if (lote.length === 0) {
      this.programar(true)
      this.o.alCambiar?.(this.estado())
      return null
    }

    this.subiendo = true
    this.ultimoIntento = new Date().toISOString()
    this.o.alCambiar?.(this.estado())

    try {
      const res = await fetch(`${this.o.base}/api/pos/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: await this.o.cookies() },
        body: JSON.stringify({ ventas: lote }),
      })

      if (!res.ok) throw new Error(`El servidor respondio ${res.status}`)
      const datos = (await res.json()) as ResultadoSync

      // Solo se sacan de la cola las que el servidor confirmo. Las
      // rechazadas se quedan con su motivo escrito: si algo las bloquea,
      // tiene que verse.
      const ok = datos.resultados.filter((r) => r.ok).map((r) => r.clientRef)
      this.o.cola.confirmar(ok)
      for (const r of datos.resultados.filter((x) => !x.ok)) {
        this.o.cola.fallo(r.clientRef, r.error ?? 'Rechazada sin motivo.')
      }

      this.ultimoError = datos.rechazadas > 0 ? `${datos.rechazadas} rechazada(s)` : null
      this.subiendo = false
      this.programar(true)
      this.o.alCambiar?.(this.estado())
      return datos
    } catch (e) {
      // Sin linea o servidor caido: NADA sale de la cola. Es el caso
      // normal, no una excepcion — por eso no se marca fallo en cada
      // venta: inflaria el contador de intentos sin que ninguna tenga
      // nada malo.
      this.ultimoError = e instanceof Error ? e.message : 'Sin conexion'
      this.subiendo = false
      this.programar(false)
      this.o.alCambiar?.(this.estado())
      return null
    }
  }
}
