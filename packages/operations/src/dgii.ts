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

// ── Que comprobante lleva una factura de credito ─────────────────────────

/** Lo que pide quien factura. `auto` = decidelo por el RNC del cliente. */
export type InvoiceNcfRequest = 'auto' | 'B01' | 'B02'

export type InvoiceNcfDecision =
  | {
      ok: true
      tipo: 'B01' | 'B02'
      /** El RNC que viaja al 607, en digitos. null si no hay uno valido. */
      buyerTaxId: string | null
    }
  | { ok: false; code: 'missing-tax-id' | 'invalid-tax-id'; error: string }

/**
 * Decide B01 o B02 SIN adivinar en silencio.
 *
 * Antes: RNC valido -> B01; cualquier otra cosa -> B02. Un cliente con
 * el RNC mal digitado pedia credito fiscal y recibia consumo sin que
 * nadie se enterara, hasta que su contador reclamaba el ITBIS que no se
 * pudo descontar.
 *
 * Ahora:
 *  - `B02` pedido a proposito: se emite consumo. Un RNC invalido no viaja
 *    al 607 (lo rebotaria entero); uno valido si, porque es informacion.
 *  - `B01` pedido: sin RNC valido es un error que dice por que.
 *  - `auto`: sin RNC, consumo (el consumidor final de siempre); con RNC
 *    valido, credito fiscal; con RNC INVALIDO, error: el cliente dio un
 *    RNC porque queria credito fiscal, y darle otra cosa sin avisar es
 *    exactamente el bug.
 */
export function chooseInvoiceNcf(
  requested: InvoiceNcfRequest,
  taxIdRaw: string | null,
): InvoiceNcfDecision {
  const digitos = taxIdRaw ? normalizeTaxId(taxIdRaw) : ''
  const tiene = digitos !== ''
  const valido = tiene && isValidTaxId(digitos)

  const invalido = (): InvoiceNcfDecision => ({
    ok: false,
    code: 'invalid-tax-id',
    error:
      `El RNC/cedula del cliente (${formatTaxId(taxIdRaw ?? '')}) no es valido: el digito ` +
      'verificador no cuadra, y la DGII rechazaria el credito fiscal en el 607. Corrigelo en la ' +
      'ficha del cliente, o elige "Consumo (B02)" si de verdad es consumidor final.',
  })

  if (requested === 'B02') return { ok: true, tipo: 'B02', buyerTaxId: valido ? digitos : null }

  if (requested === 'B01') {
    if (!tiene) {
      return {
        ok: false,
        code: 'missing-tax-id',
        error:
          'Para credito fiscal (B01) el cliente necesita RNC o cedula y no tiene ninguno ' +
          'registrado. Agregalo en su ficha, o factura como consumo (B02).',
      }
    }
    return valido ? { ok: true, tipo: 'B01', buyerTaxId: digitos } : invalido()
  }

  if (!tiene) return { ok: true, tipo: 'B02', buyerTaxId: null }
  return valido ? { ok: true, tipo: 'B01', buyerTaxId: digitos } : invalido()
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

// ── Fecha fiscal ─────────────────────────────────────────────────────────

/**
 * Republica Dominicana no cambia de hora: UTC-4 todo el año. Offset fijo,
 * igual que `horaEsperadaEnRD()` en attendance.ts, porque el servidor
 * corre en UTC y `toISOString()` / `getMonth()` darian el dia del servidor.
 *
 * Es la MISMA regla que `public.fecha_fiscal()` en la base (0129). Si se
 * toca una, se toca la otra: el 607 lo arma la base y la pantalla elige el
 * periodo con esta.
 */
const OFFSET_FISCAL_MS = -4 * 3_600_000

/**
 * El dia calendario en Santo Domingo, como `AAAA-MM-DD`.
 *
 * Una venta del 30 a las 9 p. m. es del 30: en UTC ya es el 1 y caia en
 * el 607 y el IT-1 del mes siguiente.
 */
export function fechaFiscal(momento: Date): string {
  const rd = new Date(momento.getTime() + OFFSET_FISCAL_MS)
  const mes = String(rd.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(rd.getUTCDate()).padStart(2, '0')
  return `${rd.getUTCFullYear()}-${mes}-${dia}`
}

/** El periodo DGII (`AAAAMM`) del momento, contado en Santo Domingo. */
export function periodoFiscal(momento: Date): string {
  return fechaFiscal(momento).slice(0, 7).replace('-', '')
}
