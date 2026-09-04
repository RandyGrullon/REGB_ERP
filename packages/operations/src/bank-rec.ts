import { roundBankers } from '@regb/core'

/**
 * Conciliacion bancaria — §5, modulo 20 (F6/S30-31).
 *
 * "Emparejamiento asistido con IA" del catalogo se implementa aqui como
 * lo que de verdad es defendible: un heuristico determinista -mismo
 * monto, mismo signo, fecha cercana-, nunca un modelo entrenado. SIEMPRE
 * es una sugerencia; quien confirma es una persona, nunca esta funcion.
 * Ver match_statement_line() en 0045_bank_rec.sql.
 */

export type BankTransactionType = 'deposit' | 'withdrawal' | 'transfer_in' | 'transfer_out'

const ENTRA: ReadonlySet<BankTransactionType> = new Set(['deposit', 'transfer_in'])

export interface StatementLineInput {
  id: string
  /** Signo del propio estado de cuenta: positivo entro, negativo salio. */
  amount: number
  lineDate: Date
}

export interface BankTransactionInput {
  id: string
  amount: number
  type: BankTransactionType
  transactionDate: Date
}

export interface MatchSuggestion {
  lineId: string
  transactionId: string
  daysApart: number
}

const MS_DIA = 86_400_000
const diasEntre = (a: Date, b: Date): number =>
  Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / MS_DIA)

/**
 * Sugiere emparejamientos entre lineas del estado y movimientos ya
 * registrados. Reglas: mismo signo (una linea que entro solo puede
 * emparejar con deposito/transfer_in), mismo monto exacto, y fecha dentro
 * de `maxDaysApart` dias.
 *
 * Se resuelve primero la linea con MENOS candidatos posibles: si dos
 * lineas podrian coincidir con el mismo movimiento, la que no tenia otra
 * opcion se queda con el, en vez de que la primera en procesarse por
 * casualidad se lo lleve y deje a la otra sin pareja.
 */
export function suggestMatches(
  lines: StatementLineInput[],
  transactions: BankTransactionInput[],
  maxDaysApart = 5,
): MatchSuggestion[] {
  const candidatosPorLinea = lines.map((linea) => {
    const entra = linea.amount > 0
    const candidatos = transactions.filter(
      (t) =>
        entra === ENTRA.has(t.type) &&
        roundBankers(Math.abs(t.amount) - Math.abs(linea.amount), 2) === 0 &&
        Math.abs(diasEntre(linea.lineDate, t.transactionDate)) <= maxDaysApart,
    )
    return { linea, candidatos }
  })

  candidatosPorLinea.sort((a, b) => a.candidatos.length - b.candidatos.length)

  const usadas = new Set<string>()
  const sugerencias: MatchSuggestion[] = []
  for (const { linea, candidatos } of candidatosPorLinea) {
    const disponibles = candidatos.filter((t) => !usadas.has(t.id))
    if (disponibles.length === 0) continue
    disponibles.sort(
      (a, b) =>
        Math.abs(diasEntre(linea.lineDate, a.transactionDate)) -
        Math.abs(diasEntre(linea.lineDate, b.transactionDate)),
    )
    const mejor = disponibles[0]!
    usadas.add(mejor.id)
    sugerencias.push({
      lineId: linea.id,
      transactionId: mejor.id,
      daysApart: Math.abs(diasEntre(linea.lineDate, mejor.transactionDate)),
    })
  }
  return sugerencias
}

export interface ReconciliationLine {
  status: 'pending' | 'matched' | 'ignored'
  amount: number
}

export interface ReconciliationSummary {
  matched: number
  pending: number
  ignored: number
  /** Lo que sigue sin explicacion: la suma absoluta de las lineas pendientes. */
  pendingAmount: number
}

/** Resumen de un import: cuanto ya se explico y cuanto sigue sin pareja. */
export function reconciliationSummary(lines: ReconciliationLine[]): ReconciliationSummary {
  let matched = 0
  let pending = 0
  let ignored = 0
  let pendingAmount = 0
  for (const l of lines) {
    if (l.status === 'matched') matched++
    else if (l.status === 'ignored') ignored++
    else {
      pending++
      pendingAmount += Math.abs(l.amount)
    }
  }
  return { matched, pending, ignored, pendingAmount: roundBankers(pendingAmount, 2) }
}
