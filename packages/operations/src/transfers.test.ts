import { describe, expect, it } from 'vitest'
import { transicionValidaTransferencia } from './transfers'

describe('transicionValidaTransferencia', () => {
  it('draft despacha', () => {
    expect(transicionValidaTransferencia('draft', 'in_transit')).toBe(true)
  })

  it('draft cancela', () => {
    expect(transicionValidaTransferencia('draft', 'cancelled')).toBe(true)
  })

  it('in_transit recibe', () => {
    expect(transicionValidaTransferencia('in_transit', 'received')).toBe(true)
  })

  it('in_transit NO se cancela -ya salio fisicamente del almacen-', () => {
    expect(transicionValidaTransferencia('in_transit', 'cancelled')).toBe(false)
  })

  it('received es terminal', () => {
    expect(transicionValidaTransferencia('received', 'in_transit')).toBe(false)
  })

  it('cancelled es terminal', () => {
    expect(transicionValidaTransferencia('cancelled', 'in_transit')).toBe(false)
  })

  it('no se puede saltar de draft directo a received', () => {
    expect(transicionValidaTransferencia('draft', 'received')).toBe(false)
  })
})
