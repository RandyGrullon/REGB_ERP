import { describe, expect, it } from 'vitest'
import {
  TASAS_ITBIS_RD,
  VENCIMIENTOS_RD,
  calcularRetenciones,
  calendarioFiscal,
  creditoArrastrado,
  desglosarItbis,
  liquidarItbis,
  periodoAnterior,
  porcentajeAFraccion,
  proximoDiaHabil,
  type ReglaRetencion,
} from './taxes.js'

describe('TASAS_ITBIS_RD', () => {
  it('las tasas van en fraccion, no en puntos: 0.18 y nunca 18', () => {
    for (const t of TASAS_ITBIS_RD) {
      expect(t.rate).toBeGreaterThanOrEqual(0)
      expect(t.rate).toBeLessThanOrEqual(1)
    }
  })

  it('hay exactamente una tasa por defecto', () => {
    expect(TASAS_ITBIS_RD.filter((t) => t.isDefault)).toHaveLength(1)
  })
})

describe('porcentajeAFraccion', () => {
  it('lo normal: 18 es el 18% y se guarda 0.18', () => {
    expect(porcentajeAFraccion('18')).toBe(0.18)
    expect(porcentajeAFraccion(' 18 % ')).toBe(0.18)
    expect(porcentajeAFraccion('2.5')).toBe(0.025)
    expect(porcentajeAFraccion('0')).toBe(0)
    expect(porcentajeAFraccion('100')).toBe(1)
  })

  it('el 1 de una regla del 1% ya no se guarda como 100%', () => {
    // Era el agujero de la heuristica `n > 1 ? n / 100 : n`: el rango 0-1
    // es justo donde no se puede acertar, y la validacion posterior solo
    // rechazaba > 1, asi que 100% pasaba limpio.
    expect(porcentajeAFraccion('1')).toBe(0.01)
    expect(porcentajeAFraccion('0.5')).toBe(0.005)
  })

  it('lo que no es un porcentaje no pasa', () => {
    for (const malo of ['', '   ', 'dieciocho', '-1', '101']) {
      expect(porcentajeAFraccion(malo), malo).toBeNull()
    }
  })
})

describe('periodoAnterior', () => {
  it('retrocede un mes', () => {
    expect(periodoAnterior('202609')).toBe('202608')
    expect(periodoAnterior('202610')).toBe('202609')
  })

  it('enero retrocede a diciembre del año pasado', () => {
    expect(periodoAnterior('202601')).toBe('202512')
  })
})

describe('creditoArrastrado', () => {
  it('toma el saldo del mes inmediatamente anterior', () => {
    expect(
      creditoArrastrado('202610', [{ period: '202609', creditForward: 5000 }]),
    ).toEqual({ previousCredit: 5000, faltaCerrar: null })
  })

  it('el mismo saldo NO se consume dos veces saltandose un mes', () => {
    // El caso que costaba dinero de verdad: cerrar septiembre con 5,000 de
    // saldo, saltarse octubre y cerrar noviembre se los comia; volver
    // despues a cerrar octubre se los comia otra vez. Dos declaraciones
    // bajaban el ITBIS a pagar por el mismo dinero, y las dos quedaban
    // cerradas como foto: hay que rectificar las dos.
    const cerradas = [{ period: '202609', creditForward: 5000 }]
    expect(creditoArrastrado('202611', cerradas)).toEqual({
      previousCredit: 0,
      faltaCerrar: '202610',
    })
  })

  it('y cuando octubre ya esta cerrado, noviembre toma el saldo de octubre', () => {
    const cerradas = [
      { period: '202609', creditForward: 5000 },
      { period: '202610', creditForward: 1200 },
    ]
    expect(creditoArrastrado('202611', cerradas)).toEqual({
      previousCredit: 1200,
      faltaCerrar: null,
    })
  })

  it('la primera declaracion de la historia no arrastra nada y no falta ninguna', () => {
    expect(creditoArrastrado('202609', [])).toEqual({ previousCredit: 0, faltaCerrar: null })
  })

  it('una declaracion POSTERIOR no cuenta como eslabon de la cadena', () => {
    // Cerrar un periodo viejo cuando ya hay uno nuevo cerrado es legitimo
    // -ponerse al dia hacia atras-, y ahi tampoco hay saldo que tomar.
    expect(
      creditoArrastrado('202609', [{ period: '202611', creditForward: 900 }]),
    ).toEqual({ previousCredit: 0, faltaCerrar: null })
  })

  it('enero busca el diciembre del año pasado, no el diciembre de este', () => {
    const cerradas = [{ period: '202512', creditForward: 300 }]
    expect(creditoArrastrado('202601', cerradas)).toEqual({
      previousCredit: 300,
      faltaCerrar: null,
    })
  })
})

describe('proximoDiaHabil', () => {
  it('el sabado corre al lunes', () => {
    // 10 de octubre de 2026 cae sabado
    expect(proximoDiaHabil(new Date(2026, 9, 10, 12)).getDate()).toBe(12)
  })

  it('el domingo corre al lunes', () => {
    // 15 de noviembre de 2026 cae domingo
    expect(proximoDiaHabil(new Date(2026, 10, 15, 12)).getDate()).toBe(16)
  })

  it('un dia entre semana se queda donde esta', () => {
    expect(proximoDiaHabil(new Date(2026, 9, 20, 12)).getDate()).toBe(20)
  })

  it('no le cambia la fecha a quien la pasa', () => {
    const sabado = new Date(2026, 9, 10, 12)
    proximoDiaHabil(sabado)
    expect(sabado.getDate()).toBe(10)
  })
})

describe('calendarioFiscal', () => {
  const hoy = new Date(2026, 9, 1, 12)

  it('trae los cinco formularios, ordenados por fecha limite', () => {
    const c = calendarioFiscal('202609', hoy)
    expect(c).toHaveLength(Object.keys(VENCIMIENTOS_RD).length)
    for (let i = 1; i < c.length; i++) {
      expect(c[i]!.vence.getTime()).toBeGreaterThanOrEqual(c[i - 1]!.vence.getTime())
    }
  })

  it('se declara el mes SIGUIENTE al periodo: septiembre vence en octubre', () => {
    const it1 = calendarioFiscal('202609', hoy).find((o) => o.form === 'IT-1')!
    expect(it1.vence.getFullYear()).toBe(2026)
    expect(it1.vence.getMonth()).toBe(9)
    expect(it1.vence.getDate()).toBe(20)
  })

  it('el IR-17 de septiembre caeria sabado 10 y se corre al lunes 12', () => {
    const ir17 = calendarioFiscal('202609', hoy).find((o) => o.form === 'IR-17')!
    expect(ir17.vence.getDate()).toBe(12)
  })

  it('ninguna fecha limite cae fin de semana', () => {
    for (const periodo of ['202601', '202602', '202609', '202610', '202612']) {
      for (const o of calendarioFiscal(periodo, hoy)) {
        expect([0, 6]).not.toContain(o.vence.getDay())
      }
    }
  })

  it('diciembre rueda al enero del año siguiente', () => {
    const it1 = calendarioFiscal('202612', hoy).find((o) => o.form === 'IT-1')!
    expect(it1.vence.getFullYear()).toBe(2027)
    expect(it1.vence.getMonth()).toBe(0)
  })

  it('cuenta los dias que faltan y marca lo vencido', () => {
    const c = calendarioFiscal('202609', new Date(2026, 9, 19, 12))
    const it1 = c.find((o) => o.form === 'IT-1')!
    expect(it1.diasRestantes).toBe(1)
    expect(it1.vencida).toBe(false)

    const informativo = c.find((o) => o.form === '606')!
    expect(informativo.diasRestantes).toBe(-4)
    expect(informativo.vencida).toBe(true)
  })

  it('el mismo dia del vencimiento todavia no esta vencido', () => {
    const it1 = calendarioFiscal('202609', new Date(2026, 9, 20, 12)).find(
      (o) => o.form === 'IT-1',
    )!
    expect(it1.diasRestantes).toBe(0)
    expect(it1.vencida).toBe(false)
  })
})

describe('desglosarItbis', () => {
  it('118 al 18% da 100 de base y 18 de ITBIS', () => {
    expect(desglosarItbis(118, 0.18)).toEqual({ base: 100, itbis: 18 })
  })

  it('base + itbis cuadra EXACTO contra el total, sin el centavo perdido', () => {
    for (const total of [100, 999.99, 1234.56, 7.77, 0.01]) {
      const d = desglosarItbis(total, 0.18)
      expect(Math.round((d.base + d.itbis) * 100) / 100).toBe(total)
    }
  })

  it('la tasa reducida del 16% tambien cuadra', () => {
    const d = desglosarItbis(1000, 0.16)
    expect(d.base).toBe(862.07)
    expect(d.itbis).toBe(137.93)
  })

  it('exento: todo es base y no hay impuesto', () => {
    expect(desglosarItbis(500, 0)).toEqual({ base: 500, itbis: 0 })
  })
})

describe('calcularRetenciones', () => {
  const reglas: ReglaRetencion[] = [
    { tax: 'itbis', partyType: 'fisica', base: 'itbis', rate: 1 },
    { tax: 'itbis', partyType: 'juridica', base: 'itbis', rate: 0.3 },
    { tax: 'isr', partyType: 'fisica', base: 'subtotal', rate: 0.1, dgiiIsrType: '02' },
  ]

  it('a una persona juridica se le retiene el 30% del ITBIS y nada de ISR', () => {
    const r = calcularRetenciones(
      { subtotal: 10000, itbis: 1800, partyType: 'juridica' },
      reglas,
    )
    expect(r.itbisRetenido).toBe(540)
    expect(r.isrRetenido).toBe(0)
    expect(r.tipoRetencionIsr).toBeNull()
    expect(r.totalRetenido).toBe(540)
    expect(r.netoAPagar).toBe(11260)
  })

  it('el ISR se calcula sobre el SUBTOTAL, no sobre el ITBIS', () => {
    const r = calcularRetenciones({ subtotal: 10000, itbis: 1800, partyType: 'fisica' }, reglas)
    // 10% de 10,000 = 1,000. Sobre el ITBIS habria dado 180: seis veces mal
    // y con cara de numero razonable, que es lo peligroso.
    expect(r.isrRetenido).toBe(1000)
    expect(r.itbisRetenido).toBe(1800)
    expect(r.tipoRetencionIsr).toBe('02')
    expect(r.netoAPagar).toBe(9000)
  })

  it('un proveedor exento no paga retencion de nada', () => {
    const r = calcularRetenciones(
      { subtotal: 10000, itbis: 1800, partyType: 'fisica', isExempt: true },
      reglas,
    )
    expect(r).toEqual({
      itbisRetenido: 0,
      isrRetenido: 0,
      tipoRetencionIsr: null,
      totalRetenido: 0,
      netoAPagar: 11800,
      candidatas: { itbis: 0, isr: 0 },
      reglaAplicada: { itbis: null, isr: null },
    })
  })

  it("'ambas' es comodin: cubre al que no tiene regla propia", () => {
    const r = calcularRetenciones({ subtotal: 1000, itbis: 180, partyType: 'juridica' }, [
      { tax: 'isr', partyType: 'ambas', base: 'subtotal', rate: 0.05, dgiiIsrType: '03' },
    ])
    expect(r.isrRetenido).toBe(50)
    expect(r.tipoRetencionIsr).toBe('03')
  })

  it('la regla que nombra al tipo de proveedor le gana al comodin', () => {
    const r = calcularRetenciones({ subtotal: 1000, itbis: 180, partyType: 'fisica' }, [
      { tax: 'isr', partyType: 'ambas', base: 'subtotal', rate: 0.05, dgiiIsrType: '03' },
      { tax: 'isr', partyType: 'fisica', base: 'subtotal', rate: 0.1, dgiiIsrType: '02' },
    ])
    expect(r.isrRetenido).toBe(100)
    expect(r.tipoRetencionIsr).toBe('02')
  })

  it('una regla desactivada no retiene', () => {
    const r = calcularRetenciones({ subtotal: 1000, itbis: 180, partyType: 'fisica' }, [
      { tax: 'itbis', partyType: 'fisica', base: 'itbis', rate: 1, isActive: false },
    ])
    expect(r.itbisRetenido).toBe(0)
    expect(r.netoAPagar).toBe(1180)
  })

  it('sin reglas configuradas no se retiene nada: el default es no tocar el pago', () => {
    const r = calcularRetenciones({ subtotal: 1000, itbis: 180, partyType: 'juridica' }, [])
    expect(r.totalRetenido).toBe(0)
    expect(r.netoAPagar).toBe(1180)
  })

  describe('con varias reglas candidatas', () => {
    // Los nueve codigos 01-09 del 606 existen porque alquileres, honorarios
    // e intereses se retienen distinto: tener dos reglas de ISR para
    // persona fisica no es un caso raro, y la unica restriccion de la
    // tabla es `unique (tenant_id, code)`.
    const alquiler: ReglaRetencion = {
      tax: 'isr',
      partyType: 'fisica',
      base: 'subtotal',
      rate: 0.1,
      dgiiIsrType: '01',
      code: 'ISR-ALQ',
      effectiveFrom: '2026-01-01',
    }
    const honorarios: ReglaRetencion = {
      tax: 'isr',
      partyType: 'fisica',
      base: 'subtotal',
      rate: 0.05,
      dgiiIsrType: '02',
      code: 'ISR-HON',
      effectiveFrom: '2026-06-01',
    }

    it('gana la vigencia mas reciente, venga en el orden que venga', () => {
      // Antes ganaba la primera del arreglo, o sea la que Postgres
      // devolviera esa vez: con tasas distintas se retiene mal, y con la
      // misma tasa el 606 del mes sale con el codigo que no era.
      for (const reglas of [
        [alquiler, honorarios],
        [honorarios, alquiler],
      ]) {
        const r = calcularRetenciones({ subtotal: 10000, itbis: 1800, partyType: 'fisica' }, reglas)
        expect(r.isrRetenido).toBe(500)
        expect(r.tipoRetencionIsr).toBe('02')
        expect(r.reglaAplicada.isr).toBe('ISR-HON')
      }
    })

    it('a igual vigencia desempata el codigo, y tampoco depende del orden', () => {
      const mismoDia: ReglaRetencion = { ...honorarios, effectiveFrom: '2026-01-01' }
      for (const reglas of [
        [mismoDia, alquiler],
        [alquiler, mismoDia],
      ]) {
        expect(
          calcularRetenciones({ subtotal: 10000, itbis: 0, partyType: 'fisica' }, reglas)
            .reglaAplicada.isr,
        ).toBe('ISR-ALQ')
      }
    })

    it('avisa de que se aplico UNA de varias: el numero limpio es lo peligroso', () => {
      const r = calcularRetenciones({ subtotal: 10000, itbis: 1800, partyType: 'fisica' }, [
        alquiler,
        honorarios,
      ])
      expect(r.candidatas.isr).toBe(2)
      expect(r.candidatas.itbis).toBe(0)
    })

    it('con una sola candidata no hay nada que avisar', () => {
      const r = calcularRetenciones({ subtotal: 10000, itbis: 1800, partyType: 'fisica' }, [
        honorarios,
      ])
      expect(r.candidatas.isr).toBe(1)
    })

    it('el comodin no compite con la regla propia: si hay propia, solo cuentan las propias', () => {
      const r = calcularRetenciones({ subtotal: 1000, itbis: 0, partyType: 'fisica' }, [
        { tax: 'isr', partyType: 'ambas', base: 'subtotal', rate: 0.02, dgiiIsrType: '03' },
        honorarios,
      ])
      expect(r.candidatas.isr).toBe(1)
      expect(r.reglaAplicada.isr).toBe('ISR-HON')
    })
  })

  describe('la base del ISR cuando la factura es mixta', () => {
    const isrFisica: ReglaRetencion[] = [
      { tax: 'isr', partyType: 'fisica', base: 'subtotal', rate: 0.1, dgiiIsrType: '02' },
    ]

    it('el ISR se retiene sobre los SERVICIOS, no sobre las piezas', () => {
      // El tecnico que factura 7,000 de piezas y 3,000 de mano de obra en
      // el mismo documento. Sobre el subtotal completo se le retienen
      // 1,000 y se le paga de menos; sobre los servicios, 300. Es el mismo
      // dato que despues hay que teclear en supplier_invoices.
      // services_amount para el campo 8 del 606.
      const r = calcularRetenciones(
        { subtotal: 10000, itbis: 1800, partyType: 'fisica', servicios: 3000 },
        isrFisica,
      )
      expect(r.isrRetenido).toBe(300)
      expect(r.netoAPagar).toBe(11500)
    })

    it('sin decir cuanto es servicios, la base sigue siendo el subtotal completo', () => {
      // El proveedor de puro servicio es el caso normal y no cambia.
      const r = calcularRetenciones(
        { subtotal: 10000, itbis: 1800, partyType: 'fisica' },
        isrFisica,
      )
      expect(r.isrRetenido).toBe(1000)
    })

    it('servicios en cero retiene cero de ISR: una compra de puros bienes', () => {
      const r = calcularRetenciones(
        { subtotal: 10000, itbis: 1800, partyType: 'fisica', servicios: 0 },
        isrFisica,
      )
      expect(r.isrRetenido).toBe(0)
      expect(r.netoAPagar).toBe(11800)
    })

    it('un dedazo no retiene sobre mas de lo que dice la factura', () => {
      const r = calcularRetenciones(
        { subtotal: 10000, itbis: 1800, partyType: 'fisica', servicios: 99999 },
        isrFisica,
      )
      expect(r.isrRetenido).toBe(1000)
    })

    it('la retencion de ITBIS no se toca: su base sigue siendo el ITBIS facturado', () => {
      const r = calcularRetenciones(
        { subtotal: 10000, itbis: 1800, partyType: 'fisica', servicios: 3000 },
        [
          ...isrFisica,
          { tax: 'itbis', partyType: 'fisica', base: 'itbis', rate: 1 },
        ],
      )
      expect(r.itbisRetenido).toBe(1800)
    })
  })
})

describe('liquidarItbis', () => {
  it('cobrado mayor que adelantado: se paga la diferencia', () => {
    expect(
      liquidarItbis({ itbisCharged: 5000, itbisPaid: 3000, itbisWithheld: 0, itbisRetainedFromSuppliers: 0, previousCredit: 0 }),
    ).toEqual({ amountDue: 2000, creditForward: 0 })
  })

  it('nunca declara a pagar en negativo: el exceso se arrastra', () => {
    expect(
      liquidarItbis({ itbisCharged: 1000, itbisPaid: 3000, itbisWithheld: 0, itbisRetainedFromSuppliers: 0, previousCredit: 0 }),
    ).toEqual({ amountDue: 0, creditForward: 2000 })
  })

  it('lo que me retuvieron y el saldo anterior tambien restan', () => {
    expect(
      liquidarItbis({
        itbisCharged: 5000,
        itbisPaid: 1000,
        itbisWithheld: 500, itbisRetainedFromSuppliers: 0,
        previousCredit: 1500,
      }),
    ).toEqual({ amountDue: 2000, creditForward: 0 })
  })

  it('el ITBIS que YO le retuve a mis proveedores SUMA, no resta', () => {
    // Es el unico termino que suma, y por eso tiene prueba propia.
    //
    // Retenerle ITBIS a un proveedor no es un gasto mio: es que no se lo
    // pague a el para entregarselo a la DGII. Esa plata esta en mi
    // cuenta y la debo. Si restara -o si no estuviera-, el IT-1 saldria
    // corto justo por lo que mas duele: dinero del fisco ya cobrado.
    expect(
      liquidarItbis({
        itbisCharged: 5000,
        itbisPaid: 1000,
        itbisWithheld: 0,
        itbisRetainedFromSuppliers: 800,
        previousCredit: 0,
      }),
    ).toEqual({ amountDue: 4800, creditForward: 0 })
  })

  it('y puede convertir un saldo a favor en algo a pagar', () => {
    // Sin el termino, este mes "sobraban" 500 y no se pagaba nada. Con
    // el, se deben 300. Es exactamente la declaracion que la DGII
    // reclama despues, con recargo.
    expect(
      liquidarItbis({
        itbisCharged: 1000,
        itbisPaid: 1500,
        itbisWithheld: 0,
        itbisRetainedFromSuppliers: 800,
        previousCredit: 0,
      }),
    ).toEqual({ amountDue: 300, creditForward: 0 })
  })

  it('cuando cuadra exacto no se debe ni se arrastra nada', () => {
    expect(
      liquidarItbis({ itbisCharged: 3000, itbisPaid: 3000, itbisWithheld: 0, itbisRetainedFromSuppliers: 0, previousCredit: 0 }),
    ).toEqual({ amountDue: 0, creditForward: 0 })
  })

  it('a pagar y saldo a favor son excluyentes: uno de los dos siempre es cero', () => {
    const casos = [
      { itbisCharged: 100.55, itbisPaid: 33.33, itbisWithheld: 0, itbisRetainedFromSuppliers: 0, previousCredit: 0 },
      { itbisCharged: 0, itbisPaid: 0, itbisWithheld: 0, itbisRetainedFromSuppliers: 0, previousCredit: 0 },
      { itbisCharged: 12.01, itbisPaid: 12.02, itbisWithheld: 0, itbisRetainedFromSuppliers: 0, previousCredit: 0 },
      { itbisCharged: 9999.99, itbisPaid: 0, itbisWithheld: 9999.99, itbisRetainedFromSuppliers: 0, previousCredit: 0 },
    ]
    for (const c of casos) {
      const r = liquidarItbis(c)
      expect(r.amountDue === 0 || r.creditForward === 0).toBe(true)
      expect(r.amountDue).toBeGreaterThanOrEqual(0)
      expect(r.creditForward).toBeGreaterThanOrEqual(0)
    }
  })

  it('los centavos no se pierden por redondeo', () => {
    expect(
      liquidarItbis({
        itbisCharged: 1000.15,
        itbisPaid: 333.33,
        itbisWithheld: 0.01, itbisRetainedFromSuppliers: 0,
        previousCredit: 0,
      }),
    ).toEqual({ amountDue: 666.81, creditForward: 0 })
  })
})
