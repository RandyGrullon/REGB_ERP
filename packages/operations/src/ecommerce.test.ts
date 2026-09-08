import { describe, expect, it } from 'vitest'
import { diasPedidoCanalPendiente, transicionValidaPedidoCanal } from './ecommerce.js'

describe('transicionValidaPedidoCanal', () => {
  it('recibido avanza a importado o cancelado', () => {
    expect(transicionValidaPedidoCanal('received', 'imported')).toBe(true)
    expect(transicionValidaPedidoCanal('received', 'cancelled')).toBe(true)
  })

  it('importado y cancelado son terminales', () => {
    expect(transicionValidaPedidoCanal('imported', 'received')).toBe(false)
    expect(transicionValidaPedidoCanal('cancelled', 'imported')).toBe(false)
  })
})

describe('diasPedidoCanalPendiente', () => {
  it('cuenta dias completos desde que se recibio', () => {
    const recibido = new Date('2026-01-01T00:00:00Z')
    const hoy = new Date('2026-01-04T00:00:00Z')
    expect(diasPedidoCanalPendiente(recibido, hoy)).toBe(3)
  })
})
