import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { randomUUID } from 'expo-crypto'
import {
  COLA_VACIA,
  anotarFallo,
  bloquear,
  confirmar,
  encolar,
  escribirCola,
  estadoDeCola,
  leerCola,
  porSubir,
  seEncola,
  type AccionMovil,
  type AccionPendiente,
  type ArchivoCola,
  type EstadoCola,
} from '@regb/operations'
import { supabase } from './supabase'

/**
 * La cola de acciones pendientes, viviendo en el telefono.
 *
 * Toda la logica -que se encola, en que orden sube, que se bloquea- esta
 * en `@regb/operations/cola-movil` y se prueba ahi, sin telefono de por
 * medio. Aqui solo queda lo que de verdad es del dispositivo: guardar en
 * AsyncStorage, llamar a PostgREST y saber cuando la app vuelve al
 * frente.
 *
 * ── Como se entera de que volvio la señal ─────────────────────────────
 *
 * No se entera, y es a proposito. Saberlo exige `@react-native-community
 * /netinfo`, que es una dependencia nativa: cambia como se compila la
 * app y no se agrega de paso -el mismo criterio que dejo la camara fuera
 * en 0113-.
 *
 * En vez de eso reintenta cuando hay motivo para creer que sirve:
 *
 *   · Al volver la app al frente. Es el momento real: la persona salio
 *     del almacen, camino hasta la oficina y volvio a abrirla.
 *   · Justo despues de encolar algo, por si fue un tropiezo de un
 *     segundo y no una zona muerta.
 *   · Cuando alguien lo pide a mano desde la pantalla de pendientes.
 *
 * El costo de equivocarse es una peticion que falla y un contador que
 * sube. El costo de una dependencia nativa mal metida es que la app no
 * compile. No se parecen.
 *
 * ── Por que `expo-crypto` si y la camara no ──────────────────────────
 *
 * Porque aqui la dependencia ES el mecanismo. `p_ref` tiene que ser un
 * uuid de verdad: dos acciones distintas con la misma referencia serian
 * la MISMA fila para 0114, y la segunda desapareceria en silencio
 * creyendo que ya estaba guardada. Hermes no trae `crypto.randomUUID`, y
 * un uuid armado con `Math.random` para tapar eso convierte la pieza que
 * garantiza que nada se pierde en la que lo pierde.
 */

const LLAVE = 'regb.cola.v1'

export type Resultado =
  | { estado: 'guardado'; id: string }
  | { estado: 'encolado'; ref: string }
  | { estado: 'rechazado'; mensaje: string }

interface Estado {
  cola: ArchivoCola
  indicador: EstadoCola
  /**
   * Intenta ahora; si la base no contesta, lo guarda para despues.
   *
   * `clave` solo para las asignaciones -contar-: encolar otra con la
   * misma sustituye a la que esperaba, en vez de acumular dos numeros
   * para la misma linea. Los hechos van sin ella.
   */
  enviar: (
    accion: AccionMovil,
    args: Record<string, unknown>,
    resumen: string,
    clave?: string,
  ) => Promise<Resultado>
  /** Empuja lo que haya pendiente. Devuelve cuantas subieron. */
  sincronizar: () => Promise<number>
  subiendo: boolean
}

const Ctx = createContext<Estado>({
  cola: COLA_VACIA,
  indicador: { pendientes: 0, bloqueadas: 0, texto: null, tono: null },
  enviar: async () => ({ estado: 'rechazado', mensaje: 'La cola no esta lista.' }),
  sincronizar: async () => 0,
  subiendo: false,
})

export function ProveedorCola({ children }: { children: ReactNode }) {
  const [cola, setCola] = useState<ArchivoCola>(COLA_VACIA)
  const [subiendo, setSubiendo] = useState(false)

  // La cola tambien vive en un ref porque `sincronizar` corre fuera del
  // ciclo de render -desde un temporizador, desde AppState- y ahi el
  // valor del estado que capturo la clausura puede estar viejo. Subir
  // con una copia vieja reintentaria algo ya confirmado.
  const actual = useRef<ArchivoCola>(COLA_VACIA)
  const trabajando = useRef(false)

  const aplicar = useCallback(async (siguiente: ArchivoCola) => {
    actual.current = siguiente
    setCola(siguiente)
    try {
      await AsyncStorage.setItem(LLAVE, escribirCola(siguiente))
    } catch {
      // Si el disco del telefono no acepta la escritura, la cola sigue
      // viva en memoria y se reintenta guardar en el proximo cambio. Se
      // prefiere eso a tumbar la pantalla: lo que el usuario acaba de
      // hacer no se pierde mientras la app siga abierta.
    }
  }, [])

  useEffect(() => {
    void (async () => {
      let guardado: string | null = null
      try {
        guardado = await AsyncStorage.getItem(LLAVE)
      } catch {
        guardado = null
      }
      const leida = leerCola(guardado)
      actual.current = leida
      setCola(leida)
    })()
  }, [])

  /** Manda UNA accion. Traduce la respuesta de PostgREST a algo decidible. */
  const mandar = useCallback(
    async (a: AccionPendiente): Promise<{ ok: true } | { ok: false; codigo?: string; mensaje: string }> => {
      const { error } = await supabase.rpc(a.accion, { ...a.args, p_ref: a.ref })
      if (error === null) return { ok: true }
      return {
        ok: false,
        ...(error.code === undefined || error.code === null ? {} : { codigo: error.code }),
        mensaje: error.message,
      }
    },
    [],
  )

  const sincronizar = useCallback(async (): Promise<number> => {
    // Dos subidas a la vez mandarian la misma accion dos veces. No
    // rompe nada -0114 la ignora- pero gasta datos de alguien que ya
    // esta con mala señal.
    if (trabajando.current) return 0
    trabajando.current = true
    setSubiendo(true)

    let subidas = 0
    try {
      for (const a of porSubir(actual.current)) {
        const r = await mandar(a)
        if (r.ok) {
          await aplicar(confirmar(actual.current, [a.ref]))
          subidas += 1
          continue
        }
        if (r.codigo === undefined) {
          // Sigue sin haber linea. No tiene sentido intentar las demas:
          // se anota y se corta hasta el proximo disparo.
          await aplicar(anotarFallo(actual.current, a.ref, r.mensaje))
          break
        }
        // La base contesto que no. Deja de reintentarse y pasa a la
        // lista que alguien tiene que mirar.
        await aplicar(bloquear(actual.current, a.ref, r.mensaje))
      }
    } finally {
      trabajando.current = false
      setSubiendo(false)
    }
    return subidas
  }, [aplicar, mandar])

  const enviar = useCallback(
    async (
      accion: AccionMovil,
      args: Record<string, unknown>,
      resumen: string,
      clave?: string,
    ): Promise<Resultado> => {
      // La referencia se decide ANTES de mandar: si se decidiera despues
      // de fallar, el intento que si llego al servidor habria ido sin
      // ella y el reintento crearia una fila nueva.
      const ref = randomUUID()
      const { data, error } = await supabase.rpc(accion, { ...args, p_ref: ref })

      if (error === null) return { estado: 'guardado', id: String(data) }

      if (!seEncola(error)) return { estado: 'rechazado', mensaje: error.message }

      // `clave` se OMITE cuando no viene, en vez de pasar undefined: con
      // `exactOptionalPropertyTypes` no es lo mismo, y una clave
      // undefined guardada en el archivo haria que dos hechos distintos
      // se vieran como la misma asignacion.
      const pendiente: AccionPendiente = {
        ref,
        accion,
        ...(clave === undefined ? {} : { clave }),
        args,
        creadaEn: new Date().toISOString(),
        resumen,
        intentos: 1,
        ultimoError: error.message,
      }
      await aplicar(encolar(actual.current, pendiente))

      // Por si fue un tropiezo de un segundo y no una zona muerta.
      void sincronizar()
      return { estado: 'encolado', ref }
    },
    [aplicar, sincronizar],
  )

  // Volver al frente es el momento real en que cambio algo: la persona
  // salio del deposito y esta en la oficina.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sincronizar()
    })
    return () => sub.remove()
  }, [sincronizar])

  return (
    <Ctx.Provider
      value={{ cola, indicador: estadoDeCola(cola), enviar, sincronizar, subiendo }}
    >
      {children}
    </Ctx.Provider>
  )
}

export const useCola = (): Estado => useContext(Ctx)
