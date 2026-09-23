import { describe, expect, it } from 'vitest'
import {
  aceptadoPorDefecto,
  deriveGoodsReceiptStatus,
  detectarDiscrepancia,
  devolucionMueveInventario,
  qtyDisponibleParaDevolver,
  transicionValidaDevolucion,
  validateInspeccion,
} from './receipts'

describe('detectarDiscrepancia', () => {
  it('sin diferencia no hay discrepancia', () => {
    expect(detectarDiscrepancia(10, 10)).toEqual({ tipo: 'ninguna', diferencia: 0 })
  })

  it('llego menos de lo esperado: faltante', () => {
    expect(detectarDiscrepancia(10, 7)).toEqual({ tipo: 'faltante', diferencia: -3 })
  })

  it('llego mas de lo esperado: sobrante', () => {
    expect(detectarDiscrepancia(10, 12)).toEqual({ tipo: 'sobrante', diferencia: 2 })
  })
})

describe('deriveGoodsReceiptStatus', () => {
  it('todas las lineas exactas: completed', () => {
    expect(
      deriveGoodsReceiptStatus([
        { qtyExpected: 10, qtyReceived: 10 },
        { qtyExpected: 5, qtyReceived: 5 },
      ]),
    ).toBe('completed')
  })

  it('una sola linea con discrepancia marca el documento entero', () => {
    expect(
      deriveGoodsReceiptStatus([
        { qtyExpected: 10, qtyReceived: 10 },
        { qtyExpected: 5, qtyReceived: 3 },
      ]),
    ).toBe('with_discrepancies')
  })
})

describe('validateInspeccion', () => {
  it('aceptado + rechazado = recibido: ok', () => {
    expect(validateInspeccion(10, 8, 2)).toEqual({ ok: true })
  })

  it('no suman lo recibido: error', () => {
    const r = validateInspeccion(10, 8, 1)
    expect(r.ok).toBe(false)
  })

  it('cantidad negativa: error', () => {
    const r = validateInspeccion(10, -1, 11)
    expect(r.ok).toBe(false)
  })

  it('todo aceptado, nada rechazado: ok', () => {
    expect(validateInspeccion(10, 10, 0)).toEqual({ ok: true })
  })

  it('decimales que en coma flotante no suman exacto: ok', () => {
    // 2.2 + 0.1 = 2.3000000000000003 en JS; en la base es 2.300 exacto.
    expect(validateInspeccion(2.3, 2.2, 0.1)).toEqual({ ok: true })
  })
})

describe('aceptadoPorDefecto', () => {
  it('recepcion parcial sin rechazo: se acepta lo que llego, no lo pedido', () => {
    expect(aceptadoPorDefecto(30, 0)).toBe(30)
  })

  it('con rechazo: lo que llego menos lo rechazado, sin residuo de coma flotante', () => {
    expect(aceptadoPorDefecto(25, 5)).toBe(20)
    expect(aceptadoPorDefecto(2.3, 0.1)).toBe(2.2)
    expect(validateInspeccion(2.3, aceptadoPorDefecto(2.3, 0.1), 0.1)).toEqual({ ok: true })
  })
})

describe('devolucionMueveInventario', () => {
  it('lo rechazado nunca entro al inventario: devolverlo no lo toca', () => {
    expect(devolucionMueveInventario('rejected')).toBe(false)
  })

  it('lo aceptado si entro: devolverlo sale del almacen', () => {
    expect(devolucionMueveInventario('accepted')).toBe(true)
  })
})

describe('transicionValidaDevolucion', () => {
  it('pending puede pasar a sent', () => {
    expect(transicionValidaDevolucion('pending', 'sent')).toBe(true)
  })

  it('pending puede pasar a cancelled', () => {
    expect(transicionValidaDevolucion('pending', 'cancelled')).toBe(true)
  })

  it('sent es terminal', () => {
    expect(transicionValidaDevolucion('sent', 'cancelled')).toBe(false)
  })

  it('cancelled es terminal', () => {
    expect(transicionValidaDevolucion('cancelled', 'sent')).toBe(false)
  })

  it('no se puede saltar de pending a pending', () => {
    expect(transicionValidaDevolucion('pending', 'pending')).toBe(false)
  })
})

describe('qtyDisponibleParaDevolver', () => {
  it('nada devuelto todavia: todo lo rechazado esta disponible', () => {
    expect(qtyDisponibleParaDevolver(5, 0)).toBe(5)
  })

  it('parte ya devuelta: descuenta', () => {
    expect(qtyDisponibleParaDevolver(5, 2)).toBe(3)
  })

  it('todo ya devuelto: cero, nunca negativo', () => {
    expect(qtyDisponibleParaDevolver(5, 5)).toBe(0)
    expect(qtyDisponibleParaDevolver(5, 8)).toBe(0)
  })
})
