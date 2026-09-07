import { describe, expect, it } from 'vitest'
import {
  codigoEan13Valido,
  digitoVerificadorEan13,
  generarEan13,
  patronBarrasEan13,
} from './barcode'

describe('digitoVerificadorEan13', () => {
  it('calcula el digito verificador de un EAN-13 real conocido', () => {
    // 4006381333931 es un EAN-13 real y valido (ejemplo estandar de GS1/Wikipedia).
    expect(digitoVerificadorEan13('400638133393')).toBe(1)
  })

  it('rechaza una base que no tiene exactamente 12 digitos', () => {
    expect(() => digitoVerificadorEan13('123')).toThrow(/12 digitos/)
    expect(() => digitoVerificadorEan13('12345678901a')).toThrow(/12 digitos/)
  })
})

describe('generarEan13', () => {
  it('genera el codigo completo con el digito verificador correcto', () => {
    expect(generarEan13('400638133393')).toBe('4006381333931')
  })
})

describe('codigoEan13Valido', () => {
  it('un codigo real es valido', () => {
    expect(codigoEan13Valido('4006381333931')).toBe(true)
  })

  it('el mismo codigo con el ultimo digito cambiado ya no es valido', () => {
    expect(codigoEan13Valido('4006381333939')).toBe(false)
  })

  it('un codigo que no tiene 13 digitos no es valido', () => {
    expect(codigoEan13Valido('123')).toBe(false)
    expect(codigoEan13Valido('400638133393a')).toBe(false)
  })
})

describe('patronBarrasEan13', () => {
  it('produce un patron de exactamente 95 modulos', () => {
    expect(patronBarrasEan13('4006381333931')).toHaveLength(95)
  })

  it('empieza y termina con la guarda lateral 101', () => {
    const patron = patronBarrasEan13('4006381333931')
    expect(patron.slice(0, 3)).toBe('101')
    expect(patron.slice(-3)).toBe('101')
  })

  it('tiene la guarda central 01010 justo en el medio', () => {
    const patron = patronBarrasEan13('4006381333931')
    // 3 guarda + 42 izquierda = posicion 45, ahi empieza la guarda central.
    expect(patron.slice(45, 50)).toBe('01010')
  })

  it('rechaza un codigo con el digito verificador incorrecto', () => {
    expect(() => patronBarrasEan13('4006381333939')).toThrow(/no es valido/)
  })

  it('dos productos con distinto primer digito producen distinta paridad izquierda', () => {
    const a = generarEan13('100638133393')
    const b = generarEan13('900638133393')
    expect(patronBarrasEan13(a).slice(3, 45)).not.toBe(patronBarrasEan13(b).slice(3, 45))
  })
})
