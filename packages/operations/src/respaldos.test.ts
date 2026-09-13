import { describe, expect, it } from 'vitest'
import { DIAS_ALARMA, DIAS_AVISO, estadoDeRespaldos } from './respaldos.js'

const HOY = new Date('2026-09-13T10:00:00Z')
const haceDias = (n: number) => new Date(HOY.getTime() - n * 86_400_000)

describe('Un respaldo que no salio no protege de nada', () => {
  it('cuarenta respaldos y ninguno descargado sigue siendo estar a cero', () => {
    // Es el caso que importa: la lista llena da una sensacion de
    // seguridad que no corresponde con nada. Todos viven dentro de la
    // misma base que respaldan.
    const e = estadoDeRespaldos({ ultimo: haceDias(0), ultimoFuera: null }, HOY)
    expect(e.nivel).toBe('nunca-salio')
    expect(e.diasUltimo).toBe(0)
    expect(e.diasFuera).toBeNull()
  })

  it('sin ningun respaldo lo dice sin rodeos', () => {
    const e = estadoDeRespaldos({ ultimo: null, ultimoFuera: null }, HOY)
    expect(e.nivel).toBe('sin-respaldo')
    expect(e.detalle).toMatch(/pierdes todo/)
  })
})

describe('El reloj cuenta desde que SALIO, no desde que se hizo', () => {
  it('uno de hoy que nunca salio no vale mas que uno viejo que si salio', () => {
    // El respaldo de hoy se pierde con la base; el de hace dos dias que
    // esta en otro sitio, no. Contar desde la creacion mentiria.
    const reciente = estadoDeRespaldos({ ultimo: haceDias(0), ultimoFuera: null }, HOY)
    const viejoPeroFuera = estadoDeRespaldos({ ultimo: haceDias(2), ultimoFuera: haceDias(2) }, HOY)
    expect(reciente.nivel).toBe('nunca-salio')
    expect(viejoPeroFuera.nivel).toBe('al-dia')
  })

  it('avisa a los tres dias', () => {
    expect(estadoDeRespaldos({ ultimo: HOY, ultimoFuera: haceDias(DIAS_AVISO - 1) }, HOY).nivel).toBe(
      'al-dia',
    )
    expect(estadoDeRespaldos({ ultimo: HOY, ultimoFuera: haceDias(DIAS_AVISO) }, HOY).nivel).toBe(
      'viejo',
    )
  })

  it('y se pone serio a los siete', () => {
    expect(
      estadoDeRespaldos({ ultimo: HOY, ultimoFuera: haceDias(DIAS_ALARMA - 1) }, HOY).nivel,
    ).toBe('viejo')
    expect(estadoDeRespaldos({ ultimo: HOY, ultimoFuera: haceDias(DIAS_ALARMA) }, HOY).nivel).toBe(
      'muy-viejo',
    )
  })
})

describe('Lo que se le dice al cliente', () => {
  it('el titulo dice el numero de dias, no un adjetivo', () => {
    // "Tus respaldos estan desactualizados" no mueve a nadie. "Tu ultimo
    // respaldo fuera de aqui tiene 12 dias" si, porque son 12 dias de
    // facturacion.
    expect(estadoDeRespaldos({ ultimo: HOY, ultimoFuera: haceDias(12) }, HOY).titulo).toContain('12')
  })

  it('en singular no dice "1 dias"', () => {
    expect(estadoDeRespaldos({ ultimo: HOY, ultimoFuera: haceDias(1) }, HOY).titulo).toContain(
      '1 dia',
    )
    expect(estadoDeRespaldos({ ultimo: HOY, ultimoFuera: haceDias(1) }, HOY).titulo).not.toContain(
      '1 dias',
    )
  })

  it('el de hoy no dice "hace 0 dias"', () => {
    const t = estadoDeRespaldos({ ultimo: HOY, ultimoFuera: HOY }, HOY).titulo
    expect(t).not.toContain('0 dias')
    expect(t).toMatch(/hoy/)
  })
})
