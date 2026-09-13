/**
 * Conteo de inventario desde el telefono.
 *
 * ── La regla que manda sobre el diseño ────────────────────────────────
 *
 * EL QUE CUENTA NO VE EL SISTEMA.
 *
 * Si en la pantalla dice "deberia haber 40", el que cuenta escribe 40.
 * No por deshonestidad: porque contar 43 tornillos en una caja es
 * incomodo y el numero de la pantalla da permiso para no terminar. Un
 * conteo que confirma lo que ya se sabia no encuentra nada, y entonces
 * todo el ejercicio -cerrar un pasillo, pagar horas- no sirvio de nada.
 *
 * Por eso `system_qty` NI SIQUIERA SE PIDE en la consulta del movil. No
 * se pide y se oculta al pintar: no se pide. Un campo que no viaja no se
 * puede filtrar por accidente en un rediseño ni leerse en el trafico.
 *
 * La diferencia se calcula al cerrar, del lado del servidor, donde el
 * numero del sistema si esta.
 */

export interface LineaConteo {
  id: string
  sku: string
  nombre: string
  unidad: string
  /** Lo contado. Null = todavia no se conto. */
  contado: number | null
}

export interface AvanceConteo {
  total: number
  hechas: number
  /** 0 a 1. Para la barra. */
  fraccion: number
  /** Lo que se le dice a quien esta contando. */
  texto: string
}

export function avanceDelConteo(lineas: LineaConteo[]): AvanceConteo {
  const total = lineas.length
  const hechas = lineas.filter((l) => l.contado !== null).length
  return {
    total,
    hechas,
    fraccion: total === 0 ? 0 : hechas / total,
    texto:
      total === 0
        ? 'Este conteo no tiene productos'
        : hechas === total
          ? `Listo: contaste los ${total}`
          : `${hechas} de ${total} contados`,
  }
}

/**
 * Las que faltan van primero.
 *
 * Quien cuenta avanza por la lista de arriba abajo; dejar lo ya hecho
 * arriba lo obliga a buscar donde se quedo cada vez que vuelve a la
 * pantalla, y en un almacen eso se hace con una mano ocupada.
 */
export function ordenarParaContar(lineas: LineaConteo[]): LineaConteo[] {
  return [...lineas].sort((a, b) => {
    const pa = a.contado === null ? 0 : 1
    const pb = b.contado === null ? 0 : 1
    return pa - pb || a.nombre.localeCompare(b.nombre, 'es')
  })
}

export type ProblemaCantidad = 'vacio' | 'no-numero' | 'negativo' | 'demasiado'

/** Tope de cordura: mas que esto es casi siempre un digito de mas. */
export const MAX_CANTIDAD = 1_000_000

/**
 * Valida lo que se tecleo, ANTES de mandarlo.
 *
 * Devuelve el numero o el problema. Se valida aqui y no en el servidor
 * porque quien cuenta esta de pie en un pasillo: enterarse del error al
 * volver a la oficina es contar dos veces.
 *
 * El cero es VALIDO y es importante que lo sea: "no hay ninguno" es un
 * resultado de conteo, y el mas valioso de todos. Confundir cero con
 * "sin contar" es como se pierden los faltantes.
 */
export function leerCantidad(texto: string): { ok: true; valor: number } | { ok: false; problema: ProblemaCantidad } {
  const t = texto.trim().replace(',', '.')
  if (t === '') return { ok: false, problema: 'vacio' }

  const n = Number(t)
  if (!Number.isFinite(n)) return { ok: false, problema: 'no-numero' }
  if (n < 0) return { ok: false, problema: 'negativo' }
  if (n > MAX_CANTIDAD) return { ok: false, problema: 'demasiado' }

  return { ok: true, valor: n }
}

export const MENSAJE_PROBLEMA: Record<ProblemaCantidad, string> = {
  vacio: 'Escribe cuantos contaste. Si no hay ninguno, pon 0.',
  'no-numero': 'Solo numeros. Usa el punto para los decimales.',
  negativo: 'No se puede contar menos de cero.',
  demasiado: 'Ese numero es muy grande. ¿Se te fue un digito?',
}
