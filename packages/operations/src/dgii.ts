/**
 * Cumplimiento fiscal dominicano — DGII.
 *
 * Logica pura: validacion de RNC/cedula y formato de NCF. Vive aqui y no
 * en el modulo de facturacion porque la usan tres sitios distintos —
 * clientes, facturas y los reportes 606/607— y porque es el area que mas
 * cambia por decreto: aislada y con tests, un cambio de norma se atiende
 * en un archivo (riesgo 5 del documento maestro).
 */

// ── Tipos de comprobante ─────────────────────────────────────────────────

/**
 * NCF clasico (11 caracteres, serie B) y e-CF (13 caracteres, serie E).
 * La DGII migro a e-CF, pero el NCF impreso sigue vigente para quien aun
 * no esta obligado — un colmado tipico factura con B02 todavia.
 */
export type NcfType =
  | 'B01' // Credito fiscal: el cliente descuenta el ITBIS
  | 'B02' // Consumo: consumidor final
  | 'B04' // Nota de credito
  | 'B14' // Regimen especial
  | 'B15' // Gubernamental
  | 'B16' // Exportaciones
  // Los diez tipos de e-CF que publica la DGII. No hay otros: la lista
  // oficial de proveedores autorizados certifica exactamente para
  // "31, 32, 33, 34, 41, 43, 44, 45, 46, 47".
  | 'E31' // e-CF credito fiscal
  | 'E32' // e-CF consumo
  | 'E33' // e-CF nota de debito
  | 'E34' // e-CF nota de credito
  | 'E41' // e-CF compras
  | 'E43' // e-CF gastos menores
  | 'E44' // e-CF regimenes especiales
  | 'E45' // e-CF gubernamental
  | 'E46' // e-CF exportaciones
  | 'E47' // e-CF pagos al exterior

export const NCF_LABELS: Record<NcfType, string> = {
  B01: 'Credito fiscal',
  B02: 'Consumo',
  B04: 'Nota de credito',
  B14: 'Regimen especial',
  B15: 'Gubernamental',
  B16: 'Exportaciones',
  E31: 'e-CF credito fiscal',
  E32: 'e-CF consumo',
  E33: 'e-CF nota de debito',
  E34: 'e-CF nota de credito',
  E41: 'e-CF compras',
  E43: 'e-CF gastos menores',
  E44: 'e-CF regimenes especiales',
  E45: 'e-CF gubernamental',
  E46: 'e-CF exportaciones',
  E47: 'e-CF pagos al exterior',
}

/** Los de la serie E son electronicos: se transmiten a la DGII. */
export function isElectronic(tipo: NcfType): boolean {
  return tipo.startsWith('E')
}

/**
 * Un comprobante de credito fiscal EXIGE RNC del comprador: es lo que le
 * permite descontarse el ITBIS. Sin RNC solo se puede emitir consumo.
 */
export function requiresBuyerTaxId(tipo: NcfType): boolean {
  return (
    tipo === 'B01' ||
    tipo === 'B14' ||
    tipo === 'B15' ||
    tipo === 'E31' ||
    tipo === 'E44' ||
    tipo === 'E45'
  )
}

/**
 * Arma el NCF completo. El clasico lleva 8 digitos de secuencia; el e-CF,
 * 10. Rellenar con la longitud equivocada es rechazo directo de la DGII.
 */
export function formatNcf(tipo: NcfType, secuencia: number): string {
  if (secuencia <= 0 || !Number.isInteger(secuencia)) {
    throw new Error(`La secuencia debe ser un entero positivo; se recibio ${secuencia}`)
  }
  const digitos = isElectronic(tipo) ? 10 : 8
  const max = 10 ** digitos - 1
  if (secuencia > max) {
    throw new Error(`La secuencia ${secuencia} excede el maximo de ${max} para ${tipo}`)
  }
  return `${tipo}${String(secuencia).padStart(digitos, '0')}`
}

// El e-NCF son 13 caracteres: "E" + 2 de tipo + 10 de secuencia. Ese
// largo esta confirmado contra la DGII -"la letra E indica la serie, los
// siguientes 2 digitos el tipo y los ultimos 10 el secuencial"-. El NCF
// clasico de la serie B lleva 8.
const NCF_RE = /^(B0[1245]|B1[456]|E3[1234]|E4[134567])(\d{8}|\d{10})$/

/** Valida forma y coherencia: un B lleva 8 digitos, un E lleva 10. */
export function isValidNcf(ncf: string): boolean {
  const m = NCF_RE.exec(ncf.trim().toUpperCase())
  if (!m) return false
  const tipo = m[1] as NcfType
  const esperados = isElectronic(tipo) ? 10 : 8
  return m[2]!.length === esperados
}

// ── RNC y cedula ─────────────────────────────────────────────────────────

/**
 * Digito verificador del RNC (9 digitos) y de la cedula (11).
 *
 * Ambos usan modulo 11 con pesos distintos. Validar aqui evita el caso
 * clasico: se factura todo el mes a un RNC con un digito mal escrito y el
 * 607 completo lo rechaza la DGII cuando ya no hay tiempo de corregirlo.
 */
const PESOS_RNC = [7, 9, 8, 6, 5, 4, 3, 2]
const PESOS_CEDULA = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2]

export function normalizeTaxId(raw: string): string {
  return raw.replace(/\D/g, '')
}

export function isValidRnc(raw: string): boolean {
  const d = normalizeTaxId(raw)
  if (d.length !== 9) return false

  const suma = PESOS_RNC.reduce((acc, p, i) => acc + p * Number(d[i]), 0)
  const resto = suma % 11
  const verificador = resto === 0 ? 2 : resto === 1 ? 1 : 11 - resto
  return verificador === Number(d[8])
}

export function isValidCedula(raw: string): boolean {
  const d = normalizeTaxId(raw)
  if (d.length !== 11) return false

  let suma = 0
  for (let i = 0; i < 10; i++) {
    const producto = Number(d[i]) * PESOS_CEDULA[i]!
    // Si el producto pasa de 9 se suman sus digitos (Luhn clasico).
    suma += producto > 9 ? Math.floor(producto / 10) + (producto % 10) : producto
  }
  const verificador = (10 - (suma % 10)) % 10
  return verificador === Number(d[10])
}

/** Acepta cualquiera de los dos: un cliente puede ser empresa o persona. */
export function isValidTaxId(raw: string): boolean {
  const d = normalizeTaxId(raw)
  return d.length === 9 ? isValidRnc(d) : d.length === 11 ? isValidCedula(d) : false
}

/** Formato legible: 130-11111-1 para RNC, 001-0000000-1 para cedula. */
export function formatTaxId(raw: string): string {
  const d = normalizeTaxId(raw)
  if (d.length === 9) return `${d.slice(0, 3)}-${d.slice(3, 8)}-${d.slice(8)}`
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`
  return raw
}

// ── Secuencias autorizadas ───────────────────────────────────────────────

export interface NcfSequenceState {
  tipo: NcfType
  desde: number
  hasta: number
  proximo: number
  vence: Date
}

export interface SequenceHealth {
  restantes: number
  agotada: boolean
  vencida: boolean
  /** Quedan pocos: hay que pedir autorizacion nueva a la DGII, y tarda. */
  porAgotarse: boolean
}

/**
 * Estado de una secuencia. El aviso temprano importa: pedirle a la DGII
 * una autorizacion nueva no es inmediato, y quedarse sin NCF significa no
 * poder facturar — el negocio se detiene.
 */
export function sequenceHealth(s: NcfSequenceState, asOf: Date, umbralAviso = 50): SequenceHealth {
  const restantes = Math.max(0, s.hasta - s.proximo + 1)
  return {
    restantes,
    agotada: restantes === 0,
    vencida: s.vence < asOf,
    porAgotarse: restantes > 0 && restantes <= umbralAviso,
  }
}

/** ¿Se puede emitir con esta secuencia ahora mismo? */
export function canIssue(s: NcfSequenceState, asOf: Date): boolean {
  const h = sequenceHealth(s, asOf)
  return !h.agotada && !h.vencida
}
