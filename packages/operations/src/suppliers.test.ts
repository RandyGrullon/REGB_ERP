import { describe, expect, it } from 'vitest'
import { tieneDocumentoVencido } from './suppliers.js'

describe('tieneDocumentoVencido', () => {
  it('sin documentos, no hay nada vencido', () => {
    expect(tieneDocumentoVencido([], new Date(2026, 0, 1))).toBe(false)
  })

  it('un documento sin fecha de vencimiento nunca cuenta como vencido', () => {
    expect(tieneDocumentoVencido([{ expiresAt: null }], new Date(2026, 0, 1))).toBe(false)
  })

  it('todos los documentos vigentes: no hay nada vencido', () => {
    const asOf = new Date(2026, 0, 1)
    const docs = [{ expiresAt: new Date(2026, 5, 1) }, { expiresAt: new Date(2027, 0, 1) }]
    expect(tieneDocumentoVencido(docs, asOf)).toBe(false)
  })

  it('basta con que UN documento este vencido', () => {
    const asOf = new Date(2026, 5, 1)
    const docs = [{ expiresAt: new Date(2026, 11, 1) }, { expiresAt: new Date(2026, 0, 1) }]
    expect(tieneDocumentoVencido(docs, asOf)).toBe(true)
  })
})
