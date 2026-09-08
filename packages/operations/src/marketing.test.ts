import { describe, expect, it } from 'vitest'
import { tasaSobre, transicionValidaCampana } from './marketing.js'

describe('transicionValidaCampana', () => {
  it('borrador avanza a programada o cancelada', () => {
    expect(transicionValidaCampana('draft', 'scheduled')).toBe(true)
    expect(transicionValidaCampana('draft', 'cancelled')).toBe(true)
  })

  it('programada avanza a enviada o cancelada', () => {
    expect(transicionValidaCampana('scheduled', 'sent')).toBe(true)
    expect(transicionValidaCampana('scheduled', 'cancelled')).toBe(true)
  })

  it('borrador puede enviarse directo -"enviar ahora" no exige programar primero-', () => {
    expect(transicionValidaCampana('draft', 'sent')).toBe(true)
  })

  it('enviada y cancelada son terminales', () => {
    expect(transicionValidaCampana('sent', 'draft')).toBe(false)
    expect(transicionValidaCampana('cancelled', 'draft')).toBe(false)
  })
})

describe('tasaSobre', () => {
  it('calcula la proporcion normal', () => {
    expect(tasaSobre(25, 100)).toBe(0.25)
  })

  it('null cuando no hay nada enviado -no es lo mismo que cero-', () => {
    expect(tasaSobre(0, 0)).toBeNull()
  })
})
