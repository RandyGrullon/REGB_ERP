import { describe, expect, it } from 'vitest'
import {
  diasLaborablesEntre,
  diasVacacionesPorAnioDeServicio,
  saldoVacaciones,
  vacacionesAcumuladas,
  validarDiasDeVacaciones,
} from './time-off.js'

describe('diasLaborablesEntre', () => {
  it('un solo dia entre semana cuenta uno', () => {
    expect(diasLaborablesEntre(new Date(2026, 8, 7), new Date(2026, 8, 7))).toBe(1) // lunes
  })

  it('un solo dia de fin de semana no cuenta ninguno', () => {
    expect(diasLaborablesEntre(new Date(2026, 8, 5), new Date(2026, 8, 5))).toBe(0) // sabado
  })

  it('lunes a viernes de la misma semana da cinco', () => {
    expect(diasLaborablesEntre(new Date(2026, 8, 7), new Date(2026, 8, 11))).toBe(5)
  })

  it('viernes a lunes salta el fin de semana de por medio', () => {
    expect(diasLaborablesEntre(new Date(2026, 8, 4), new Date(2026, 8, 7))).toBe(2) // vie + lun
  })

  it('dos semanas completas dan diez dias laborables', () => {
    expect(diasLaborablesEntre(new Date(2026, 8, 7), new Date(2026, 8, 18))).toBe(10)
  })

  it('un fin invertido -antes del inicio- no cuenta dias negativos', () => {
    expect(diasLaborablesEntre(new Date(2026, 8, 11), new Date(2026, 8, 7))).toBe(0)
  })
})

describe('diasVacacionesPorAnioDeServicio', () => {
  it('antes de cumplir el primer año no otorga nada', () => {
    expect(diasVacacionesPorAnioDeServicio(0)).toBe(0)
  })

  it('cada uno de los primeros cuatro años da 14 dias', () => {
    expect(diasVacacionesPorAnioDeServicio(1)).toBe(14)
    expect(diasVacacionesPorAnioDeServicio(4)).toBe(14)
  })

  it('del quinto año en adelante da 18 dias', () => {
    expect(diasVacacionesPorAnioDeServicio(5)).toBe(18)
    expect(diasVacacionesPorAnioDeServicio(10)).toBe(18)
  })
})

describe('vacacionesAcumuladas', () => {
  it('menos de un año de servicio no acumula nada', () => {
    const contratacion = new Date(2026, 0, 1)
    const corte = new Date(2026, 8, 1) // 8 meses despues
    expect(vacacionesAcumuladas(contratacion, corte)).toBe(0)
  })

  it('exactamente cuatro años completos acumulan 4x14', () => {
    const contratacion = new Date(2022, 8, 7)
    const corte = new Date(2026, 8, 7)
    expect(vacacionesAcumuladas(contratacion, corte)).toBe(56)
  })

  it('exactamente cinco años completos acumulan 4x14 + 1x18', () => {
    const contratacion = new Date(2021, 8, 7)
    const corte = new Date(2026, 8, 7)
    expect(vacacionesAcumuladas(contratacion, corte)).toBe(74)
  })

  it('seis años completos siguen sumando 18 por cada año desde el quinto', () => {
    const contratacion = new Date(2020, 8, 7)
    const corte = new Date(2026, 8, 7)
    expect(vacacionesAcumuladas(contratacion, corte)).toBe(92) // 56 + 18 + 18
  })
})

describe('saldoVacaciones', () => {
  it('sin nada tomado, el saldo es todo lo acumulado', () => {
    const contratacion = new Date(2022, 8, 7)
    const corte = new Date(2026, 8, 7)
    expect(saldoVacaciones(contratacion, corte, 0)).toBe(56)
  })

  it('resta lo ya tomado del acumulado', () => {
    const contratacion = new Date(2022, 8, 7)
    const corte = new Date(2026, 8, 7)
    expect(saldoVacaciones(contratacion, corte, 20)).toBe(36)
  })

  it('tomar mas de lo acumulado nunca da un saldo negativo', () => {
    const contratacion = new Date(2022, 8, 7)
    const corte = new Date(2026, 8, 7)
    expect(saldoVacaciones(contratacion, corte, 999)).toBe(0)
  })
})

describe('validarDiasDeVacaciones', () => {
  it('lo que cabe en el saldo pasa', () => {
    expect(validarDiasDeVacaciones(14, 10)).toBeNull()
    expect(validarDiasDeVacaciones(14, 14)).toBeNull()
  })

  it('pedir mas de lo que queda se rechaza con los dos numeros', () => {
    expect(validarDiasDeVacaciones(4, 10)).toBe(
      'Se piden 10 días y solo quedan 4 días de vacaciones disponibles.',
    )
  })

  it('sin saldo -antes del primer año- se rechaza y dice por que', () => {
    expect(validarDiasDeVacaciones(0, 1)).toMatch(/^No quedan días de vacaciones disponibles y se piden 1 día./)
  })
})
