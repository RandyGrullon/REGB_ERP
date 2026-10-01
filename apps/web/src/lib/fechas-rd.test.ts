import { describe, expect, it } from 'vitest'
import {
  diaRD,
  diasEntre,
  fechaCorta,
  horasCortas,
  horasEnTexto,
  hoyRD,
  yaVencio,
} from './fechas-rd'

describe('fechas-rd', () => {
  it('una fecha de Postgres se pinta el mismo día, no el anterior', () => {
    // Antes: new Date('2026-10-14').toLocaleDateString() en UTC-4 decía 13/10.
    expect(fechaCorta('2026-10-14')).toMatch(/^14 oct/)
    expect(fechaCorta('2026-10-14', true)).toMatch(/2026/)
    expect(fechaCorta('2026-09-01T00:00:00')).toMatch(/^1 sept?/)
  })

  it('el día de hoy y el de un instante se cuentan en hora de RD', () => {
    // 2 de octubre a las 02:00 UTC es todavía 1 de octubre en RD.
    const ahora = new Date('2026-10-02T02:00:00Z')
    expect(hoyRD(ahora)).toBe('2026-10-01')
    expect(diaRD('2026-10-02T02:00:00Z')).toBe('2026-10-01')
  })

  it('vence hoy no es vencida; ayer sí', () => {
    const ahora = new Date('2026-09-30T15:00:00Z')
    expect(yaVencio('2026-09-30', ahora)).toBe(false)
    expect(yaVencio('2026-09-29', ahora)).toBe(true)
  })

  it('cuenta días entre fechas', () => {
    expect(diasEntre('2026-09-23', '2026-09-30')).toBe(7)
    expect(diasEntre('2026-09-30', '2026-09-30')).toBe(0)
  })

  it('las horas se leen en horas y minutos, no en decimales', () => {
    expect(horasEnTexto(10.22)).toBe('10 h 13 min')
    expect(horasEnTexto(2)).toBe('2 h')
    expect(horasEnTexto(0.5)).toBe('30 min')
    expect(horasCortas(24)).toBe('24')
    expect(horasCortas(7.5)).toBe('7.5')
  })
})
