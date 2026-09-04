import { describe, expect, it } from 'vitest'
import {
  bankAccountBalance,
  buildCashFlowProjection,
  firstShortfallWeek,
  validateTransfer,
} from './treasury.js'

const HOY = new Date(2026, 8, 3) // 3 de septiembre de 2026, un jueves
const dias = (n: number) => new Date(2026, 8, 3 + n)

describe('bankAccountBalance', () => {
  it('sin movimientos, el saldo es el inicial', () => {
    expect(bankAccountBalance(25000, 0, 0)).toBe(25000)
  })

  it('suma entradas y resta salidas', () => {
    expect(bankAccountBalance(10000, 5500, 2300)).toBe(13200)
  })

  it('puede quedar negativo: un sobregiro existe y esconderlo seria mentir', () => {
    expect(bankAccountBalance(1000, 0, 4500)).toBe(-3500)
  })
})

describe('validateTransfer', () => {
  it('una transferencia entre dos cuentas distintas con monto positivo es valida', () => {
    expect(validateTransfer('a', 'b', 5000)).toEqual({ ok: true })
  })

  it('rechaza transferirse a la misma cuenta', () => {
    const r = validateTransfer('a', 'a', 5000)
    expect(r.ok).toBe(false)
    expect(r).toHaveProperty('error', expect.stringContaining('no pueden ser la misma'))
  })

  it('rechaza monto cero o negativo', () => {
    expect(validateTransfer('a', 'b', 0).ok).toBe(false)
    expect(validateTransfer('a', 'b', -100).ok).toBe(false)
  })

  it('rechaza si falta una de las dos cuentas', () => {
    expect(validateTransfer('', 'b', 100).ok).toBe(false)
    expect(validateTransfer('a', '', 100).ok).toBe(false)
  })
})

describe('buildCashFlowProjection', () => {
  it('sin nada que entrar ni salir, el saldo se mantiene plano', () => {
    const p = buildCashFlowProjection(50000, [], [], HOY, 4)
    expect(p).toHaveLength(4)
    expect(p.map((s) => s.runningBalance)).toEqual([50000, 50000, 50000, 50000])
  })

  it('cada semana cubre siete dias y empieza donde termino la anterior', () => {
    const p = buildCashFlowProjection(0, [], [], HOY, 3)
    expect(p[0]!.weekStart.getUTCDate()).toBe(3)
    expect(p[0]!.weekEnd.getUTCDate()).toBe(9)
    expect(p[1]!.weekStart.getUTCDate()).toBe(10)
    expect(p[2]!.weekStart.getUTCDate()).toBe(17)
  })

  it('una factura vencida cuenta en la semana 0: ya deberia haber entrado', () => {
    const p = buildCashFlowProjection(0, [{ dueDate: dias(-40), amount: 12000 }], [], HOY, 4)
    expect(p[0]!.projectedIn).toBe(12000)
    expect(p[1]!.projectedIn).toBe(0)
  })

  it('lo que vence mas alla del horizonte no aparece: es proyeccion, no historial', () => {
    const p = buildCashFlowProjection(0, [{ dueDate: dias(90), amount: 99000 }], [], HOY, 4)
    expect(p.reduce((a, s) => a + s.projectedIn, 0)).toBe(0)
  })

  it('reparte entradas y salidas en la semana que les toca', () => {
    const p = buildCashFlowProjection(
      10000,
      [
        { dueDate: dias(2), amount: 5000 },
        { dueDate: dias(9), amount: 3000 },
      ],
      [{ dueDate: dias(10), amount: 4000 }],
      HOY,
      3,
    )
    expect(p[0]).toMatchObject({ projectedIn: 5000, projectedOut: 0, net: 5000, runningBalance: 15000 })
    expect(p[1]).toMatchObject({ projectedIn: 3000, projectedOut: 4000, net: -1000, runningBalance: 14000 })
    expect(p[2]).toMatchObject({ projectedIn: 0, projectedOut: 0, net: 0, runningBalance: 14000 })
  })

  it('el saldo corriendo arrastra el arranque real, no empieza en cero', () => {
    const p = buildCashFlowProjection(80000, [], [{ dueDate: dias(3), amount: 30000 }], HOY, 2)
    expect(p[0]!.runningBalance).toBe(50000)
    expect(p[1]!.runningBalance).toBe(50000)
  })

  it('suma varias facturas que caen en la misma semana', () => {
    const p = buildCashFlowProjection(
      0,
      [],
      [
        { dueDate: dias(1), amount: 1500.5 },
        { dueDate: dias(4), amount: 2499.5 },
      ],
      HOY,
      2,
    )
    expect(p[0]!.projectedOut).toBe(4000)
  })
})

describe('firstShortfallWeek', () => {
  it('avisa la primera semana en rojo', () => {
    const p = buildCashFlowProjection(
      5000,
      [],
      [
        { dueDate: dias(2), amount: 3000 },
        { dueDate: dias(9), amount: 4000 },
      ],
      HOY,
      4,
    )
    expect(firstShortfallWeek(p)).toBe(1)
  })

  it('si el efectivo nunca se pone en rojo, no hay nada que avisar', () => {
    const p = buildCashFlowProjection(5000, [{ dueDate: dias(2), amount: 1000 }], [], HOY, 4)
    expect(firstShortfallWeek(p)).toBeNull()
  })

  it('un saldo que arranca negativo se avisa desde la semana 0', () => {
    const p = buildCashFlowProjection(-200, [], [], HOY, 2)
    expect(firstShortfallWeek(p)).toBe(0)
  })
})
