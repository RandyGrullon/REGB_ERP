import { describe, expect, it } from 'vitest'
import { dunningBanner, dunningStage } from './dunning.js'

describe('escalera de mora (§6.6)', () => {
  it('sin mora no pasa nada', () => {
    expect(dunningStage(0)).toBe('ok')
    expect(dunningStage(4)).toBe('ok')
  })

  it('cada peldano entra exactamente en su dia', () => {
    expect(dunningStage(5)).toBe('reminder')
    expect(dunningStage(9)).toBe('reminder')
    expect(dunningStage(10)).toBe('banner')
    expect(dunningStage(14)).toBe('banner')
    expect(dunningStage(15)).toBe('readonly')
    expect(dunningStage(29)).toBe('readonly')
    expect(dunningStage(30)).toBe('suspended')
    expect(dunningStage(89)).toBe('suspended')
    expect(dunningStage(90)).toBe('archived')
    expect(dunningStage(365)).toBe('archived')
  })
})

describe('banner en el ERP del cliente', () => {
  it('past_due avisa en amarillo, readonly en rojo', () => {
    expect(dunningBanner('past_due')?.tone).toBe('warning')
    expect(dunningBanner('readonly')?.tone).toBe('danger')
  })

  it('activo, trial y suspendido no pintan banner (suspendido ni entra)', () => {
    expect(dunningBanner('active')).toBeNull()
    expect(dunningBanner('trial')).toBeNull()
    expect(dunningBanner('suspended')).toBeNull()
  })
})
