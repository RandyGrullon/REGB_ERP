import { describe, expect, it } from 'vitest'
import {
  TASAS_TSS_REFERENCIA_2024,
  annualIncomeTax,
  calculatePayrollLine,
  christmasBonus,
  monthlyIncomeTaxWithholding,
  noticeDays,
  severanceDays,
  tssEmployeeDeduction,
} from './payroll.js'

const P = TASAS_TSS_REFERENCIA_2024

describe('tssEmployeeDeduction', () => {
  it('AFP + SFS sobre un salario dentro del tope', () => {
    // 100000 * (0.0287 + 0.0304) = 100000 * 0.0591 = 5910.00
    expect(tssEmployeeDeduction(100_000, P)).toBe(5910)
  })

  it('nunca cotiza mas alla del tope, aunque el salario sea mayor', () => {
    // cotizable = 415492 (el tope), no 500000
    expect(tssEmployeeDeduction(500_000, P)).toBe(24_555.58)
  })

  it('un salario de cero no descuenta nada', () => {
    expect(tssEmployeeDeduction(0, P)).toBe(0)
  })
})

describe('annualIncomeTax', () => {
  it('dentro del tramo exento, no paga ISR', () => {
    expect(annualIncomeTax(300_000, P.incomeTaxBrackets)).toBe(0)
  })

  it('justo en el limite del tramo exento, todavia no paga', () => {
    expect(annualIncomeTax(416_220, P.incomeTaxBrackets)).toBe(0)
  })

  it('en el segundo tramo, paga 15% del excedente', () => {
    // (500000 - 416220) * 0.15 = 83780 * 0.15 = 12567.00
    expect(annualIncomeTax(500_000, P.incomeTaxBrackets)).toBe(12_567)
  })

  it('en el tercer tramo, suma el acumulado mas 20% del excedente', () => {
    // 31216 + (700000 - 624329) * 0.20 = 31216 + 15134.20 = 46350.20
    expect(annualIncomeTax(700_000, P.incomeTaxBrackets)).toBe(46_350.2)
  })

  it('en el ultimo tramo, sin techo, suma el acumulado mas 25%', () => {
    // 79776 + (1000000 - 867123) * 0.25 = 79776 + 33219.25 = 112995.25
    expect(annualIncomeTax(1_000_000, P.incomeTaxBrackets)).toBe(112_995.25)
  })

  it('un ingreso de cero o negativo no paga nada', () => {
    expect(annualIncomeTax(0, P.incomeTaxBrackets)).toBe(0)
    expect(annualIncomeTax(-100, P.incomeTaxBrackets)).toBe(0)
  })
})

describe('monthlyIncomeTaxWithholding', () => {
  it('proyecta el neto de TSS a un ano y reparte el impuesto entre 12', () => {
    const tss = tssEmployeeDeduction(50_000, P) // 2955.00
    // base mensual = 50000 - 2955 = 47045; anualizado = 564540
    // impuesto anual = (564540 - 416220) * 0.15 = 148320 * 0.15 = 22248
    // mensual = 22248 / 12 = 1854.00
    expect(monthlyIncomeTaxWithholding(50_000, tss, P.incomeTaxBrackets)).toBe(1854)
  })

  it('un salario bajo, dentro del tramo exento, no retiene ISR', () => {
    const tss = tssEmployeeDeduction(20_000, P)
    expect(monthlyIncomeTaxWithholding(20_000, tss, P.incomeTaxBrackets)).toBe(0)
  })
})

describe('calculatePayrollLine', () => {
  it('arma el desglose completo: bruto, TSS, ISR y neto', () => {
    const r = calculatePayrollLine(50_000, P)
    expect(r.grossSalary).toBe(50_000)
    expect(r.tssDeduction).toBe(2955)
    expect(r.incomeTax).toBe(1854)
    expect(r.netSalary).toBe(45_191)
  })

  it('otros descuentos -un prestamo interno, por ejemplo- bajan el neto tambien', () => {
    const r = calculatePayrollLine(50_000, P, 1000)
    expect(r.otherDeductions).toBe(1000)
    expect(r.netSalary).toBe(44_191)
  })
})

describe('christmasBonus', () => {
  it('un doceavo de lo devengado en el ano', () => {
    expect(christmasBonus(360_000)).toBe(30_000)
  })
})

describe('severanceDays', () => {
  it('menos de 3 meses, no aplica', () => {
    expect(severanceDays(2)).toBe(0)
  })

  it('entre 3 y 6 meses, 6 dias fijos', () => {
    expect(severanceDays(4)).toBe(6)
  })

  it('entre 6 y 12 meses, 13 dias fijos', () => {
    expect(severanceDays(8)).toBe(13)
  })

  it('un ano completo, 21 dias', () => {
    expect(severanceDays(12)).toBe(21)
  })

  it('exactamente 5 anos, todos a 21 dias', () => {
    expect(severanceDays(60)).toBe(105) // 5 * 21
  })

  it('mas de 5 anos: solo el excedente se paga a 23, no toda la antiguedad', () => {
    // 5 anos a 21 (105) + 1 ano a 23 (23) = 128, NO 6*23=138
    expect(severanceDays(72)).toBe(128)
  })

  it('once anos: 5 a 21 mas 6 a 23', () => {
    expect(severanceDays(132)).toBe(105 + 6 * 23)
  })
})

describe('noticeDays', () => {
  it('menos de 3 meses, no aplica', () => {
    expect(noticeDays(2)).toBe(0)
  })

  it('entre 3 y 6 meses, 7 dias', () => {
    expect(noticeDays(4)).toBe(7)
  })

  it('entre 6 y 12 meses, 14 dias', () => {
    expect(noticeDays(8)).toBe(14)
  })

  it('un ano o mas, 28 dias', () => {
    expect(noticeDays(12)).toBe(28)
    expect(noticeDays(100)).toBe(28)
  })
})
