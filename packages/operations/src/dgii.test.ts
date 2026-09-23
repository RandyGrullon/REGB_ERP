import { describe, expect, it } from 'vitest'
import {
  canIssue,
  fechaFiscal,
  periodoFiscal,
  formatNcf,
  formatTaxId,
  isElectronic,
  isValidCedula,
  isValidNcf,
  isValidRnc,
  isValidTaxId,
  requiresBuyerTaxId,
  sequenceHealth,
  type NcfSequenceState,
} from './dgii.js'

describe('NCF', () => {
  it('rellena 8 digitos en la serie B y 10 en la e-CF', () => {
    expect(formatNcf('B02', 1)).toBe('B0200000001')
    expect(formatNcf('E32', 1)).toBe('E320000000001')
  })

  it('rechaza secuencias invalidas y desbordes', () => {
    expect(() => formatNcf('B02', 0)).toThrow(/entero positivo/)
    expect(() => formatNcf('B02', 1.5)).toThrow(/entero positivo/)
    expect(() => formatNcf('B02', 100_000_000)).toThrow(/excede el maximo/)
  })

  it('valida forma y longitud coherente con el tipo', () => {
    expect(isValidNcf('B0200000001')).toBe(true)
    expect(isValidNcf('E320000000001')).toBe(true)
    // Un e-CF con 8 digitos es rechazo directo de la DGII.
    expect(isValidNcf('E3200000001')).toBe(false)
    expect(isValidNcf('B020000000001')).toBe(false)
    expect(isValidNcf('X0200000001')).toBe(false)
  })

  it('distingue electronico de impreso', () => {
    expect(isElectronic('E31')).toBe(true)
    expect(isElectronic('B01')).toBe(false)
  })

  it('el credito fiscal exige RNC del comprador', () => {
    expect(requiresBuyerTaxId('B01')).toBe(true)
    expect(requiresBuyerTaxId('E31')).toBe(true)
    // El de consumo va a consumidor final: no exige identificacion.
    expect(requiresBuyerTaxId('B02')).toBe(false)
  })
})

describe('RNC y cedula', () => {
  it('valida RNC reales con su digito verificador', () => {
    // 401-00755-1 es el RNC de la propia DGII, de dominio publico.
    //   4·7+0·9+1·8+0·6+0·5+7·4+5·3+5·2 = 89 → 89 mod 11 = 1 → verificador 1 ✓
    expect(isValidRnc('401007551')).toBe(true)
    // 130-11111-1, el del colmado de la demostracion, cuadra por la misma
    // regla: suma 54 → 54 mod 11 = 10 → verificador 11-10 = 1 ✓
    expect(isValidRnc('130111111')).toBe(true)
  })

  it('rechaza un RNC con un digito cambiado', () => {
    expect(isValidRnc('401007552')).toBe(false)
    expect(isValidRnc('12345678')).toBe(false) // 8 digitos
    expect(isValidRnc('')).toBe(false)
  })

  it('valida cedulas por su verificador', () => {
    expect(isValidCedula('00113918205')).toBe(true)
    expect(isValidCedula('00113918206')).toBe(false)
  })

  it('acepta cualquiera de los dos e ignora guiones', () => {
    expect(isValidTaxId('401-00755-1')).toBe(true)
    expect(isValidTaxId('001-1391820-5')).toBe(true)
    expect(isValidTaxId('123')).toBe(false)
  })

  it('formatea con la mascara que espera un dominicano', () => {
    expect(formatTaxId('401007551')).toBe('401-00755-1')
    expect(formatTaxId('00113918205')).toBe('001-1391820-5')
  })
})

describe('secuencias autorizadas', () => {
  const base: NcfSequenceState = {
    tipo: 'B02',
    desde: 1,
    hasta: 100,
    proximo: 1,
    vence: new Date(2027, 11, 31),
  }
  const hoy = new Date(2026, 7, 2)

  it('cuenta lo que queda', () => {
    expect(sequenceHealth(base, hoy).restantes).toBe(100)
    expect(sequenceHealth({ ...base, proximo: 100 }, hoy).restantes).toBe(1)
  })

  it('avisa ANTES de agotarse: pedirle NCF a la DGII toma dias', () => {
    const h = sequenceHealth({ ...base, proximo: 60 }, hoy)
    expect(h.porAgotarse).toBe(true)
    expect(h.agotada).toBe(false)
  })

  it('agotada y vencida son cosas distintas y ambas bloquean', () => {
    const agotada = { ...base, proximo: 101 }
    expect(sequenceHealth(agotada, hoy).agotada).toBe(true)
    expect(canIssue(agotada, hoy)).toBe(false)

    const vencida = { ...base, vence: new Date(2026, 0, 1) }
    expect(sequenceHealth(vencida, hoy).vencida).toBe(true)
    expect(canIssue(vencida, hoy)).toBe(false)
  })

  it('una secuencia sana si permite emitir', () => {
    expect(canIssue(base, hoy)).toBe(true)
  })
})

describe('Fecha fiscal: el dia que cuenta es el de Santo Domingo, no el del servidor', () => {
  // 30 de septiembre a las 9:00 p. m. en RD = 1 de octubre 01:00 UTC. En
  // UTC la venta caia en octubre: se declaraba en el 607 y el IT-1 del mes
  // equivocado.
  const nueveDeLaNoche = new Date('2026-10-01T01:00:00Z')

  it('una venta a las 9 p. m. del 30 es del 30, no del 1', () => {
    expect(fechaFiscal(nueveDeLaNoche)).toBe('2026-09-30')
    expect(periodoFiscal(nueveDeLaNoche)).toBe('202609')
  })

  it('a las 8 p. m. en punto ya NO es el dia siguiente, a medianoche de RD si', () => {
    expect(fechaFiscal(new Date('2026-10-01T00:00:00Z'))).toBe('2026-09-30')
    expect(fechaFiscal(new Date('2026-10-01T03:59:59Z'))).toBe('2026-09-30')
    expect(fechaFiscal(new Date('2026-10-01T04:00:00Z'))).toBe('2026-10-01')
  })

  it('el cambio de año tambien respeta la hora de RD', () => {
    expect(periodoFiscal(new Date('2027-01-01T02:30:00Z'))).toBe('202612')
  })

  it('no depende de la zona del proceso: devuelve componentes, no toISOString', () => {
    // Si usara toISOString() daria el dia UTC, que es justo el error.
    expect(fechaFiscal(nueveDeLaNoche)).not.toBe(nueveDeLaNoche.toISOString().slice(0, 10))
  })
})
