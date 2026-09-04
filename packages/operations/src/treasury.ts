import { roundBankers } from '@regb/core'

/**
 * Tesoreria & Bancos — §5, modulo 19 (F6/S30).
 *
 * Dos piezas de logica pura: el saldo de una cuenta (mismo principio
 * derivado que accountBalance()/invoice_balance()) y el flujo de caja
 * proyectado, que junta ese saldo real con lo que ar espera cobrar y ap
 * espera pagar. La composicion de fuentes es justo lo que no puede vivir
 * en SQL: no es una invariante de una tabla, es una regla de negocio.
 * Ver 0044_treasury.sql.
 */

/** saldo_inicial + entradas - salidas. Espejo puro de bank_account_balance() en SQL. */
export function bankAccountBalance(openingBalance: number, totalIn: number, totalOut: number): number {
  return roundBankers(openingBalance + totalIn - totalOut, 2)
}

/**
 * Valida una transferencia ANTES de mandarla al servidor, con las mismas
 * reglas que impone la tabla (`check (from_account_id <> to_account_id)`,
 * `check (amount > 0)`). Repetirla aqui es para avisar al instante.
 */
export function validateTransfer(
  fromAccountId: string,
  toAccountId: string,
  amount: number,
): { ok: true } | { ok: false; error: string } {
  if (!fromAccountId || !toAccountId) {
    return { ok: false, error: 'Elige la cuenta de origen y la de destino.' }
  }
  if (fromAccountId === toAccountId) {
    return { ok: false, error: 'La cuenta de origen y la de destino no pueden ser la misma.' }
  }
  if (amount <= 0) {
    return { ok: false, error: 'El monto debe ser mayor que cero.' }
  }
  return { ok: true }
}

export interface ProjectedItem {
  dueDate: Date
  amount: number
}

export interface CashFlowWeek {
  weekStart: Date
  weekEnd: Date
  projectedIn: number
  projectedOut: number
  net: number
  runningBalance: number
}

const MS_DIA = 86_400_000
const MS_SEMANA = 7 * MS_DIA

const inicioDelDia = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * Arma el flujo de caja proyectado en semanas, empezando por el saldo real
 * de hoy. `inflows`/`outflows` son las facturas abiertas de ar/ap -o
 * cualquier otra entrada conocida-; quien llama decide si existen o vienen
 * vacias segun que modulos tenga activos el tenant.
 *
 * Una factura ya vencida (dueDate < asOf) cae en la semana 0: ya deberia
 * haber entrado o salido, asi que cuenta como "ahora", no se pierde por
 * quedar en el pasado. Una factura mas alla del horizonte simplemente no
 * aparece -esto es una proyeccion de las proximas N semanas, no un
 * historial-.
 */
export function buildCashFlowProjection(
  startingBalance: number,
  inflows: ProjectedItem[],
  outflows: ProjectedItem[],
  asOf: Date,
  weeks = 8,
): CashFlowWeek[] {
  const inicio = inicioDelDia(asOf)

  const semanas: CashFlowWeek[] = Array.from({ length: weeks }, (_, i) => {
    const inicioSemana = inicio + i * MS_SEMANA
    return {
      weekStart: new Date(inicioSemana),
      weekEnd: new Date(inicioSemana + 6 * MS_DIA),
      projectedIn: 0,
      projectedOut: 0,
      net: 0,
      runningBalance: 0,
    }
  })

  const indiceSemana = (fecha: Date): number | null => {
    const dia = inicioDelDia(fecha)
    if (dia <= inicio) return 0
    const idx = Math.floor((dia - inicio) / MS_SEMANA)
    return idx < weeks ? idx : null
  }

  for (const item of inflows) {
    const idx = indiceSemana(item.dueDate)
    if (idx !== null) semanas[idx]!.projectedIn = roundBankers(semanas[idx]!.projectedIn + item.amount, 2)
  }
  for (const item of outflows) {
    const idx = indiceSemana(item.dueDate)
    if (idx !== null) semanas[idx]!.projectedOut = roundBankers(semanas[idx]!.projectedOut + item.amount, 2)
  }

  let corriendo = startingBalance
  for (const semana of semanas) {
    semana.net = roundBankers(semana.projectedIn - semana.projectedOut, 2)
    corriendo = roundBankers(corriendo + semana.net, 2)
    semana.runningBalance = corriendo
  }

  return semanas
}

/** Primera semana donde el efectivo proyectado se pone en rojo, o null si nunca pasa. */
export function firstShortfallWeek(weeks: CashFlowWeek[]): number | null {
  const idx = weeks.findIndex((w) => w.runningBalance < 0)
  return idx === -1 ? null : idx
}
