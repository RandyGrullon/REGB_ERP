import { roundBankers } from '@regb/core'
import { z } from 'zod'

/**
 * Nomina — §5.6, modulo 62 (F7/S37-38; reglas de periodo y topes: 0132).
 *
 * NINGUNA tasa, tope ni tramo vive en este archivo. Salen de la tabla
 * `public.payroll_tax_params` (una fila por vigencia, con su fuente) y
 * llegan aqui como parametro (`PayrollTaxParams`, via
 * `parametrosDesdeFila()`). Hasta 0132 habia una constante
 * `TASAS_TSS_REFERENCIA_2024` con UN solo tope para AFP y SFS juntos
 * (415,492, que ademas no correspondia a ninguna resolucion de la TSS):
 * el SFS cotiza hasta 10 salarios minimos y la AFP hasta 20, asi que un
 * salario entre los dos topes pagaba SFS de mas.
 *
 * ── Regla de periodos (documentada en docs/modules/payroll.md) ──────
 *
 * El salario pactado es MENSUAL y se paga por unidad de tiempo (Codigo de
 * Trabajo, Ley 16-92, libro del salario). La nomina usa el MES COMERCIAL
 * de 30 dias -la base de salario diario = salario mensual / 30 que ya
 * usaba `proratedSalary()`-:
 *
 *  · un periodo vale sus dias comerciales / 30 de un salario: el mes, 1;
 *    cada quincena (1-15 y 16-fin), 1/2 -tenga el mes 28, 30 o 31 dias-;
 *  · el dia 31 no suma y el ultimo de febrero completa hasta 30. Asi
 *    CUALQUIER forma de partir el ano en periodos suma 360 dias = 12
 *    salarios: ni quincenas ni semanas pagan de mas;
 *  · quien entra o sale dentro del periodo cobra los dias comerciales que
 *    estuvo contratado. Si lo unico que trabajo de un mes es el dia 31,
 *    ese dia vale 1: el trabajo hecho se paga.
 *
 * El 23.83 (dias laborables promedio del mes) es la base del salario
 * diario para PRESTACIONES y vacaciones, no para el salario ordinario de
 * un periodo: por eso no se usa aqui.
 */

// ═══════════════════════════════════════════════════════════════════════
//  Parametros: de la fila de la base a lo que usa la formula
// ═══════════════════════════════════════════════════════════════════════

export interface IncomeTaxBracket {
  /** Limite inferior ANUAL de este tramo, en RD$. */
  from: number
  /** Limite superior ANUAL, o null si es el ultimo tramo -sin techo-. */
  to: number | null
  /** Tasa marginal de este tramo, como fraccion (0.15 = 15%). */
  rate: number
  /** Impuesto ya acumulado de los tramos anteriores, para no recalcularlo. */
  baseAmount: number
}

export interface PayrollTaxParams {
  /** Tasa de AFP (pensiones, SVDS) a cargo del empleado. */
  afpEmployeeRate: number
  /** Tasa de SFS (salud) a cargo del empleado. */
  sfsEmployeeRate: number
  /** Tope MENSUAL cotizable del SFS, en RD$ (10 salarios minimos cotizables). */
  sfsCap: number
  /** Tope MENSUAL cotizable de la AFP, en RD$ (20 salarios minimos cotizables). */
  afpCap: number
  /** Tramos del ISR, anuales, de menor a mayor, sin huecos entre ellos. */
  incomeTaxBrackets: IncomeTaxBracket[]
  /** De que fila salieron -va en la foto que guarda cada periodo procesado-. */
  vigencia?: {
    desde: string
    salarioMinimoCotizable: number
    fuente: string
    verificado: boolean
  }
}

/** Una fila de `public.payroll_tax_params` tal como la devuelve postgres (numeric llega como texto). */
export interface FilaParametrosNomina {
  valid_from: string | Date
  min_contribution_wage: string | number
  sfs_cap_multiple: string | number
  afp_cap_multiple: string | number
  sfs_employee_rate: string | number
  afp_employee_rate: string | number
  income_tax_brackets: unknown
  source: string
  verified: boolean
}

const numero = z.coerce.number().finite()
const tasa = numero.min(0).max(1)

const tramoSchema = z.object({
  from: numero.min(0),
  to: numero.positive().nullable(),
  rate: tasa,
  baseAmount: numero.min(0),
})

const filaSchema = z.object({
  valid_from: z.union([z.string(), z.date()]),
  min_contribution_wage: numero.positive(),
  sfs_cap_multiple: numero.positive(),
  afp_cap_multiple: numero.positive(),
  sfs_employee_rate: tasa,
  afp_employee_rate: tasa,
  income_tax_brackets: z.array(tramoSchema).min(1),
  source: z.string().min(1),
  verified: z.boolean(),
})

/**
 * Convierte la fila vigente de la tabla en los parametros de la formula.
 * Valida lo que un error de captura romperia en silencio: una tasa fuera
 * de 0-1, o una escala de ISR con huecos, desordenada o sin tramo final.
 */
export function parametrosDesdeFila(fila: FilaParametrosNomina): PayrollTaxParams {
  const f = filaSchema.parse(fila)
  const tramos = f.income_tax_brackets

  if (tramos[0]!.from !== 0) throw new Error('La escala de ISR tiene que empezar en 0.')
  tramos.forEach((t, i) => {
    const siguiente = tramos[i + 1]
    if (siguiente === undefined) {
      if (t.to !== null) throw new Error('La escala de ISR necesita un ultimo tramo sin techo.')
      return
    }
    if (t.to === null || t.to !== siguiente.from || t.to <= t.from) {
      throw new Error(`La escala de ISR tiene un hueco o esta desordenada en el tramo ${i + 1}.`)
    }
  })

  const smc = f.min_contribution_wage
  const desde =
    f.valid_from instanceof Date
      ? f.valid_from.toISOString().slice(0, 10)
      : f.valid_from.slice(0, 10)

  return {
    sfsEmployeeRate: f.sfs_employee_rate,
    afpEmployeeRate: f.afp_employee_rate,
    sfsCap: roundBankers(smc * f.sfs_cap_multiple, 2),
    afpCap: roundBankers(smc * f.afp_cap_multiple, 2),
    incomeTaxBrackets: tramos,
    vigencia: { desde, salarioMinimoCotizable: smc, fuente: f.source, verificado: f.verified },
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  TSS e ISR
// ═══════════════════════════════════════════════════════════════════════

function validarFraccion(fraccion: number): void {
  if (!Number.isFinite(fraccion) || fraccion <= 0) {
    throw new Error(`La fraccion de mes del periodo tiene que ser positiva; se recibio ${fraccion}`)
  }
}

/**
 * TSS retenida al empleado, cada seguro sobre su propio tope. En un
 * periodo que no es un mes, el tope se escala por la fraccion de mes del
 * periodo: dos quincenas cotizan exactamente lo de un mes.
 */
export function tssDesglose(
  grossForPeriod: number,
  params: PayrollTaxParams,
  fraccionPeriodo = 1,
): { sfs: number; afp: number; total: number } {
  validarFraccion(fraccionPeriodo)
  const sfs = roundBankers(
    Math.min(grossForPeriod, params.sfsCap * fraccionPeriodo) * params.sfsEmployeeRate,
    2,
  )
  const afp = roundBankers(
    Math.min(grossForPeriod, params.afpCap * fraccionPeriodo) * params.afpEmployeeRate,
    2,
  )
  return { sfs, afp, total: roundBankers(sfs + afp, 2) }
}

/** TSS total retenida (SFS + AFP). */
export function tssEmployeeDeduction(
  grossForPeriod: number,
  params: PayrollTaxParams,
  fraccionPeriodo = 1,
): number {
  return tssDesglose(grossForPeriod, params, fraccionPeriodo).total
}

/** ISR sobre un ingreso ANUAL, aplicando la tabla progresiva por tramos. */
export function annualIncomeTax(annualTaxableIncome: number, brackets: IncomeTaxBracket[]): number {
  if (annualTaxableIncome <= 0) return 0
  const tramo = brackets.find(
    (b) => annualTaxableIncome > b.from && (b.to === null || annualTaxableIncome <= b.to),
  )
  if (!tramo) return 0
  return roundBankers(tramo.baseAmount + (annualTaxableIncome - tramo.from) * tramo.rate, 2)
}

/**
 * ISR retenido de UN mes: proyecta el salario gravado (ya descontada la
 * TSS del mes) a un ano, busca el impuesto anual, y lo reparte entre 12
 * -el metodo real que usa una nomina dominicana, no un atajo-.
 */
export function monthlyIncomeTaxWithholding(
  monthlyGrossSalary: number,
  monthlyTssDeduction: number,
  brackets: IncomeTaxBracket[],
): number {
  const baseMensual = Math.max(0, monthlyGrossSalary - monthlyTssDeduction)
  const anualizado = annualIncomeTax(baseMensual * 12, brackets)
  return roundBankers(anualizado / 12, 2)
}

export interface OpcionesLinea {
  /** Fraccion de mes que vale el PERIODO (quincena = 0.5). Por defecto, un mes. */
  fraccionPeriodo?: number
  /** Ingresos que no son salario ni base de TSS/ISR: reembolsos de gastos. */
  ingresosNoGravados?: number
  /** Descuentos despues de impuestos: cuotas de prestamos internos. */
  otrosDescuentos?: number
}

export interface PayrollLineResult {
  grossSalary: number
  sfsDeduction: number
  afpDeduction: number
  tssDeduction: number
  incomeTax: number
  nonTaxableIncome: number
  otherDeductions: number
  netSalary: number
}

/**
 * El desglose de UN periodo: bruto (ya prorrateado), TSS, ISR, ingresos
 * no gravados, otros descuentos y neto. El ISR de un periodo que no es un
 * mes se calcula llevando su base a mes (base / fraccion), aplicando el
 * metodo mensual y volviendo a la fraccion: dos quincenas iguales retienen
 * lo mismo que un mes.
 */
export function calculatePayrollLine(
  grossForPeriod: number,
  params: PayrollTaxParams,
  opciones: OpcionesLinea = {},
): PayrollLineResult {
  const f = opciones.fraccionPeriodo ?? 1
  validarFraccion(f)
  const noGravados = opciones.ingresosNoGravados ?? 0
  const otros = opciones.otrosDescuentos ?? 0

  const tss = tssDesglose(grossForPeriod, params, f)
  const incomeTax =
    f === 1
      ? monthlyIncomeTaxWithholding(grossForPeriod, tss.total, params.incomeTaxBrackets)
      : roundBankers(
          monthlyIncomeTaxWithholding(grossForPeriod / f, tss.total / f, params.incomeTaxBrackets) *
            f,
          2,
        )
  const netSalary = roundBankers(grossForPeriod + noGravados - tss.total - incomeTax - otros, 2)
  return {
    grossSalary: grossForPeriod,
    sfsDeduction: tss.sfs,
    afpDeduction: tss.afp,
    tssDeduction: tss.total,
    incomeTax,
    nonTaxableIncome: noGravados,
    otherDeductions: otros,
    netSalary,
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Periodos: mes comercial y prorrateo
// ═══════════════════════════════════════════════════════════════════════

/** Fecha calendario `yyyy-mm-dd`, sin zona: la nomina se piensa en dias de RD. */
export type FechaISO = string

function partes(f: FechaISO): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f)
  if (!m) throw new Error(`Fecha invalida: "${f}". Formato: yyyy-mm-dd.`)
  const [y, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mes < 1 || mes > 12 || d < 1 || d > diasDelMes(y, mes)) {
    throw new Error(`Fecha invalida: "${f}".`)
  }
  return [y, mes, d]
}

function diasDelMes(y: number, mes: number): number {
  return new Date(Date.UTC(y, mes, 0)).getUTCDate()
}

function iso(y: number, mes: number, d: number): FechaISO {
  return `${String(y).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function diaSiguiente(f: FechaISO): FechaISO {
  const [y, mes, d] = partes(f)
  if (d < diasDelMes(y, mes)) return iso(y, mes, d + 1)
  return mes === 12 ? iso(y + 1, 1, 1) : iso(y, mes + 1, 1)
}

/**
 * Dias comerciales ANTES de una fecha. Cada mes vale 30: el dia 31 cae en
 * el mismo indice que el 1 del mes siguiente (no suma) y el ultimo de
 * febrero completa hasta 30.
 */
function indiceComercial(f: FechaISO): number {
  const [y, mes, d] = partes(f)
  return (y * 12 + (mes - 1)) * 30 + Math.min(d - 1, 30)
}

/** Dias comerciales de `desde` a `hasta`, ambos incluidos. */
export function diasComerciales(desde: FechaISO, hasta: FechaISO): number {
  if (hasta < desde) {
    partes(desde)
    partes(hasta)
    return 0
  }
  return indiceComercial(diaSiguiente(hasta)) - indiceComercial(desde)
}

/** Fraccion de mes que vale un periodo: mes = 1, quincena = 0.5. */
export function fraccionDeMes(desde: FechaISO, hasta: FechaISO): number {
  return diasComerciales(desde, hasta) / 30
}

/**
 * Dias comerciales de un tramo PARCIAL: mes por mes, y un mes en el que
 * solo se trabajo el 31 cuenta 1 -el trabajo hecho se paga-.
 */
function diasDeTramoParcial(desde: FechaISO, hasta: FechaISO): number {
  let total = 0
  let inicio = desde
  while (inicio <= hasta) {
    const [y, mes] = partes(inicio)
    const finDeMes = iso(y, mes, diasDelMes(y, mes))
    const fin = finDeMes < hasta ? finDeMes : hasta
    total += Math.max(1, diasComerciales(inicio, fin))
    inicio = diaSiguiente(fin)
  }
  return total
}

export interface PeriodoNomina {
  desde: FechaISO
  hasta: FechaISO
}

export interface EmpleoEnFechas {
  /** Fecha de ingreso. */
  ingreso: FechaISO
  /** Fecha de salida (baja), o null si sigue. */
  salida: FechaISO | null
}

/**
 * Lo que le toca a un empleado en un periodo por su salario mensual. Null
 * si no estuvo contratado ningun dia del periodo.
 */
export function salarioDelPeriodo(
  salarioMensual: number,
  periodo: PeriodoNomina,
  empleo: EmpleoEnFechas,
): { dias: number; bruto: number; completo: boolean } | null {
  const desde = empleo.ingreso > periodo.desde ? empleo.ingreso : periodo.desde
  const hasta =
    empleo.salida !== null && empleo.salida < periodo.hasta ? empleo.salida : periodo.hasta
  if (hasta < desde) return null

  const diasPeriodo = diasComerciales(periodo.desde, periodo.hasta)
  const completo = desde === periodo.desde && hasta === periodo.hasta
  const dias = completo ? diasPeriodo : Math.min(diasPeriodo, diasDeTramoParcial(desde, hasta))
  return { dias, bruto: roundBankers((salarioMensual * dias) / 30, 2), completo }
}

// ═══════════════════════════════════════════════════════════════════════
//  Prestamos internos descontados por nomina
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cuanto se descuenta de cada prestamo en este periodo, en orden: la
 * cuota (mensual) por la fraccion de mes del periodo, nunca mas que el
 * saldo, y nunca mas de lo que queda del neto -el neto no baja de cero;
 * lo que no alcanza sigue en el saldo para el siguiente periodo-.
 */
export function descuentosDePrestamos(
  prestamos: { id: string; cuota: number; saldo: number }[],
  fraccionPeriodo: number,
  netoDisponible: number,
): { id: string; monto: number }[] {
  validarFraccion(fraccionPeriodo)
  let queda = Math.max(0, roundBankers(netoDisponible, 2))
  const out: { id: string; monto: number }[] = []
  for (const p of prestamos) {
    const monto = roundBankers(Math.min(p.cuota * fraccionPeriodo, p.saldo, queda), 2)
    if (monto <= 0) continue
    out.push({ id: p.id, monto })
    queda = roundBankers(queda - monto, 2)
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════
//  Prestaciones
// ═══════════════════════════════════════════════════════════════════════

/** Regalia pascual (Ley 76-1962): 1/12 de lo devengado en el ano -exenta de ISR hasta el tope legal, no aplicado aqui-. */
export function christmasBonus(annualGrossEarnings: number): number {
  return roundBankers(annualGrossEarnings / 12, 2)
}

/**
 * Dias de cesantia por antiguedad completa (Codigo de Trabajo Art. 82),
 * SOLO el caso general de despido sin causa justificada -no cubre las
 * excepciones (dimision, causa justificada, contrato por tiempo
 * determinado), que son una decision legal caso por caso-. Los primeros
 * 5 anos se pagan a 21 dias por ano, y SOLO el excedente sobre 5 anos se
 * paga a 23 -no los 23 aplicados a la antiguedad completa-. Esta es la
 * pieza de todo el modulo que mas necesita revision de un abogado
 * laboral antes de usarse para liquidar a alguien de verdad.
 */
export function severanceDays(monthsOfService: number): number {
  if (monthsOfService < 3) return 0
  if (monthsOfService < 6) return 6
  if (monthsOfService < 12) return 13
  const anosCompletos = Math.floor(monthsOfService / 12)
  const primerTramo = Math.min(anosCompletos, 5)
  const segundoTramo = Math.max(0, anosCompletos - 5)
  return primerTramo * 21 + segundoTramo * 23
}

/** Dias de preaviso por antiguedad (Codigo de Trabajo Art. 76). */
export function noticeDays(monthsOfService: number): number {
  if (monthsOfService < 3) return 0
  if (monthsOfService < 6) return 7
  if (monthsOfService < 12) return 14
  return 28
}
