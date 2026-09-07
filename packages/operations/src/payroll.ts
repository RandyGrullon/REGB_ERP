import { roundBankers } from '@regb/core'

/**
 * Nomina — §5.6, modulo 62 (F7/S37-38).
 *
 * Las tasas de TSS y los tramos de ISR de Republica Dominicana NO se
 * hardcodean como constantes fijas dentro de la formula: se reciben como
 * parametro (`PayrollTaxParams`). El ISR en particular se ajusta cada ano
 * por inflacion (Ley 11-92 y sus reformas) -una tabla escrita "para
 * siempre" en el codigo quedaria vieja el primer enero-. Los valores por
 * defecto que trae este archivo (`TASAS_TSS_REFERENCIA_2024`) son los
 * conocidos a la fecha en que se escribio esto, no una promesa de que
 * seguiran vigentes: cualquiera que use este modulo en produccion DEBE
 * verificarlos contra la TSS y la DGII antes de correr una nomina real.
 */

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
  /** Tasa de AFP (pensiones) a cargo del empleado. */
  afpEmployeeRate: number
  /** Tasa de SFS/ARS (salud) a cargo del empleado. */
  sfsEmployeeRate: number
  /** Tope MENSUAL de salario cotizable para TSS, en RD$. */
  contributionCap: number
  /** Tramos del ISR, anuales, de menor a mayor, sin huecos entre ellos. */
  incomeTaxBrackets: IncomeTaxBracket[]
}

/**
 * Valores de referencia conocidos para Republica Dominicana. Ver el
 * aviso de la cabecera: VERIFICAR contra la TSS/DGII vigente antes de
 * usarlos para pagar una nomina real -el ISR en particular cambia cada
 * ano-.
 */
export const TASAS_TSS_REFERENCIA_2024: PayrollTaxParams = {
  afpEmployeeRate: 0.0287,
  sfsEmployeeRate: 0.0304,
  contributionCap: 415_492, // ~10 salarios minimos cotizables, referencia
  incomeTaxBrackets: [
    { from: 0, to: 416_220, rate: 0, baseAmount: 0 },
    { from: 416_220, to: 624_329, rate: 0.15, baseAmount: 0 },
    { from: 624_329, to: 867_123, rate: 0.2, baseAmount: 31_216 },
    { from: 867_123, to: null, rate: 0.25, baseAmount: 79_776 },
  ],
}

/** TSS retenida al empleado: AFP + SFS, sobre el salario cotizable -nunca mas alla del tope-. */
export function tssEmployeeDeduction(monthlyGrossSalary: number, params: PayrollTaxParams): number {
  const cotizable = Math.min(monthlyGrossSalary, params.contributionCap)
  return roundBankers(cotizable * (params.afpEmployeeRate + params.sfsEmployeeRate), 2)
}

/** ISR sobre un ingreso ANUAL, aplicando la tabla progresiva por tramos. */
export function annualIncomeTax(annualTaxableIncome: number, brackets: IncomeTaxBracket[]): number {
  if (annualTaxableIncome <= 0) return 0
  const tramo = brackets.find((b) => annualTaxableIncome > b.from && (b.to === null || annualTaxableIncome <= b.to))
  if (!tramo) return 0
  return roundBankers(tramo.baseAmount + (annualTaxableIncome - tramo.from) * tramo.rate, 2)
}

/**
 * ISR retenido de UN mes: proyecta el salario cotizable (ya descontada
 * la TSS del mes) a un ano, busca el impuesto anual, y lo reparte entre
 * 12 -el metodo real que usa una nomina dominicana, no un atajo-.
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

export interface PayrollLineResult {
  grossSalary: number
  tssDeduction: number
  incomeTax: number
  otherDeductions: number
  netSalary: number
}

/** Arma el desglose completo de un mes: bruto, TSS, ISR, otros descuentos y neto. */
export function calculatePayrollLine(
  monthlyGrossSalary: number,
  params: PayrollTaxParams,
  otherDeductions = 0,
): PayrollLineResult {
  const tssDeduction = tssEmployeeDeduction(monthlyGrossSalary, params)
  const incomeTax = monthlyIncomeTaxWithholding(monthlyGrossSalary, tssDeduction, params.incomeTaxBrackets)
  const netSalary = roundBankers(monthlyGrossSalary - tssDeduction - incomeTax - otherDeductions, 2)
  return { grossSalary: monthlyGrossSalary, tssDeduction, incomeTax, otherDeductions, netSalary }
}

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
