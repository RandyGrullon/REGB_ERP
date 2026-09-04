import { roundBankers } from '@regb/core'

/**
 * Contabilidad general — §5, modulo 16 (F6/S28-29).
 *
 * Partida doble: cada asiento debe cuadrar (debito total = credito
 * total) antes de contabilizarse. Esta validacion existe en DOS lados a
 * proposito -aqui, para avisar antes de enviar, y en
 * `post_journal_entry()` en SQL, que es la que de verdad no se puede
 * saltar-. Ver 0041_accounting.sql.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

/**
 * El saldo normal de cada tipo de cuenta. Activo y gasto crecen por el
 * debito; pasivo, patrimonio e ingreso crecen por el credito. Sin esto
 * una balanza no dice nada -un pasivo con saldo "deudor" normal se leeria
 * al reves-.
 */
export function normalBalance(type: AccountType): 'debit' | 'credit' {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit'
}

/**
 * Saldo de una cuenta en la direccion de SU saldo normal. Un activo con
 * mas credito que debito da negativo a proposito: es una cuenta al
 * reves, y esconderlo como si fuera cero seria peor que mostrar el signo.
 */
export function accountBalance(type: AccountType, totalDebit: number, totalCredit: number): number {
  const diferencia =
    normalBalance(type) === 'debit' ? totalDebit - totalCredit : totalCredit - totalDebit
  return roundBankers(diferencia, 2)
}

export interface EntryLineInput {
  debit: number
  credit: number
}

/**
 * Valida un asiento ANTES de mandarlo al servidor, con las mismas tres
 * reglas que impone `post_journal_entry()` en SQL: al menos dos lineas,
 * cada linea es debito O credito (nunca las dos, nunca ninguna), y el
 * total debe cuadrar. Repetirla aqui es para avisar al instante; la de
 * SQL es la que de verdad protege el dato.
 */
export function validateEntryLines(
  lines: EntryLineInput[],
): { ok: true } | { ok: false; error: string } {
  if (lines.length < 2) {
    return { ok: false, error: 'Un asiento necesita al menos dos lineas.' }
  }
  for (const l of lines) {
    if (l.debit > 0 && l.credit > 0) {
      return { ok: false, error: 'Una linea no puede tener debito y credito a la vez.' }
    }
    if (l.debit === 0 && l.credit === 0) {
      return { ok: false, error: 'Una linea vacia no tiene sentido: ponle debito o credito.' }
    }
  }
  const totalDebito = roundBankers(
    lines.reduce((a, l) => a + l.debit, 0),
    2,
  )
  const totalCredito = roundBankers(
    lines.reduce((a, l) => a + l.credit, 0),
    2,
  )
  if (totalDebito !== totalCredito) {
    return {
      ok: false,
      error: `El asiento no cuadra: debito ${totalDebito.toFixed(2)} vs credito ${totalCredito.toFixed(2)}.`,
    }
  }
  return { ok: true }
}

export interface TrialBalanceRow {
  accountId: string
  accountCode: string
  accountName: string
  type: AccountType
  totalDebit: number
  totalCredit: number
}

export interface TrialBalanceReport {
  rows: (TrialBalanceRow & { balance: number })[]
  totalDebit: number
  totalCredit: number
  /** Si esto no es true, hay un asiento que se colo sin cuadrar. */
  balanced: boolean
}

/**
 * Arma la balanza de comprobacion a partir de los totales por cuenta.
 * `balanced` compara los totales generales, no cuenta por cuenta: una
 * balanza SIEMPRE cuadra en total si cada asiento cuadro al contabilizarse,
 * asi que si esto da false es la senal de que algo se salto la regla.
 */
export function buildTrialBalance(rows: TrialBalanceRow[]): TrialBalanceReport {
  const conSaldo = rows.map((r) => ({ ...r, balance: accountBalance(r.type, r.totalDebit, r.totalCredit) }))
  const totalDebit = roundBankers(
    rows.reduce((a, r) => a + r.totalDebit, 0),
    2,
  )
  const totalCredit = roundBankers(
    rows.reduce((a, r) => a + r.totalCredit, 0),
    2,
  )
  return { rows: conSaldo, totalDebit, totalCredit, balanced: totalDebit === totalCredit }
}
