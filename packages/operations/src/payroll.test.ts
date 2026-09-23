import { describe, expect, it } from 'vitest'
import {
  annualIncomeTax,
  calculatePayrollLine,
  christmasBonus,
  descuentosDePrestamos,
  diasComerciales,
  fraccionDeMes,
  monthlyIncomeTaxWithholding,
  noticeDays,
  parametrosDesdeFila,
  salarioDelPeriodo,
  severanceDays,
  tssDesglose,
  tssEmployeeDeduction,
  type FilaParametrosNomina,
} from './payroll.js'

/**
 * Los parametros NO viven en el codigo (0132): salen de
 * `public.payroll_tax_params`. Esta fila es un DATO DE PRUEBA con la misma
 * forma que devuelve la base, copiado de la fila vigente desde el
 * 1-feb-2026 (TSS Resolucion 01-2025, escala ISR de la DGII para 2026).
 * Si la tabla cambia, esta prueba no se entera -a proposito-: aqui se
 * prueba la aritmetica, no el valor vigente.
 */
const FILA_2026: FilaParametrosNomina = {
  valid_from: '2026-02-01',
  min_contribution_wage: '23223.00',
  sfs_cap_multiple: '10',
  afp_cap_multiple: '20',
  sfs_employee_rate: '0.03040',
  afp_employee_rate: '0.02870',
  income_tax_brackets: [
    { from: 0, to: 416_220, rate: 0, baseAmount: 0 },
    { from: 416_220, to: 624_329, rate: 0.15, baseAmount: 0 },
    { from: 624_329, to: 867_123, rate: 0.2, baseAmount: 31_216 },
    { from: 867_123, to: null, rate: 0.25, baseAmount: 79_776 },
  ],
  source: 'prueba',
  verified: true,
}

const P = parametrosDesdeFila(FILA_2026)

describe('parametrosDesdeFila: los topes salen de la tabla, no del codigo', () => {
  it('SFS y AFP tienen topes DISTINTOS: 10 y 20 salarios minimos cotizables', () => {
    expect(P.sfsCap).toBe(232_230)
    expect(P.afpCap).toBe(464_460)
    expect(P.sfsEmployeeRate).toBe(0.0304)
    expect(P.afpEmployeeRate).toBe(0.0287)
    expect(P.vigencia).toMatchObject({ desde: '2026-02-01', salarioMinimoCotizable: 23_223 })
  })

  it('rechaza una tasa imposible', () => {
    expect(() => parametrosDesdeFila({ ...FILA_2026, sfs_employee_rate: '1.5' })).toThrow()
  })

  it('rechaza una escala de ISR con huecos o desordenada', () => {
    const [a, b, c, d] = FILA_2026.income_tax_brackets as { from: number; to: number | null }[]
    expect(() => parametrosDesdeFila({ ...FILA_2026, income_tax_brackets: [a, c, b, d] })).toThrow(
      /escala/i,
    )
    expect(() =>
      parametrosDesdeFila({
        ...FILA_2026,
        income_tax_brackets: [a, { ...b!, from: 500_000 }, c, d],
      }),
    ).toThrow(/escala/i)
  })

  it('rechaza una escala sin tramo final abierto', () => {
    const tramos = FILA_2026.income_tax_brackets as { to: number | null }[]
    expect(() =>
      parametrosDesdeFila({
        ...FILA_2026,
        income_tax_brackets: tramos.slice(0, 3),
      }),
    ).toThrow(/escala/i)
  })
})

describe('tssEmployeeDeduction: cada seguro con su propio tope', () => {
  it('AFP + SFS sobre un salario dentro de los dos topes', () => {
    // 100000 * 0.0304 = 3040 ; 100000 * 0.0287 = 2870
    expect(tssEmployeeDeduction(100_000, P)).toBe(5910)
  })

  it('entre los dos topes: el SFS se corta en 10 SMC, la AFP sigue', () => {
    // SFS: 232230 * 0.0304 = 7059.79 ; AFP: 300000 * 0.0287 = 8610.00
    // Con un solo tope combinado salia 300000 * 0.0591 = 17730.00.
    expect(tssDesglose(300_000, P)).toEqual({ sfs: 7059.79, afp: 8610, total: 15_669.79 })
  })

  it('por encima de los dos topes, cada uno en el suyo', () => {
    // SFS 7059.79 + AFP 464460 * 0.0287 = 13330.00
    expect(tssEmployeeDeduction(500_000, P)).toBe(20_389.79)
  })

  it('en una quincena el tope es medio tope: dos quincenas cotizan lo de un mes', () => {
    // Quincena de 300000 = 150000 de bruto. SFS topado a 116115.
    expect(tssDesglose(150_000, P, 0.5)).toEqual({ sfs: 3529.9, afp: 4305, total: 7834.9 })
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
  it('arma el desglose completo de un mes: bruto, TSS, ISR y neto', () => {
    const r = calculatePayrollLine(50_000, P)
    expect(r.grossSalary).toBe(50_000)
    expect(r.tssDeduction).toBe(2955)
    expect(r.incomeTax).toBe(1854)
    expect(r.netSalary).toBe(45_191)
  })

  it('el caso de la demo cuadra al centavo: 85000 al mes', () => {
    const r = calculatePayrollLine(85_000, P)
    expect(r.tssDeduction).toBe(5023.5)
    expect(r.incomeTax).toBe(8577.06)
    expect(r.netSalary).toBe(71_399.44)
  })

  it('una quincena paga la mitad, y dos quincenas dan el neto del mes -no el doble-', () => {
    const q = calculatePayrollLine(42_500, P, { fraccionPeriodo: 0.5 })
    expect(q.tssDeduction).toBe(2511.75)
    expect(q.incomeTax).toBe(4288.53)
    expect(q.netSalary).toBe(35_699.72)
    expect(q.netSalary * 2).toBeCloseTo(71_399.44, 2)
  })

  it('otros descuentos -un prestamo interno, por ejemplo- bajan el neto', () => {
    const r = calculatePayrollLine(50_000, P, { otrosDescuentos: 1000 })
    expect(r.otherDeductions).toBe(1000)
    expect(r.netSalary).toBe(44_191)
  })

  it('un reembolso de gastos suma al neto pero NO es base de TSS ni de ISR', () => {
    const sin = calculatePayrollLine(50_000, P)
    const con = calculatePayrollLine(50_000, P, { ingresosNoGravados: 2500 })
    expect(con.tssDeduction).toBe(sin.tssDeduction)
    expect(con.incomeTax).toBe(sin.incomeTax)
    expect(con.nonTaxableIncome).toBe(2500)
    expect(con.netSalary).toBe(sin.netSalary + 2500)
  })

  it('no acepta una fraccion de periodo nula o negativa', () => {
    expect(() => calculatePayrollLine(50_000, P, { fraccionPeriodo: 0 })).toThrow()
  })
})

describe('diasComerciales: mes de 30 dias', () => {
  it('un mes completo vale 30, tenga 28, 30 o 31 dias', () => {
    expect(diasComerciales('2026-01-01', '2026-01-31')).toBe(30)
    expect(diasComerciales('2026-02-01', '2026-02-28')).toBe(30)
    expect(diasComerciales('2028-02-01', '2028-02-29')).toBe(30)
    expect(diasComerciales('2026-09-01', '2026-09-30')).toBe(30)
  })

  it('cada quincena vale 15, tambien la segunda de un mes de 31 o de febrero', () => {
    expect(diasComerciales('2026-10-01', '2026-10-15')).toBe(15)
    expect(diasComerciales('2026-10-16', '2026-10-31')).toBe(15)
    expect(diasComerciales('2026-02-16', '2026-02-28')).toBe(15)
  })

  it('un ano entero son 360: doce salarios, ni uno mas', () => {
    expect(diasComerciales('2026-01-01', '2026-12-31')).toBe(360)
  })

  it('periodos semanales que cubren el ano tambien suman 360 -no se paga de mas por semanas-', () => {
    let total = 0
    let inicio = new Date(Date.UTC(2026, 0, 1))
    const fin = new Date(Date.UTC(2026, 11, 31))
    while (inicio <= fin) {
      const hasta = new Date(Math.min(inicio.getTime() + 6 * 86_400_000, fin.getTime()))
      total += diasComerciales(inicio.toISOString().slice(0, 10), hasta.toISOString().slice(0, 10))
      inicio = new Date(hasta.getTime() + 86_400_000)
    }
    expect(total).toBe(360)
  })

  it('fechas al reves no son dias negativos', () => {
    expect(diasComerciales('2026-09-30', '2026-09-01')).toBe(0)
  })

  it('una fecha mal escrita se rechaza', () => {
    expect(() => diasComerciales('2026-13-01', '2026-13-15')).toThrow()
    expect(() => diasComerciales('ayer', '2026-01-15')).toThrow()
  })

  it('fraccionDeMes: quincena = medio mes', () => {
    expect(fraccionDeMes('2026-09-01', '2026-09-15')).toBe(0.5)
    expect(fraccionDeMes('2026-09-16', '2026-09-30')).toBe(0.5)
    expect(fraccionDeMes('2026-09-01', '2026-09-30')).toBe(1)
  })
})

describe('salarioDelPeriodo: prorrateo de ingresos y salidas', () => {
  const SEPT = { desde: '2026-09-01', hasta: '2026-09-30' }

  it('todo el periodo contratado: el valor exacto del periodo', () => {
    expect(salarioDelPeriodo(85_000, SEPT, { ingreso: '2023-09-23', salida: null })).toEqual({
      dias: 30,
      bruto: 85_000,
      completo: true,
    })
    expect(
      salarioDelPeriodo(
        85_000,
        { desde: '2026-09-01', hasta: '2026-09-15' },
        {
          ingreso: '2023-09-23',
          salida: null,
        },
      ),
    ).toEqual({ dias: 15, bruto: 42_500, completo: true })
  })

  it('ingreso el dia 16 de un periodo mensual: medio mes', () => {
    expect(salarioDelPeriodo(18_000, SEPT, { ingreso: '2026-09-16', salida: null })).toEqual({
      dias: 15,
      bruto: 9000,
      completo: false,
    })
  })

  it('ingreso el 13: 18 dias de 30', () => {
    expect(salarioDelPeriodo(18_000, SEPT, { ingreso: '2026-09-13', salida: null })!.bruto).toBe(
      10_800,
    )
  })

  it('salida el dia 10: se pagan 10 dias', () => {
    expect(
      salarioDelPeriodo(18_000, SEPT, { ingreso: '2020-01-15', salida: '2026-09-10' }),
    ).toEqual({
      dias: 10,
      bruto: 6000,
      completo: false,
    })
  })

  it('quien entra el 31 cobra ese dia: el trabajo hecho se paga', () => {
    expect(
      salarioDelPeriodo(
        18_000,
        { desde: '2026-10-01', hasta: '2026-10-31' },
        {
          ingreso: '2026-10-31',
          salida: null,
        },
      ),
    ).toEqual({ dias: 1, bruto: 600, completo: false })
  })

  it('fuera del periodo no cobra nada', () => {
    expect(salarioDelPeriodo(18_000, SEPT, { ingreso: '2026-10-01', salida: null })).toBeNull()
    expect(
      salarioDelPeriodo(18_000, SEPT, { ingreso: '2020-01-01', salida: '2026-08-31' }),
    ).toBeNull()
  })
})

describe('descuentosDePrestamos', () => {
  const prestamos = [
    { id: 'a', cuota: 5000, saldo: 12_000 },
    { id: 'b', cuota: 3000, saldo: 1000 },
  ]

  it('mensual: la cuota entera, nunca mas que el saldo', () => {
    expect(descuentosDePrestamos(prestamos, 1, 50_000)).toEqual([
      { id: 'a', monto: 5000 },
      { id: 'b', monto: 1000 },
    ])
  })

  it('quincenal: media cuota por quincena -la cuota del prestamo es mensual-', () => {
    expect(descuentosDePrestamos(prestamos, 0.5, 50_000)).toEqual([
      { id: 'a', monto: 2500 },
      { id: 'b', monto: 1000 },
    ])
  })

  it('el neto nunca queda negativo: se descuenta lo que alcanza, el resto sigue en el saldo', () => {
    expect(descuentosDePrestamos(prestamos, 1, 2000)).toEqual([{ id: 'a', monto: 2000 }])
    expect(descuentosDePrestamos(prestamos, 1, 0)).toEqual([])
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
