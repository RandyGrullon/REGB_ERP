import { describe, expect, it } from 'vitest'
import {
  TASAS_ITBIS_RD,
  VENCIMIENTOS_RD,
  calcularRetenciones,
  calendarioFiscal,
  desglosarItbis,
  liquidarItbis,
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
