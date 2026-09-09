/**
 * El "copiloto" NUNCA genera SQL libre ni llama a un modelo de lenguaje
 * real -es el riesgo de fuga entre tenants que el documento maestro
 * senala explicitamente para este modulo-. En cambio empareja la
 * pregunta en espanol con un catalogo FIJO de preguntas ya vetadas por
 * palabras clave, exactamente el mismo criterio de "elegir, nunca
 * escribir SQL" que ya uso `bi`.
 */
export interface PreguntaCatalogo {
  key: string
  palabrasClave: string[]
}

/** Devuelve la key de la pregunta del catalogo con mas palabras clave en comun, o null si ninguna coincide. */
export function emparejarPregunta(entrada: string, catalogo: PreguntaCatalogo[]): string | null {
  const normalizada = entrada.toLowerCase()
  let mejor: { key: string; puntaje: number } | null = null

  for (const p of catalogo) {
    const puntaje = p.palabrasClave.filter((k) => normalizada.includes(k.toLowerCase())).length
    if (puntaje > 0 && (!mejor || puntaje > mejor.puntaje)) {
      mejor = { key: p.key, puntaje }
    }
  }

  return mejor?.key ?? null
}
