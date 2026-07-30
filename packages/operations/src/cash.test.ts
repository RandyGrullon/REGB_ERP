import { describe, expect, it } from 'vitest'
import {
  computeChange,
  paymentBreakdown,
  paymentsBalance,
  reconcileCash,
  type Payment,
} from './cash.js'

const efectivo = (amount: number): Payment => ({ method: 'cash', amount })
const tarjeta = (amount: number): Payment => ({ method: 'card', amount })

describe('arqueo de caja', () => {
  it('cuadra cuando lo contado es lo esperado', () => {
    const r = reconcileCash(2000, [efectivo(1500), efectivo(800)], 4300)
    expect(r.expected).toBe(4300)
    expect(r.difference).toBe(0)
  })

  it('la tarjeta NO entra al arqueo: no pone billetes en la gaveta', () => {
    const r = reconcileCash(2000, [efectivo(1000), tarjeta(5000)], 3000)
    expect(r.expected).toBe(3000)
    expect(r.difference).toBe(0)
  })

  it('un faltante sale negativo', () => {
    const r = reconcileCash(2000, [efectivo(1000)], 2900)
    expect(r.difference).toBe(-100)
  })

  it('un sobrante sale positivo', () => {
    const r = reconcileCash(2000, [efectivo(1000)], 3050)
    expect(r.difference).toBe(50)
  })

  it('un turno sin ventas solo devuelve el fondo', () => {
    const r = reconcileCash(1500, [], 1500)
    expect(r.expected).toBe(1500)
    expect(r.difference).toBe(0)
  })
})

describe('desglose por metodo', () => {
  it('agrupa los tres metodos', () => {
    const b = paymentBreakdown([
      efectivo(100),
      tarjeta(250),
      { method: 'transfer', amount: 75 },
      efectivo(50),
    ])
    expect(b).toEqual({ cash: 150, card: 250, transfer: 75 })
  })

  it('sin pagos devuelve ceros, no vacio', () => {
    expect(paymentBreakdown([])).toEqual({ cash: 0, card: 0, transfer: 0 })
  })
})

describe('pago mixto', () => {
  it('acepta cuando la suma es exacta', () => {
    expect(paymentsBalance([efectivo(500), tarjeta(1200)], 1700)).toBe(true)
  })

  it('rechaza si falta o sobra dinero', () => {
    expect(paymentsBalance([efectivo(500)], 1700)).toBe(false)
    expect(paymentsBalance([efectivo(2000)], 1700)).toBe(false)
  })

  it('tolera un centavo: dividir 100 entre tres no debe tumbar la venta', () => {
    expect(paymentsBalance([efectivo(33.33), efectivo(33.33), efectivo(33.34)], 100)).toBe(true)
  })

  it('no tolera dos centavos', () => {
    expect(paymentsBalance([efectivo(99.98)], 100)).toBe(false)
  })
})

describe('vuelto', () => {
  it('calcula la diferencia', () => {
    expect(computeChange(1000, 785.5)).toBe(214.5)
  })

  it('pago exacto no da vuelto', () => {
    expect(computeChange(785.5, 785.5)).toBe(0)
  })

  it('si no alcanza no hay vuelto negativo', () => {
    expect(computeChange(500, 785.5)).toBe(0)
  })
})
