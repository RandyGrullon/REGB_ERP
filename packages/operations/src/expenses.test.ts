import { describe, expect, it } from 'vitest'
import {
  esDeducibleDeItbis,
  itbisIncluidoEn,
  totalPendienteDeReembolso,
  validarReembolso,
  totalPorCategoria,
} from './expenses.js'

describe('itbisIncluidoEn', () => {
  it('extrae el 18% incluido de un monto bruto', () => {
    // 118 con ITBIS incluido al 18% -> 100 de base + 18 de ITBIS
    expect(itbisIncluidoEn(118)).toBe(18)
  })

  it('respeta una tasa distinta si se pasa como parametro', () => {
    expect(itbisIncluidoEn(110, 0.1)).toBe(10)
  })

  it('un monto de cero no tiene ITBIS que extraer', () => {
    expect(itbisIncluidoEn(0)).toBe(0)
  })
})

describe('esDeducibleDeItbis', () => {
  it('sin NCF no es deducible', () => {
    expect(esDeducibleDeItbis(null)).toBe(false)
  })

  it('con un NCF valido si es deducible', () => {
    expect(esDeducibleDeItbis('B0100000001')).toBe(true) // B01 + 8 digitos
  })

  it('con un NCF mal formado no es deducible', () => {
    expect(esDeducibleDeItbis('no-es-un-ncf')).toBe(false)
  })
})

describe('totalPendienteDeReembolso', () => {
  it('solo suma lo aprobado, no lo pendiente ni lo rechazado ni lo ya reembolsado', () => {
    const gastos = [
      { status: 'approved', amount: 1000 },
      { status: 'submitted', amount: 500 },
      { status: 'rejected', amount: 300 },
      { status: 'reimbursed', amount: 200 },
    ]
    expect(totalPendienteDeReembolso(gastos)).toBe(1000)
  })

  it('sin nada aprobado, el total es cero', () => {
    expect(totalPendienteDeReembolso([{ status: 'submitted', amount: 500 }])).toBe(0)
  })
})

describe('totalPorCategoria', () => {
  it('agrupa y suma por categoria, excluyendo lo rechazado', () => {
    const gastos = [
      { status: 'approved', category: 'meals', amount: 1000 },
      { status: 'submitted', category: 'meals', amount: 500 },
      { status: 'rejected', category: 'meals', amount: 9999 },
      { status: 'approved', category: 'travel', amount: 2000 },
    ]
    expect(totalPorCategoria(gastos)).toEqual({ meals: 1500, travel: 2000 })
  })

  it('sin gastos, el desglose esta vacio', () => {
    expect(totalPorCategoria([])).toEqual({})
  })
})

describe('validarReembolso', () => {
  it('por nomina sin periodo se rechaza: nadie lo pagaria nunca', () => {
    expect(validarReembolso('payroll', null)).toMatch(/nómina en borrador/)
  })

  it('por nomina con periodo, por transferencia o en efectivo pasa', () => {
    expect(validarReembolso('payroll', 'p-1')).toBeNull()
    expect(validarReembolso('transfer', null)).toBeNull()
    expect(validarReembolso('cash', null)).toBeNull()
  })

  it('un metodo que no existe se rechaza', () => {
    expect(validarReembolso('cheque', null)).toMatch(/método de reembolso/)
  })
})
