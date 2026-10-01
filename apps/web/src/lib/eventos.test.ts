import { describe, expect, it } from 'vitest'
import { nombreEvento } from './eventos'

/**
 * Automatizaciones y webhooks enseñan el evento en castellano. Antes el
 * dueño leía (y tenía que escribir) `helpdesk.ticket.resolved`.
 */
describe('nombreEvento', () => {
  it('dice la cosa y lo que le pasó', () => {
    expect(nombreEvento('helpdesk.ticket.resolved')).toBe('Ticket resuelto')
    expect(nombreEvento('sales-orders.order.confirmed')).toBe('Pedido confirmado')
  })

  it('concuerda con las cosas femeninas', () => {
    expect(nombreEvento('ar.invoice.issued')).toBe('Factura emitida')
    expect(nombreEvento('pos.sale.completed')).toBe('Venta completada')
  })

  it('lo que no conoce sale legible, sin guiones ni puntos', () => {
    expect(nombreEvento('x.cosa-rara.algo_nuevo')).toBe('Cosa rara algo nuevo')
  })
})
