/**
 * La cola de acciones pendientes del telefono.
 *
 * ── Por que existe ────────────────────────────────────────────────────
 *
 * El escritorio ya tiene la suya para las ventas del mostrador. El
 * telefono la necesita mas, no menos: quien lo usa esta caminando entre
 * estantes, en un deposito de zinc, en la parte de atras del local. Ahi
 * la señal no se cae del todo -eso seria facil-, se cae a ratos.
 *
 * Sin cola, mover un pallet y perder la señal al confirmarlo significa
 * que el sistema no se entera de algo que ya ocurrio. Quien lo movio no
 * lo vuelve a mover: lo apunta en un papel y lo mete cuando vuelva, que
 * es exactamente el trabajo doble que el ERP venia a quitar.
 *
 * ── Que pasa por aqui hoy, y que NO ───────────────────────────────────
 *
 * Las tres acciones de `AccionMovil`: transferir, gastos y vacaciones.
 * Son las que llaman a una funcion de la base y las que 0114 hizo
 * idempotentes.
 *
 * Los CONTEOS todavia no: escriben `stock_count_lines` directo, sin
 * funcion de por medio. Y es el caso que mas lo pide -contar un pasillo
 * es lo mas largo que se hace sin señal-, asi que es lo siguiente. Se
 * dice aqui para que nadie lea esta cola y de por hecho que ya cubre
 * todo lo que el telefono escribe.
 *
 * ── La regla que decide todo lo demas ─────────────────────────────────
 *
 * SI LA BASE DE DATOS HABLO, LA RESPUESTA ES FINAL.
 *
 * Un error con codigo SQL -"No hay suficiente en el almacen de origen",
 * "Tu rol no permite transferir"- es una respuesta: la base recibio la
 * accion, la entendio y la rechazo. Reintentarla mañana da exactamente
 * lo mismo, y meterla en una cola que reintenta sola es esconderle al
 * usuario un "no" que necesitaba oir ahora.
 *
 * Un fallo SIN codigo es que la base nunca hablo: no llego, o llego y la
 * respuesta se perdio. Eso, y solo eso, se encola.
 *
 * Esa distincion es toda la cola. Si se encolara cualquier fallo, la
 * primera transferencia rechazada por permisos se quedaria reintentando
 * para siempre y el usuario nunca sabria por que "no pasa nada".
 *
 * ── Lo que NUNCA hace ─────────────────────────────────────────────────
 *
 * Descartar. Ni por intentos, ni por antiguedad, ni por venir fallando.
 * Lo que hay dentro de la cola son cosas que pasaron de verdad en el
 * mundo fisico: la mercancia SE MOVIO, el conteo SE HIZO, el comprobante
 * del gasto esta en el bolsillo de alguien. Tirar eso para que la app
 * quede limpia es perderle el trabajo -o el dinero- a una persona.
 *
 * Lo que si hace es dejar de reintentar en silencio lo que ya sabe que
 * no va a pasar, y ponerlo delante de alguien. Ver `bloqueadas`.
 */

/** Las acciones que se pueden encolar. Cada una es una funcion de 0114. */
export type AccionMovil = 'transferir' | 'reportar_gasto' | 'pedir_vacaciones'

export interface AccionPendiente {
  /**
   * El uuid que el telefono decide ANTES de mandar nada.
   *
   * Viaja como `p_ref` y termina siendo la clave primaria de la fila que
   * se crea (0114). Es lo que hace que reintentar sea seguro, y por eso
   * no cambia nunca entre intentos: si cambiara, cada reintento seria
   * una accion nueva.
   */
  ref: string
  accion: AccionMovil
  /** Los parametros de la funcion, sin `p_ref`. */
  args: Record<string, unknown>
  /** Cuando la persona lo hizo. No cuando se logro subir. */
  creadaEn: string
  /** Lo que el usuario lee en la lista. "30 Cemento gris → Almacen Dos". */
  resumen: string
  intentos: number
  ultimoError?: string
  /**
   * La base contesto que no. Deja de reintentarse y pasa a la lista que
   * alguien tiene que mirar. No se borra: lo que describe ya ocurrio.
   */
  bloqueada?: string
}

/** Lo que se guarda en el telefono. Con version, para poder migrarlo. */
export interface ArchivoCola {
  version: 1
  acciones: AccionPendiente[]
}

export const COLA_VACIA: ArchivoCola = { version: 1, acciones: [] }

/**
 * ¿Esto se encola, o se le enseña al usuario ahora mismo?
 *
 * `codigo` es el SQLSTATE que devuelve PostgREST cuando la base contesto
 * ('42501' sin permiso, '23514' sin stock, '22023' dato invalido). Un
 * fallo de red no trae ninguno: nadie del otro lado contesto.
 *
 * Se decide por la AUSENCIA de codigo y no por una lista de mensajes de
 * red conocidos, a proposito. Los mensajes cambian entre Android, iOS y
 * versiones de la libreria; un `catch` que busca la palabra "network"
 * falla callado el dia que alguien traduce el texto. Que la base haya
 * hablado o no, en cambio, no depende de como se escriba el mensaje.
 */
export function seEncola(error: { code?: string | null } | null | undefined): boolean {
  if (error === null || error === undefined) return false
  const codigo = error.code
  return codigo === null || codigo === undefined || codigo === ''
}

/**
 * Mete una accion en la cola.
 *
 * Si ya hay una con la misma referencia NO la duplica: la pantalla puede
 * llamar a esto sin llevar la cuenta de si ya lo hizo.
 */
export function encolar(cola: ArchivoCola, accion: AccionPendiente): ArchivoCola {
  if (cola.acciones.some((a) => a.ref === accion.ref)) return cola
  return { version: 1, acciones: [...cola.acciones, accion] }
}

/**
 * Las que toca intentar ahora, en el orden en que ocurrieron.
 *
 * El orden importa y no es estetico: si alguien movio mercancia a un
 * almacen y despues conto ese almacen, subirlo al reves deja el conteo
 * cuadrado contra unas existencias que todavia no habian llegado.
 *
 * Las bloqueadas se quedan fuera: ya sabemos que no van a pasar y
 * reintentarlas solo gasta bateria y tapa a las que si pueden subir.
 */
export function porSubir(cola: ArchivoCola, limite = 25): AccionPendiente[] {
  return cola.acciones
    .filter((a) => a.bloqueada === undefined)
    .slice()
    .sort((a, b) => a.creadaEn.localeCompare(b.creadaEn))
    .slice(0, limite)
}

/** Subio: fuera de la cola. */
export function confirmar(cola: ArchivoCola, refs: string[]): ArchivoCola {
  if (refs.length === 0) return cola
  const fuera = new Set(refs)
  return { version: 1, acciones: cola.acciones.filter((a) => !fuera.has(a.ref)) }
}

/**
 * Fallo de red: se anota y se queda para el proximo intento.
 *
 * El contador de intentos es para diagnosticar, jamas para rendirse.
 */
export function anotarFallo(cola: ArchivoCola, ref: string, error: string): ArchivoCola {
  return {
    version: 1,
    acciones: cola.acciones.map((a) =>
      a.ref === ref ? { ...a, intentos: a.intentos + 1, ultimoError: recortar(error) } : a,
    ),
  }
}

/**
 * La base dijo que no. Se deja de reintentar y pasa a la lista de las
 * que alguien tiene que resolver a mano.
 *
 * El caso tipico y el que duele: una transferencia que se encolo cuando
 * habia stock y sube tres horas despues, cuando ya no lo hay. La
 * mercancia SI se movio fisicamente -alguien la cargo- pero el sistema
 * no puede registrarla sin descuadrar el kardex. Eso no lo arregla un
 * reintento: lo arregla una persona mirando que paso.
 */
export function bloquear(cola: ArchivoCola, ref: string, motivo: string): ArchivoCola {
  return {
    version: 1,
    acciones: cola.acciones.map((a) =>
      a.ref === ref
        ? { ...a, intentos: a.intentos + 1, ultimoError: recortar(motivo), bloqueada: recortar(motivo) }
        : a,
    ),
  }
}

/** Las que necesitan a una persona. */
export function bloqueadas(cola: ArchivoCola): AccionPendiente[] {
  return cola.acciones.filter((a) => a.bloqueada !== undefined)
}

export interface EstadoCola {
  pendientes: number
  bloqueadas: number
  /** Lo que dice la insignia. `null` = no se enseña nada. */
  texto: string | null
  /** Rojo si hay algo trabado; si no, es solo informacion. */
  tono: 'peligro' | 'alerta' | null
}

/**
 * Lo que la pantalla enseña arriba.
 *
 * Una cola vacia no dice nada: un indicador permanente de "todo bien" se
 * vuelve invisible a los dos dias y entonces tampoco se ve cuando dice
 * otra cosa.
 */
export function estadoDeCola(cola: ArchivoCola): EstadoCola {
  const trabadas = cola.acciones.filter((a) => a.bloqueada !== undefined).length
  const esperando = cola.acciones.length - trabadas

  if (trabadas > 0) {
    return {
      pendientes: esperando,
      bloqueadas: trabadas,
      texto: trabadas === 1 ? '1 no se pudo guardar' : `${trabadas} no se pudieron guardar`,
      tono: 'peligro',
    }
  }
  if (esperando > 0) {
    return {
      pendientes: esperando,
      bloqueadas: 0,
      texto: esperando === 1 ? '1 sin subir' : `${esperando} sin subir`,
      tono: 'alerta',
    }
  }
  return { pendientes: 0, bloqueadas: 0, texto: null, tono: null }
}

/**
 * Lee lo que habia guardado en el telefono.
 *
 * Un archivo ilegible devuelve la cola vacia en vez de reventar el
 * arranque: una app que no abre es peor que una app sin cola. Quien
 * llama decide si aparta el original -y deberia: dentro puede haber
 * trabajo de alguien-.
 */
export function leerCola(texto: string | null | undefined): ArchivoCola {
  if (texto === null || texto === undefined || texto.trim() === '') return COLA_VACIA
  try {
    const datos: unknown = JSON.parse(texto)
    if (typeof datos !== 'object' || datos === null) return COLA_VACIA
    const acciones = (datos as { acciones?: unknown }).acciones
    if (!Array.isArray(acciones)) return COLA_VACIA
    return { version: 1, acciones: acciones.filter(esAccionValida) }
  } catch {
    return COLA_VACIA
  }
}

/**
 * Valida forma, no negocio.
 *
 * Una entrada a medias -escrita mientras se cerraba la app- atasca el
 * subidor para siempre y ARRASTRA a las que venian detras, que si eran
 * buenas. Se descarta en la puerta. Es la unica perdida que esta cola
 * acepta, y es porque lo que se descarta no se puede ni intentar.
 */
function esAccionValida(x: unknown): x is AccionPendiente {
  if (typeof x !== 'object' || x === null) return false
  const a = x as Record<string, unknown>
  const texto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
  if (!texto(a['ref']) || !texto(a['creadaEn']) || !texto(a['resumen'])) return false
  if (a['accion'] !== 'transferir' && a['accion'] !== 'reportar_gasto' && a['accion'] !== 'pedir_vacaciones') {
    return false
  }
  if (typeof a['args'] !== 'object' || a['args'] === null || Array.isArray(a['args'])) return false
  return typeof a['intentos'] === 'number' && Number.isFinite(a['intentos'])
}

export function escribirCola(cola: ArchivoCola): string {
  return JSON.stringify({ version: 1, acciones: cola.acciones })
}

/** Los mensajes de la base pueden ser largos; la pantalla del telefono no. */
function recortar(texto: string): string {
  return texto.length > 300 ? `${texto.slice(0, 300)}…` : texto
}
