import { describe, expect, it } from 'vitest'
import {
  COLA_VACIA,
  anotarFallo,
  bloquear,
  bloqueadas,
  confirmar,
  encolar,
  escribirCola,
  estadoDeCola,
  leerCola,
  porSubir,
  seEncola,
  type AccionPendiente,
  type ArchivoCola,
} from './cola-movil.js'

const accion = (p: Partial<AccionPendiente> = {}): AccionPendiente => ({
  ref: '11111111-1111-4111-8111-111111111111',
  accion: 'transferir',
  args: { p_origen: 'a', p_destino: 'b', p_producto: 'c', p_cantidad: 3 },
  creadaEn: '2026-09-14T10:00:00.000Z',
  resumen: '3 Cemento gris → Almacen Dos',
  intentos: 0,
  ...p,
})

const conAcciones = (...as: AccionPendiente[]): ArchivoCola => ({ version: 1, acciones: as })

describe('Lo unico que se encola es lo que la base nunca contesto', () => {
  it('un fallo sin codigo se encola: nadie del otro lado hablo', () => {
    expect(seEncola({ code: undefined })).toBe(true)
    expect(seEncola({})).toBe(true)
    expect(seEncola({ code: null })).toBe(true)
    expect(seEncola({ code: '' })).toBe(true)
  })

  it('un error CON codigo no se encola: es una respuesta, no un fallo', () => {
    // Reintentar "tu rol no permite transferir" mañana da exactamente lo
    // mismo. Encolarlo es esconderle al usuario un "no" que necesitaba
    // oir ahora, y dejar la app reintentando para siempre en silencio.
    expect(seEncola({ code: '42501' })).toBe(false) // sin permiso
    expect(seEncola({ code: '23514' })).toBe(false) // sin stock
    expect(seEncola({ code: '22023' })).toBe(false) // dato invalido
    expect(seEncola({ code: '28000' })).toBe(false) // sesion no valida
  })

  it('sin error no hay nada que encolar', () => {
    expect(seEncola(null)).toBe(false)
    expect(seEncola(undefined)).toBe(false)
  })
})

describe('Encolar', () => {
  it('la misma referencia no entra dos veces', () => {
    // La pantalla puede llamar a esto sin llevar la cuenta de si ya lo
    // hizo -y lo hace: un doble toque con la señal mala es normal-.
    const cola = encolar(encolar(COLA_VACIA, accion()), accion())
    expect(cola.acciones).toHaveLength(1)
  })

  it('no muta la cola que recibe', () => {
    const antes = COLA_VACIA
    encolar(antes, accion())
    expect(antes.acciones).toHaveLength(0)
  })
})

describe('El orden de subida es el orden en que ocurrieron', () => {
  it('lo mas viejo sube primero, aunque se haya encolado despues', () => {
    // No es estetico. Si alguien movio mercancia a un almacen y despues
    // conto ese almacen, subirlo al reves deja el conteo cuadrado contra
    // existencias que todavia no habian llegado.
    const nueva = accion({ ref: 'r-nueva', creadaEn: '2026-09-14T12:00:00.000Z' })
    const vieja = accion({ ref: 'r-vieja', creadaEn: '2026-09-14T08:00:00.000Z' })
    const orden = porSubir(conAcciones(nueva, vieja)).map((a) => a.ref)
    expect(orden).toEqual(['r-vieja', 'r-nueva'])
  })

  it('las bloqueadas no se reintentan: ya sabemos que no van a pasar', () => {
    const viva = accion({ ref: 'r-viva' })
    const trabada = accion({ ref: 'r-trabada', bloqueada: 'No hay suficiente' })
    expect(porSubir(conAcciones(viva, trabada)).map((a) => a.ref)).toEqual(['r-viva'])
  })

  it('pero siguen en la cola: describen algo que ya paso', () => {
    const cola = bloquear(conAcciones(accion()), accion().ref, 'No hay suficiente')
    expect(cola.acciones).toHaveLength(1)
    expect(bloqueadas(cola)).toHaveLength(1)
  })
})

describe('Nada se descarta por venir fallando', () => {
  it('cien intentos fallidos y la accion sigue ahi', () => {
    // Lo que hay dentro son cosas que pasaron en el mundo fisico: la
    // mercancia se movio, el comprobante esta en el bolsillo de alguien.
    // Tirarlo para que la app quede limpia es perderle el trabajo a una
    // persona.
    let cola = conAcciones(accion())
    for (let i = 0; i < 100; i += 1) cola = anotarFallo(cola, accion().ref, 'sin red')
    expect(cola.acciones).toHaveLength(1)
    expect(cola.acciones[0]!.intentos).toBe(100)
    expect(porSubir(cola)).toHaveLength(1)
  })

  it('solo sale de la cola cuando el servidor la confirma', () => {
    const cola = confirmar(conAcciones(accion(), accion({ ref: 'otra' })), [accion().ref])
    expect(cola.acciones.map((a) => a.ref)).toEqual(['otra'])
  })

  it('el mensaje largo de la base se recorta, no se pierde la accion', () => {
    const cola = anotarFallo(conAcciones(accion()), accion().ref, 'x'.repeat(900))
    expect(cola.acciones[0]!.ultimoError!.length).toBeLessThanOrEqual(301)
  })
})

describe('Lo que se enseña arriba', () => {
  it('una cola vacia no dice nada', () => {
    // Un indicador permanente de "todo bien" se vuelve invisible a los
    // dos dias, y entonces tampoco se ve cuando dice otra cosa.
    expect(estadoDeCola(COLA_VACIA).texto).toBeNull()
  })

  it('lo que espera se cuenta en singular y en plural', () => {
    expect(estadoDeCola(conAcciones(accion())).texto).toBe('1 sin subir')
    expect(estadoDeCola(conAcciones(accion(), accion({ ref: 'b' }))).texto).toBe('2 sin subir')
  })

  it('lo trabado manda sobre lo que solo espera', () => {
    // Si hay algo que necesita a una persona, eso es lo que tiene que
    // leerse; "3 sin subir" suena a que se arregla solo.
    const cola = conAcciones(accion(), accion({ ref: 'b', bloqueada: 'No hay suficiente' }))
    const e = estadoDeCola(cola)
    expect(e.texto).toBe('1 no se pudo guardar')
    expect(e.tono).toBe('peligro')
    expect(e.pendientes).toBe(1)
    expect(e.bloqueadas).toBe(1)
  })
})

describe('Lo guardado en el telefono', () => {
  it('ida y vuelta sin perder nada', () => {
    const cola = conAcciones(accion(), accion({ ref: 'b', intentos: 3, ultimoError: 'sin red' }))
    expect(leerCola(escribirCola(cola))).toEqual(cola)
  })

  it('un archivo ilegible devuelve la cola vacia en vez de reventar el arranque', () => {
    // Una app que no abre es peor que una app sin cola.
    expect(leerCola('{no es json')).toEqual(COLA_VACIA)
    expect(leerCola('null')).toEqual(COLA_VACIA)
    expect(leerCola('[]')).toEqual(COLA_VACIA)
    expect(leerCola('')).toEqual(COLA_VACIA)
    expect(leerCola(null)).toEqual(COLA_VACIA)
  })

  it('una entrada a medias se descarta y las buenas se salvan', () => {
    // Una entrada escrita mientras se cerraba la app atasca el subidor
    // para siempre y arrastra a las que venian detras. Es la unica
    // perdida que esta cola acepta, y es porque eso no se puede ni
    // intentar.
    const crudo = JSON.stringify({
      version: 1,
      acciones: [
        accion({ ref: 'buena' }),
        { ref: 'sin-accion', creadaEn: '2026-09-14T10:00:00.000Z', resumen: 'x', intentos: 0 },
        { ref: 'accion-inventada', accion: 'borrar_todo', args: {}, creadaEn: 'x', resumen: 'x', intentos: 0 },
        null,
      ],
    })
    expect(leerCola(crudo).acciones.map((a) => a.ref)).toEqual(['buena'])
  })
})
