import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ColaVentas, validarVentaEntrante } from './cola'

/**
 * La cola es lo unico que separa "se fue la luz" de "perdimos el dia".
 *
 * Lo que se prueba aqui es exactamente lo que pide la puerta de F5:
 * vender sin linea, reintentar, y que al final no haya ni una venta de mas
 * ni una de menos.
 */

const carpetas: string[] = []
function carpetaTemporal(): string {
  const d = mkdtempSync(join(tmpdir(), 'regb-cola-'))
  carpetas.push(d)
  return d
}

afterEach(() => {
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true })
})

const venta = (n: number) => ({
  soldAt: new Date(Date.UTC(2026, 7, 3, 12, n)).toISOString(),
  shiftId: 'turno-1',
  customerId: null,
  cart: [{ productId: 'p1', qty: n, discountPct: 0 }],
  payments: [{ method: 'cash', amount: 100 * n }],
})

describe('La cola sobrevive al apagon', () => {
  it('lo encolado se relee tras reiniciar la app', () => {
    const ruta = join(carpetaTemporal(), 'ventas.json')

    const primera = new ColaVentas(ruta)
    primera.encolar(venta(1))
    primera.encolar(venta(2))
    expect(primera.pendientes).toBe(2)

    // Otra instancia = la app arrancando de nuevo.
    const segunda = new ColaVentas(ruta)
    expect(segunda.pendientes).toBe(2)
    expect(segunda.siguientes()[0]?.cart).toEqual([{ productId: 'p1', qty: 1, discountPct: 0 }])
  })

  it('mantiene el orden del cobro, no el de sincronizacion', () => {
    const cola = new ColaVentas(join(carpetaTemporal(), 'v.json'))
    cola.encolar(venta(1))
    cola.encolar(venta(2))
    cola.encolar(venta(3))
    const refs = cola.siguientes().map((v) => v.soldAt)
    expect(refs).toEqual([...refs].sort())
  })

  it('un archivo corrupto NO se borra: se aparta con marca de tiempo', () => {
    const dir = carpetaTemporal()
    const ruta = join(dir, 'ventas.json')
    writeFileSync(ruta, '{ esto no es json valido', 'utf8')

    const cola = new ColaVentas(ruta)
    expect(cola.pendientes).toBe(0)

    // Dentro podia haber ventas de verdad: tienen que quedar recuperables.
    const apartados = readdirSync(dir).filter((f) => f.includes('.corrupto-'))
    expect(apartados).toHaveLength(1)
  })

  it('escribe de forma atomica: no deja el temporal a medias', () => {
    const dir = carpetaTemporal()
    const ruta = join(dir, 'ventas.json')
    const cola = new ColaVentas(ruta)
    cola.encolar(venta(1))
    expect(existsSync(ruta)).toBe(true)
    expect(existsSync(`${ruta}.tmp`)).toBe(false)
  })
})

describe('No se duplica ni se pierde', () => {
  it('encolar dos veces la misma referencia deja UNA venta', () => {
    const cola = new ColaVentas(join(carpetaTemporal(), 'v.json'))
    const ref = cola.encolar(venta(1))
    cola.encolar({ ...venta(1), clientRef: ref })
    cola.encolar({ ...venta(1), clientRef: ref })
    expect(cola.pendientes).toBe(1)
  })

  it('cada venta distinta recibe su propia referencia', () => {
    const cola = new ColaVentas(join(carpetaTemporal(), 'v.json'))
    const refs = [venta(1), venta(2), venta(3)].map((v) => cola.encolar(v))
    expect(new Set(refs).size).toBe(3)
  })

  it('solo salen de la cola las que el servidor confirmo', () => {
    const cola = new ColaVentas(join(carpetaTemporal(), 'v.json'))
    const a = cola.encolar(venta(1))
    const b = cola.encolar(venta(2))
    cola.encolar(venta(3))

    cola.confirmar([a, b])
    expect(cola.pendientes).toBe(1)
    expect(cola.siguientes()[0]?.clientRef).not.toBe(a)
  })

  it('una venta rechazada se queda, con su motivo escrito', () => {
    const cola = new ColaVentas(join(carpetaTemporal(), 'v.json'))
    const ref = cola.encolar(venta(1))

    cola.fallo(ref, 'El turno ya se cerro.')
    cola.fallo(ref, 'El turno ya se cerro.')

    expect(cola.pendientes).toBe(1)
    const v = cola.siguientes()[0]
    expect(v?.intentos).toBe(2)
    expect(v?.ultimoError).toBe('El turno ya se cerro.')
  })

  it('NUNCA se descarta sola por muchos intentos: eso seria perder dinero', () => {
    const cola = new ColaVentas(join(carpetaTemporal(), 'v.json'))
    const ref = cola.encolar(venta(1))
    for (let i = 0; i < 50; i++) cola.fallo(ref, 'sin conexion')

    expect(cola.pendientes).toBe(1)
    expect(cola.atascadas()).toHaveLength(1)
  })

  it('las atascadas se distinguen de las que acaban de entrar', () => {
    const cola = new ColaVentas(join(carpetaTemporal(), 'v.json'))
    const vieja = cola.encolar(venta(1))
    cola.encolar(venta(2))
    for (let i = 0; i < 6; i++) cola.fallo(vieja, 'error raro')

    expect(cola.pendientes).toBe(2)
    expect(cola.atascadas().map((v) => v.clientRef)).toEqual([vieja])
  })
})

describe('Ocho horas sin linea', () => {
  it('aguanta un dia entero de ventas y las devuelve todas', () => {
    const ruta = join(carpetaTemporal(), 'v.json')
    const cola = new ColaVentas(ruta)

    // Un colmado con prisa: unas 300 ventas en ocho horas.
    const refs = Array.from({ length: 300 }, (_, i) => cola.encolar(venta(i)))
    expect(cola.pendientes).toBe(300)
    expect(new Set(refs).size).toBe(300)

    // Vuelve la luz y se sube por lotes de 50.
    const recargada = new ColaVentas(ruta)
    let subidas = 0
    while (recargada.pendientes > 0) {
      const lote = recargada.siguientes(50)
      recargada.confirmar(lote.map((v) => v.clientRef))
      subidas += lote.length
    }

    expect(subidas).toBe(300)
    expect(recargada.pendientes).toBe(0)
  })
})

describe('Lo que llega por IPC no se cree', () => {
  /**
   * El que llama es la app web cargada en la ventana: una pagina remota.
   * El tipo de TypeScript no existe en tiempo de ejecucion, asi que la
   * unica frontera de verdad es esta.
   */
  const buena = {
    soldAt: '2026-08-03T12:00:00.000Z',
    shiftId: 'turno-1',
    customerId: null,
    cart: [{ productId: 'p1', qty: 1 }],
    payments: [{ metodo: 'efectivo', monto: 100 }],
  }

  it('deja pasar una venta bien formada', () => {
    expect(validarVentaEntrante(buena)).toEqual(buena)
  })

  it('rechaza lo que ni siquiera es una venta', () => {
    for (const basura of [null, undefined, 'venta', 42, [], true]) {
      expect(validarVentaEntrante(basura)).toBeNull()
    }
  })

  it('exige la hora del cobro y el turno: sin eso el arqueo no cuadra', () => {
    expect(validarVentaEntrante({ ...buena, soldAt: '' })).toBeNull()
    expect(validarVentaEntrante({ ...buena, soldAt: 123 })).toBeNull()
    expect(validarVentaEntrante({ ...buena, shiftId: undefined })).toBeNull()
  })

  it('exige carrito y pagos, aunque su contenido lo valide el servidor', () => {
    expect(validarVentaEntrante({ ...buena, cart: undefined })).toBeNull()
    expect(validarVentaEntrante({ ...buena, payments: undefined })).toBeNull()
  })

  it('un clientRef que no sea texto no puede entrar: es la clave anti-duplicado', () => {
    expect(validarVentaEntrante({ ...buena, clientRef: { a: 1 } })).toBeNull()
    expect(validarVentaEntrante({ ...buena, clientRef: 'abc' })?.clientRef).toBe('abc')
  })

  it('el cliente va o con id o explicitamente en null, no a medias', () => {
    expect(validarVentaEntrante({ ...buena, customerId: 'c1' })?.customerId).toBe('c1')
    expect(validarVentaEntrante({ ...buena, customerId: undefined })).toBeNull()
  })

  it('no deja colar campos de mas hacia el archivo de la cola', () => {
    // `intentos` lo lleva la cola, no el navegador: si la pagina pudiera
    // mandarlo, podria esconder una venta trabada del contador.
    const limpia = validarVentaEntrante({ ...buena, intentos: 99, ultimoError: 'inventado' })
    expect(limpia).not.toBeNull()
    expect(Object.keys(limpia ?? {})).not.toContain('intentos')
    expect(Object.keys(limpia ?? {})).not.toContain('ultimoError')
  })

  it('la cola de verdad ignora tambien el intentos inventado', () => {
    const cola = new ColaVentas(join(carpetaTemporal(), 'v.json'))
    const limpia = validarVentaEntrante({ ...buena, intentos: 99 })
    expect(limpia).not.toBeNull()
    if (limpia === null) return
    cola.encolar(limpia)
    expect(cola.atascadas().length).toBe(0)
    expect(cola.siguientes()[0]?.intentos).toBe(0)
  })
})
