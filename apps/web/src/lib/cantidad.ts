/**
 * Cantidades y dinero tal como los lee un almacenista o un comprador.
 *
 * La base guarda las cantidades como `numeric(14,3)` y postgres las
 * devuelve con sus tres decimales: "15.000". Pintarlas tal cual hacía que
 * quince sacos se leyeran como quince mil. Aquí se quitan los ceros que
 * sobran ("15", "2.5", "0.125") y se agrupan los miles ("1,200").
 */

const CANTIDAD = new Intl.NumberFormat('es-DO', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

const DINERO = new Intl.NumberFormat('es-DO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function numero(n: number | string | null | undefined): number | null {
  if (n === null || n === undefined || n === '') return null
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? v : null
}

/** Palabras cortas que sí son unidades (el resto de 3 letras o menos son abreviaturas). */
const PLURAL_FIJO: Record<string, string> = { kit: 'kits', par: 'pares', pie: 'pies' }

/**
 * El catálogo guarda la unidad en singular ("saco", "galón", "unidad");
 * "15 saco" se lee mal. Se pone en plural la primera palabra: vocal + s,
 * "-ón" → "-ones", consonante + es. Abreviaturas y símbolos (kg, und,
 * m³, lb.) se dejan como están.
 */
export function unidadEnPlural(unidad: string): string {
  const [primera = '', ...resto] = unidad.split(' ')
  const baja = primera.toLowerCase()
  let plural: string
  if (PLURAL_FIJO[baja]) plural = PLURAL_FIJO[baja]
  else if (
    primera.length <= 3 ||
    !/^[a-záéíóúñü]+$/i.test(primera) ||
    !/[aeiouáéíóú]/i.test(primera)
  )
    return unidad
  else if (/[aeiouáéó]$/i.test(primera)) plural = `${primera}s`
  else if (/ón$/i.test(primera)) plural = `${primera.slice(0, -2)}ones`
  else if (/z$/i.test(primera)) plural = `${primera.slice(0, -1)}ces`
  else if (/s$/i.test(primera)) return unidad
  else plural = `${primera}es`
  return [plural, ...resto].join(' ')
}

/** `15.000` → "15"; con unidad, "15 sacos" (y "1 saco"). */
export function cantidad(n: number | string | null | undefined, unidad?: string | null): string {
  const v = numero(n)
  if (v === null) return '—'
  const texto = CANTIDAD.format(v)
  if (!unidad) return texto
  return `${texto} ${v === 1 || v === -1 ? unidad : unidadEnPlural(unidad)}`
}

/** Con signo delante: "+20", "-3". Para diferencias de conteo y movimientos. */
export function cantidadConSigno(n: number | string | null | undefined): string {
  const v = numero(n)
  if (v === null) return '—'
  if (v > 0) return `+${CANTIDAD.format(v)}`
  if (v < 0) return `-${CANTIDAD.format(-v)}`
  return '0'
}

/** "RD$ 1,700.00" — el mismo formato que el resto de la app. */
export function pesos(n: number | string | null | undefined): string {
  const v = numero(n)
  if (v === null) return '—'
  return v < 0 ? `RD$ -${DINERO.format(-v)}` : `RD$ ${DINERO.format(v)}`
}

/**
 * Une frases con punto sin duplicarlo: una hora como "12:51 a. m." ya
 * termina en punto y "a. m.. Notas" se lee mal.
 */
export function unirFrases(partes: (string | null | undefined)[]): string {
  return partes
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => p.trim())
    .reduce((acc, p) => (acc === '' ? p : `${acc}${acc.endsWith('.') ? '' : '.'} ${p}`), '')
}
