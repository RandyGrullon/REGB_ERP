/**
 * Codigos de barra & RFID — §5.4, modulo 52.
 *
 * EAN-13 real: digito verificador calculado con el algoritmo oficial
 * de GS1 (no un numero aleatorio), y el patron de barras codificado
 * con las tablas L/G/R del estandar -para poder IMPRIMIR una etiqueta
 * real sin depender de una libreria externa-.
 *
 * Sin RFID: el nombre del catalogo lo menciona, pero no hay hardware
 * de lectura RFID que integrar en este sistema. Optico solamente.
 */

/** Digito verificador EAN-13: impares ×1 + pares ×3, resto de 10. */
export function digitoVerificadorEan13(base12: string): number {
  if (!/^\d{12}$/.test(base12)) {
    throw new Error('La base de un EAN-13 debe ser exactamente 12 digitos.')
  }
  const digitos = base12.split('').map(Number)
  let sumaImpar = 0
  let sumaPar = 0
  digitos.forEach((d, i) => {
    // i es indice 0-based; posicion 1-based i+1. Impar = 1,3,5...
    if ((i + 1) % 2 === 1) sumaImpar += d
    else sumaPar += d
  })
  const total = sumaImpar * 1 + sumaPar * 3
  return (10 - (total % 10)) % 10
}

/** Completa un EAN-13 valido a partir de sus primeros 12 digitos. */
export function generarEan13(base12: string): string {
  return `${base12}${digitoVerificadorEan13(base12)}`
}

/** Si un EAN-13 completo (13 digitos) tiene el digito verificador correcto. */
export function codigoEan13Valido(code13: string): boolean {
  if (!/^\d{13}$/.test(code13)) return false
  const base12 = code13.slice(0, 12)
  const verificador = Number(code13[12])
  return digitoVerificadorEan13(base12) === verificador
}

// ── Patron de barras (tablas del estandar GS1) ──────────────────────────

const CODIGO_L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
]
const CODIGO_G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
]
const CODIGO_R = CODIGO_L.map((s) =>
  s
    .split('')
    .map((b) => (b === '0' ? '1' : '0'))
    .join(''),
)

/** LLGLGG, etc.: que codigo (L o G) usa cada uno de los 6 digitos izquierdos, segun el primer digito. */
const PARIDAD_PRIMER_DIGITO = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
]

/**
 * Patron completo de 95 modulos (3 guarda + 42 izquierda + 5 guarda
 * central + 42 derecha + 3 guarda) -'1' es barra, '0' es espacio-. Con
 * esto se dibuja el codigo de barras entero sin ninguna libreria.
 */
export function patronBarrasEan13(code13: string): string {
  if (!codigoEan13Valido(code13)) {
    throw new Error('Ese EAN-13 no es valido -el digito verificador no coincide-.')
  }

  const primerDigito = Number(code13[0])
  const paridad = PARIDAD_PRIMER_DIGITO[primerDigito]!
  const izquierda = code13.slice(1, 7)
  const derecha = code13.slice(7, 13)

  const bloqueIzquierdo = izquierda
    .split('')
    .map((d, i) => (paridad[i] === 'L' ? CODIGO_L[Number(d)] : CODIGO_G[Number(d)]))
    .join('')
  const bloqueDerecho = derecha
    .split('')
    .map((d) => CODIGO_R[Number(d)])
    .join('')

  const GUARDA_LATERAL = '101'
  const GUARDA_CENTRAL = '01010'
  return `${GUARDA_LATERAL}${bloqueIzquierdo}${GUARDA_CENTRAL}${bloqueDerecho}${GUARDA_LATERAL}`
}
