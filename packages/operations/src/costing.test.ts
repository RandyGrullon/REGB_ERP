import { describe, expect, it } from 'vitest'
import {
  applyInbound,
  applyOutbound,
  availableQty,
  countVariance,
  isLowStock,
  positionValue,
  totalValue,
  varianceValue,
  type StockPosition,
} from './costing.js'

const VACIO: StockPosition = { qtyOnHand: 0, avgCost: 0 }

describe('promedio ponderado movil', () => {
  it('la primera entrada fija el costo, sin promediar nada', () => {
    expect(applyInbound(VACIO, 100, 25)).toEqual({ qtyOnHand: 100, avgCost: 25 })
  })

  it('promedia dos entradas a costos distintos', () => {
    // 100 a $25 = 2500; +50 a $31 = 1550; total 4050 / 150 = $27
    const tras = applyInbound({ qtyOnHand: 100, avgCost: 25 }, 50, 31)
    expect(tras.qtyOnHand).toBe(150)
    expect(tras.avgCost).toBe(27)
  })

  it('una salida NO cambia el costo promedio', () => {
    const pos = { qtyOnHand: 150, avgCost: 27 }
    expect(applyOutbound(pos, 40)).toEqual({ qtyOnHand: 110, avgCost: 27 })
  })

  it('reproduce una secuencia real de compras y ventas', () => {
    let p: StockPosition = VACIO
    p = applyInbound(p, 100, 180) // compra
    p = applyOutbound(p, 30) // venta
    p = applyInbound(p, 50, 195) // compra mas cara
    p = applyOutbound(p, 20) // venta

    // 70 a $180 = 12600; +50 a $195 = 9750 -> 22350 / 120 = $186.25
    expect(p.qtyOnHand).toBe(100)
    expect(p.avgCost).toBe(186.25)
  })

  it('guarda 4 decimales: redondear a 2 al acumular desviaria la valorizacion', () => {
    const p = applyInbound({ qtyOnHand: 1, avgCost: 0 }, 2, 1)
    // (1x0 + 2x1) / 3 = 0.6666...
    expect(p.avgCost).toBe(0.6667)
  })

  it('con existencia en cero adopta el costo de entrada, no promedia contra cero', () => {
    const p = applyInbound({ qtyOnHand: 0, avgCost: 999 }, 10, 50)
    expect(p.avgCost).toBe(50)
  })

  it('con existencia negativa adopta el costo de entrada', () => {
    // Se vendio lo que no habia; promediar contra negativo da un absurdo.
    const p = applyInbound({ qtyOnHand: -5, avgCost: 100 }, 20, 60)
    expect(p.qtyOnHand).toBe(15)
    expect(p.avgCost).toBe(60)
  })

  it('una entrada sin costo declarado no toca el promedio', () => {
    // Devolucion de cliente o ajuste de cantidad, no una compra.
    const p = applyInbound({ qtyOnHand: 10, avgCost: 42 }, 5, null)
    expect(p).toEqual({ qtyOnHand: 15, avgCost: 42 })
  })

  it('cargar stock inicial SIN costo deja el inventario subvaluado', () => {
    // Esto no es un fallo del motor: la regla de arriba es correcta. Es la
    // razon por la que la accion de ajuste hereda el costo del catalogo
    // cuando el usuario no lo declara (ver apps/web/src/app/inventory/actions.ts).
    //
    // Sin esa herencia, cargar 100 unidades sin costo y luego comprar 50 a
    // $195 promedia contra un monton fantasma de costo cero:
    let p: StockPosition = { qtyOnHand: 0, avgCost: 0 }
    p = applyInbound(p, 100, null) // carga inicial mal registrada
    p = applyInbound(p, 50, 195)
    expect(p.avgCost).toBe(65) // 9750 / 150 — el inventario vale un tercio de lo real

    // Con el costo heredado del catalogo, el promedio es el correcto:
    let q: StockPosition = { qtyOnHand: 0, avgCost: 0 }
    q = applyInbound(q, 100, 180) // costo del catalogo
    q = applyInbound(q, 50, 195)
    expect(q.avgCost).toBe(185)
  })

  it('rechaza cantidades no positivas y costos negativos', () => {
    expect(() => applyInbound(VACIO, 0, 10)).toThrow(/cantidad positiva/)
    expect(() => applyInbound(VACIO, -3, 10)).toThrow(/cantidad positiva/)
    expect(() => applyInbound(VACIO, 5, -1)).toThrow(/no puede ser negativo/)
    expect(() => applyOutbound(VACIO, 0)).toThrow(/cantidad positiva/)
  })

  it('permite existencia negativa al salir (sobreventa), sin romperse', () => {
    expect(applyOutbound({ qtyOnHand: 2, avgCost: 10 }, 5)).toEqual({
      qtyOnHand: -3,
      avgCost: 10,
    })
  })
})

describe('valorizacion', () => {
  it('valora una posicion redondeando a moneda', () => {
    expect(positionValue({ qtyOnHand: 3, avgCost: 0.6667 })).toBe(2)
  })

  it('suma en crudo y redondea al final, no posicion por posicion', () => {
    // Tres posiciones de 0.3333 x 1: sumar redondeados daria 0.99; el valor
    // real es 0.9999 -> 1.00
    const total = totalValue([
      { qtyOnHand: 1, avgCost: 0.3333 },
      { qtyOnHand: 1, avgCost: 0.3333 },
      { qtyOnHand: 1, avgCost: 0.3333 },
    ])
    expect(total).toBe(1)
  })

  it('valoriza un inventario mixto', () => {
    expect(
      totalValue([
        { qtyOnHand: 1240, avgCost: 180 },
        { qtyOnHand: 18, avgCost: 95 },
      ]),
    ).toBe(224910)
  })
})

describe('disponibilidad y alertas', () => {
  it('descuenta lo reservado', () => {
    expect(availableQty(100, 30)).toBe(70)
  })

  it('lo reservado puede dejar la disponibilidad en negativo', () => {
    expect(availableQty(5, 8)).toBe(-3)
  })

  it('avisa al tocar el punto de reorden, no solo al bajarlo', () => {
    expect(isLowStock(10, 10)).toBe(true)
    expect(isLowStock(9, 10)).toBe(true)
    expect(isLowStock(11, 10)).toBe(false)
  })

  it('sin punto de reorden configurado no hay alerta', () => {
    expect(isLowStock(0, null)).toBe(false)
  })
})

describe('conteo fisico', () => {
  it('sobrante positivo, faltante negativo', () => {
    expect(countVariance(15, 18)).toBe(-3)
    expect(countVariance(20, 18)).toBe(2)
  })

  it('valora la diferencia al costo vigente', () => {
    // El mockup del marketplace: 3 unidades rotas a $95 = -$285
    expect(varianceValue(-3, 95)).toBe(-285)
  })
})
