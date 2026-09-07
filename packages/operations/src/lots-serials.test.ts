import { describe, expect, it } from 'vitest'
import { alcanzaFefo, loteProximoAVencer, seleccionFefo } from './lots-serials'

describe('seleccionFefo', () => {
  it('elige primero el lote que vence mas pronto', () => {
    const lotes = [
      { lotId: 'lejano', expiryDate: new Date('2027-01-01'), qtyAvailable: 50 },
      { lotId: 'cercano', expiryDate: new Date('2026-06-01'), qtyAvailable: 50 },
    ]
    expect(seleccionFefo(lotes, 20)).toEqual([{ lotId: 'cercano', qty: 20 }])
  })

  it('sigue al siguiente lote si el primero no alcanza', () => {
    const lotes = [
      { lotId: 'cercano', expiryDate: new Date('2026-06-01'), qtyAvailable: 10 },
      { lotId: 'lejano', expiryDate: new Date('2027-01-01'), qtyAvailable: 50 },
    ]
    expect(seleccionFefo(lotes, 30)).toEqual([
      { lotId: 'cercano', qty: 10 },
      { lotId: 'lejano', qty: 20 },
    ])
  })

  it('un lote sin vencimiento va al final, incluso detras de uno que vence mas tarde', () => {
    const lotes = [
      { lotId: 'sin-vencimiento', expiryDate: null, qtyAvailable: 50 },
      { lotId: 'con-vencimiento', expiryDate: new Date('2030-01-01'), qtyAvailable: 50 },
    ]
    expect(seleccionFefo(lotes, 20)).toEqual([{ lotId: 'con-vencimiento', qty: 20 }])
  })

  it('si no alcanza entre todos los lotes, devuelve lo que si se pudo asignar', () => {
    const lotes = [{ lotId: 'unico', expiryDate: new Date('2026-06-01'), qtyAvailable: 5 }]
    expect(seleccionFefo(lotes, 20)).toEqual([{ lotId: 'unico', qty: 5 }])
  })

  it('ignora lotes sin cantidad disponible', () => {
    const lotes = [
      { lotId: 'vacio', expiryDate: new Date('2026-01-01'), qtyAvailable: 0 },
      { lotId: 'con-stock', expiryDate: new Date('2026-06-01'), qtyAvailable: 10 },
    ]
    expect(seleccionFefo(lotes, 5)).toEqual([{ lotId: 'con-stock', qty: 5 }])
  })
})

describe('alcanzaFefo', () => {
  it('alcanza cuando el total cubre lo pedido', () => {
    const lotes = [
      { lotId: 'a', expiryDate: null, qtyAvailable: 10 },
      { lotId: 'b', expiryDate: null, qtyAvailable: 10 },
    ]
    expect(alcanzaFefo(lotes, 15)).toBe(true)
  })

  it('no alcanza cuando el total no cubre lo pedido', () => {
    const lotes = [{ lotId: 'a', expiryDate: null, qtyAvailable: 10 }]
    expect(alcanzaFefo(lotes, 15)).toBe(false)
  })
})

describe('loteProximoAVencer', () => {
  const hoy = new Date('2026-06-01')

  it('sin fecha de vencimiento nunca esta por vencer', () => {
    expect(loteProximoAVencer(null, hoy)).toBe(false)
  })

  it('dentro de la ventana de aviso: por vencer', () => {
    expect(loteProximoAVencer(new Date('2026-06-15'), hoy, 30)).toBe(true)
  })

  it('fuera de la ventana de aviso: todavia no', () => {
    expect(loteProximoAVencer(new Date('2026-12-01'), hoy, 30)).toBe(false)
  })

  it('ya vencido NO se clasifica como "por vencer" -es otra alerta-', () => {
    expect(loteProximoAVencer(new Date('2026-05-01'), hoy, 30)).toBe(false)
  })
})
