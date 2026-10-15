import { describe, expect, it } from 'vitest'
import { nombreCampo, nombreEstado, valor } from './etiquetas'

/**
 * /auditoria sin filtros, grabando la demo (15 oct 2026): "match estado,
 * matched transaction", "decidido by", "impuesto params", "counted
 * cantidad". Las columnas salen de la bitácora real de la demo.
 */

describe('Etiquetas de la bitácora', () => {
  it.each([
    ['match_status', 'estado de conciliación'],
    ['matched_transaction_id', 'movimiento emparejado'],
    ['decided_by', 'decidido por'],
    ['tax_params', 'tasas de la nómina'],
    ['counted_qty', 'cantidad contada'],
    ['statement_balance', 'saldo del estado de cuenta'],
    ['qualification_status', 'calificación'],
    ['sales_order_id', 'pedido'],
  ])('%s se lee "%s"', (columna, etiqueta) => {
    expect(nombreCampo(columna)).toBe(etiqueta)
  })

  it('una columna nueva del mismo molde no deja "by" en inglés', () => {
    expect(nombreCampo('reviewed_by')).toBe('revisado por')
  })

  it('los estados de la demo que faltaban', () => {
    expect(valor('matched')).toBe('conciliado')
    expect(valor('processed')).toBe('procesado')
    expect(nombreEstado('negotiation')).toBe('en negociación')
  })
})
