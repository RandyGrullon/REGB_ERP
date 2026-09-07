import { describe, expect, it } from 'vitest'
import {
  haversineDistanceMeters,
  horaEsperadaEnRD,
  isWithinGeofence,
  lateMinutes,
  overtimeHours,
  workedHours,
} from './attendance.js'

describe('haversineDistanceMeters', () => {
  it('la distancia de un punto a si mismo es cero', () => {
    expect(haversineDistanceMeters(18.4861, -69.9312, 18.4861, -69.9312)).toBe(0)
  })

  it('un grado de latitud son aproximadamente 111.2 km -el arco conocido de un meridiano-', () => {
    const d = haversineDistanceMeters(0, 0, 1, 0)
    expect(Math.abs(d - 111_195)).toBeLessThan(50)
  })

  it('el doble de distancia angular da aproximadamente el doble de metros', () => {
    const d1 = haversineDistanceMeters(0, 0, 1, 0)
    const d2 = haversineDistanceMeters(0, 0, 2, 0)
    expect(d2 / d1).toBeCloseTo(2, 1)
  })

  it('es simetrica: de A a B es lo mismo que de B a A', () => {
    const d1 = haversineDistanceMeters(18.48, -69.93, 18.5, -69.9)
    const d2 = haversineDistanceMeters(18.5, -69.9, 18.48, -69.93)
    expect(d1).toBeCloseTo(d2, 6)
  })
})

describe('isWithinGeofence', () => {
  it('el mismo punto siempre esta dentro, sin importar el radio', () => {
    expect(isWithinGeofence(18.48, -69.93, 18.48, -69.93, 1)).toBe(true)
  })

  it('un punto lejos de un radio pequeno queda fuera', () => {
    // ~111 km de diferencia (1 grado de latitud) contra un radio de 100 metros
    expect(isWithinGeofence(1, 0, 0, 0, 100)).toBe(false)
  })

  it('un punto cerca de un radio amplio queda dentro', () => {
    expect(isWithinGeofence(18.4802, -69.9301, 18.48, -69.93, 500)).toBe(true)
  })
})

describe('workedHours', () => {
  it('ocho horas exactas dan 8.00', () => {
    const inicio = new Date(2026, 0, 1, 8, 0)
    const fin = new Date(2026, 0, 1, 16, 0)
    expect(workedHours(inicio, fin)).toBe(8)
  })

  it('media hora extra se refleja en decimales', () => {
    const inicio = new Date(2026, 0, 1, 8, 0)
    const fin = new Date(2026, 0, 1, 16, 30)
    expect(workedHours(inicio, fin)).toBe(8.5)
  })

  it('una salida antes que la entrada nunca da horas negativas', () => {
    const inicio = new Date(2026, 0, 1, 16, 0)
    const fin = new Date(2026, 0, 1, 8, 0)
    expect(workedHours(inicio, fin)).toBe(0)
  })
})

describe('overtimeHours', () => {
  it('exactamente la jornada estandar no genera horas extra', () => {
    expect(overtimeHours(8)).toBe(0)
  })

  it('lo que pasa de la jornada estandar es hora extra', () => {
    expect(overtimeHours(9.5)).toBe(1.5)
  })

  it('menos de la jornada estandar tampoco da horas extra negativas', () => {
    expect(overtimeHours(6)).toBe(0)
  })

  it('respeta una jornada estandar distinta a 8 si se pasa como parametro', () => {
    expect(overtimeHours(7, 6)).toBe(1)
  })
})

describe('lateMinutes', () => {
  it('llegar exactamente a tiempo no da tardanza', () => {
    const esperado = new Date(2026, 0, 1, 8, 0)
    expect(lateMinutes(esperado, esperado)).toBe(0)
  })

  it('dentro del margen de gracia no cuenta tardanza', () => {
    const esperado = new Date(2026, 0, 1, 8, 0)
    const real = new Date(2026, 0, 1, 8, 8)
    expect(lateMinutes(real, esperado)).toBe(0)
  })

  it('pasado el margen de gracia, cuenta solo el excedente', () => {
    const esperado = new Date(2026, 0, 1, 8, 0)
    const real = new Date(2026, 0, 1, 8, 25)
    expect(lateMinutes(real, esperado)).toBe(15) // 25 - 10 de gracia
  })

  it('llegar antes de tiempo nunca da tardanza negativa', () => {
    const esperado = new Date(2026, 0, 1, 8, 0)
    const real = new Date(2026, 0, 1, 7, 45)
    expect(lateMinutes(real, esperado)).toBe(0)
  })
})

describe('horaEsperadaEnRD', () => {
  it('8:00am en RD es 12:00 UTC -RD es siempre UTC-4, sin horario de verano-', () => {
    const marcaje = new Date('2026-09-07T12:17:00Z') // 8:17am hora de RD
    const esperado = horaEsperadaEnRD(marcaje, 8)
    expect(esperado.toISOString()).toBe('2026-09-07T12:00:00.000Z')
  })

  it('un marcaje de madrugada en RD -antes de medianoche UTC- usa el dia calendario de RD, no el de UTC', () => {
    // 11:30pm UTC del dia 6 es 7:30pm de RD del mismo dia 6 -no cruza medianoche-,
    // pero un marcaje ya pasada la medianoche UTC del dia 7 (ej. 02:00 UTC = 10:00pm RD del dia 6)
    // debe seguir usando el 6 de RD como referencia, no el 7.
    const marcaje = new Date('2026-09-07T02:00:00Z') // 10:00pm de RD, dia 6
    const esperado = horaEsperadaEnRD(marcaje, 8)
    expect(esperado.toISOString()).toBe('2026-09-06T12:00:00.000Z')
  })

  it('la tardanza calculada con la hora esperada de RD es correcta sin importar la zona del servidor', () => {
    const marcaje = new Date('2026-09-07T12:25:00Z') // 8:25am de RD -25 min tarde-
    const esperado = horaEsperadaEnRD(marcaje, 8)
    expect(lateMinutes(marcaje, esperado)).toBe(15) // 25 - 10 de gracia
  })
})
