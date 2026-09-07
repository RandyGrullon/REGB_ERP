import { describe, expect, it } from 'vitest'
import { buildOrgChart, daysOfService, proratedSalary, yearsOfService } from './employees.js'

describe('buildOrgChart', () => {
  it('arma un arbol simple de dos niveles', () => {
    const arbol = buildOrgChart([
      { id: 'gerente', name: 'Gerente General', managerId: null },
      { id: 'vendedor', name: 'Vendedor', managerId: 'gerente' },
    ])
    expect(arbol).toHaveLength(1)
    expect(arbol[0]!.id).toBe('gerente')
    expect(arbol[0]!.reports).toHaveLength(1)
    expect(arbol[0]!.reports[0]!.id).toBe('vendedor')
  })

  it('varios empleados sin jefe son varias raices', () => {
    const arbol = buildOrgChart([
      { id: 'a', name: 'A', managerId: null },
      { id: 'b', name: 'B', managerId: null },
    ])
    expect(arbol.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('un jefe que no esta en la lista se trata como si no tuviera jefe', () => {
    const arbol = buildOrgChart([{ id: 'a', name: 'A', managerId: 'fantasma' }])
    expect(arbol).toHaveLength(1)
    expect(arbol[0]!.id).toBe('a')
  })

  it('un empleado que se declara su propio jefe se trata como raiz, no como ciclo infinito', () => {
    const arbol = buildOrgChart([{ id: 'a', name: 'A', managerId: 'a' }])
    expect(arbol).toHaveLength(1)
    expect(arbol[0]!.reports).toHaveLength(0)
  })

  it('un ciclo de dos (A jefe de B, B jefe de A) no cuelga la funcion', () => {
    const arbol = buildOrgChart([
      { id: 'a', name: 'A', managerId: 'b' },
      { id: 'b', name: 'B', managerId: 'a' },
    ])
    // Alguno de los dos termina siendo raiz -el dato es invalido, pero la
    // funcion no truena ni entra en recursion infinita-.
    expect(arbol.length).toBeGreaterThan(0)
  })

  it('un arbol de tres niveles anida correctamente', () => {
    const arbol = buildOrgChart([
      { id: 'ceo', name: 'CEO', managerId: null },
      { id: 'gerente', name: 'Gerente', managerId: 'ceo' },
      { id: 'vendedor', name: 'Vendedor', managerId: 'gerente' },
    ])
    expect(arbol[0]!.reports[0]!.reports[0]!.id).toBe('vendedor')
  })
})

describe('yearsOfService', () => {
  it('exactamente un ano cumplido', () => {
    expect(yearsOfService(new Date(2025, 8, 6), new Date(2026, 8, 6))).toBe(1)
  })

  it('un dia antes del aniversario todavia no cuenta el ano', () => {
    expect(yearsOfService(new Date(2025, 8, 6), new Date(2026, 8, 5))).toBe(0)
  })

  it('once meses de antiguedad son cero anos, no uno', () => {
    expect(yearsOfService(new Date(2025, 8, 6), new Date(2026, 7, 1))).toBe(0)
  })

  it('nunca da negativo, aunque la fecha de ingreso sea futura por error', () => {
    expect(yearsOfService(new Date(2027, 0, 1), new Date(2026, 0, 1))).toBe(0)
  })
})

describe('daysOfService', () => {
  it('cuenta los dias completos entre dos fechas', () => {
    expect(daysOfService(new Date(2026, 8, 1), new Date(2026, 8, 11))).toBe(10)
  })

  it('el mismo dia da cero', () => {
    expect(daysOfService(new Date(2026, 8, 6), new Date(2026, 8, 6))).toBe(0)
  })
})

describe('proratedSalary', () => {
  it('el mes completo (30 dias) da el salario completo', () => {
    expect(proratedSalary(30000, 30)).toBe(30000)
  })

  it('quince dias dan la mitad', () => {
    expect(proratedSalary(30000, 15)).toBe(15000)
  })

  it('mas de 30 dias no paga de mas: se limita a un mes', () => {
    expect(proratedSalary(30000, 31)).toBe(30000)
  })

  it('dias negativos no pagan de menos que cero', () => {
    expect(proratedSalary(30000, -5)).toBe(0)
  })
})
