import { describe, expect, it } from 'vitest'
import {
  DIAS_RESPALDO,
  evaluarAlertas,
  evaluarRespaldoLocal,
  resumenAlertas,
  type FotoSalud,
} from './alertas.js'

const AHORA = new Date('2026-09-21T09:00:00Z')

const haceDias = (d: number) => new Date(AHORA.getTime() - d * 86_400_000).toISOString()
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString()

const foto = (p: Partial<FotoSalud> = {}): FotoSalud => ({
  eventos: { pendientes: 0, fallidos: 0, muertos: 0 },
  ncfEnRiesgo: [],
  impersonacionesAbiertas: [],
  ...p,
})

describe('Sin nada que atender no se inventa una alerta', () => {
  it('una foto sana devuelve la lista vacia', () => {
    expect(evaluarAlertas(foto(), AHORA)).toEqual([])
  })

  it('y el resumen dice null, no "todo bien"', () => {
    // Un "todo bien" diario se vuelve invisible a la semana, y entonces
    // tampoco se ve el dia que cambia.
    expect(resumenAlertas([])).toBeNull()
  })
})

describe('Lo que impide facturar HOY es critico', () => {
  it('una secuencia agotada para el mostrador en seco', () => {
    const [a] = evaluarAlertas(
      foto({
        ncfEnRiesgo: [{ slug: 'colmado', tipo: 'B01', restantes: 0, motivo: 'agotada' }],
      }),
      AHORA,
    )
    expect(a!.severidad).toBe('critico')
    expect(a!.titulo).toMatch(/no puede facturar/)
    expect(a!.cliente).toBe('colmado')
  })

  it('una vencida tambien: la fecha manda aunque queden numeros', () => {
    const [a] = evaluarAlertas(
      foto({ ncfEnRiesgo: [{ slug: 'caribe', tipo: 'B02', restantes: 400, motivo: 'vencida' }] }),
      AHORA,
    )
    expect(a!.severidad).toBe('critico')
  })

  it('pero "por agotarse" es aviso: todavia se factura', () => {
    const [a] = evaluarAlertas(
      foto({
        ncfEnRiesgo: [{ slug: 'colmado', tipo: 'B01', restantes: 40, motivo: 'por agotarse' }],
      }),
      AHORA,
    )
    expect(a!.severidad).toBe('aviso')
    expect(a!.titulo).toMatch(/le quedan 40/)
  })
})

describe('El respaldo de desastre, que es el que importa el dia malo', () => {
  /**
   * Va aparte de la foto de la base a proposito. La primera version
   * contaba filas de `public.backups` -las exportaciones que el cliente
   * se hace desde la app- y en la primera corrida real dio "4 criticas,
   * ningun cliente tiene respaldo" con los respaldos hechos y en disco.
   *
   * Una alerta roja todos los dias se deja de leer en una semana, y con
   * ella se van las de verdad. Por eso esto mira el archivo.
   */
  it('no tener ninguno es critico', () => {
    const a = evaluarRespaldoLocal(null, AHORA)
    expect(a?.severidad).toBe('critico')
    expect(a?.titulo).toMatch(/NI UN respaldo/)
  })

  it('uno de ayer no es alerta', () => {
    expect(evaluarRespaldoLocal(new Date(haceDias(1)), AHORA)).toBeNull()
  })

  it('pasado el limite es critico y dice cuantos dias lleva', () => {
    const a = evaluarRespaldoLocal(new Date(haceDias(23)), AHORA)
    expect(a?.severidad).toBe('critico')
    expect(a?.titulo).toMatch(/23 dias/)
  })

  it('justo en el limite todavia no, y un dia despues si', () => {
    // El borde importa: una alerta que salta un dia antes de tiempo se
    // aprende a ignorar, y entonces no sirve cuando es de verdad.
    expect(evaluarRespaldoLocal(new Date(haceDias(DIAS_RESPALDO)), AHORA)).toBeNull()
    expect(evaluarRespaldoLocal(new Date(haceDias(DIAS_RESPALDO + 1)), AHORA)).not.toBeNull()
  })

  it('la accion no dice "hazlo" sino "hazlo y mira por que no se hacia"', () => {
    // Que FALLE el respaldo es mas probable que que nadie lo corra.
    expect(evaluarRespaldoLocal(new Date(haceDias(30)), AHORA)?.accion).toMatch(/Si falla/)
  })
})

describe('El bus de eventos', () => {
  it('un evento descartado es una consecuencia que NO ocurrio', () => {
    const [a] = evaluarAlertas(foto({ eventos: { pendientes: 3, fallidos: 1, muertos: 2 } }), AHORA)
    expect(a!.severidad).toBe('critico')
    expect(a!.clave).toBe('eventos:muertos')
  })

  it('una cola con pendientes normales no alerta: es una cola', () => {
    expect(evaluarAlertas(foto({ eventos: { pendientes: 12, fallidos: 0, muertos: 0 } }), AHORA))
      .toEqual([])
  })

  it('pero si se acumulan, el despachador no esta corriendo', () => {
    const [a] = evaluarAlertas(
      foto({ eventos: { pendientes: 400, fallidos: 0, muertos: 0 } }),
      AHORA,
    )
    expect(a!.clave).toBe('eventos:atascados')
    expect(a!.severidad).toBe('aviso')
  })
})

describe('Impersonaciones que quedaron abiertas', () => {
  it('una recien abierta no alerta: alguien esta trabajando', () => {
    expect(
      evaluarAlertas(
        foto({ impersonacionesAbiertas: [{ tenant: 'colmado', desde: haceHoras(1) }] }),
        AHORA,
      ),
    ).toEqual([])
  })

  it('una de horas es un registro sin cerrar, no una sesion viva', () => {
    // La sesion caduca sola a los 60 min, asi que no hay nadie dentro.
    const [a] = evaluarAlertas(
      foto({ impersonacionesAbiertas: [{ tenant: 'caribe', desde: haceHoras(9) }] }),
      AHORA,
    )
    expect(a!.clave).toBe('impersonacion:caribe')
    expect(a!.titulo).toMatch(/9 h/)
  })
})

describe('El orden y el resumen', () => {
  it('lo critico va primero, siempre', () => {
    const as = evaluarAlertas(
      foto({
        ncfEnRiesgo: [{ slug: 'a', tipo: 'B01', restantes: 40, motivo: 'por agotarse' }],
        eventos: { pendientes: 0, fallidos: 0, muertos: 1 },
      }),
      AHORA,
    )
    expect(as.map((a) => a.severidad)).toEqual(['critico', 'aviso'])
  })

  it('el resumen se lee de reojo', () => {
    const as = evaluarAlertas(
      foto({
        ncfEnRiesgo: [
          { slug: 'a', tipo: 'B01', restantes: 0, motivo: 'agotada' },
          { slug: 'b', tipo: 'B02', restantes: 0, motivo: 'vencida' },
        ],
        eventos: { pendientes: 400, fallidos: 0, muertos: 0 },
      }),
      AHORA,
    )
    expect(resumenAlertas(as)).toBe('2 criticas y 1 aviso')
  })

  it('en singular cuando es una sola', () => {
    const as = evaluarAlertas(foto({ eventos: { pendientes: 0, fallidos: 0, muertos: 3 } }), AHORA)
    expect(resumenAlertas(as)).toBe('1 critica')
  })

  it('toda alerta dice que HACER: una sin salida es ruido', () => {
    const as = evaluarAlertas(
      foto({
        ncfEnRiesgo: [
          { slug: 'b', tipo: 'B01', restantes: 0, motivo: 'agotada' },
          { slug: 'd', tipo: 'B02', restantes: 20, motivo: 'por agotarse' },
        ],
        eventos: { pendientes: 400, fallidos: 0, muertos: 1 },
        impersonacionesAbiertas: [{ tenant: 'c', desde: haceHoras(5) }],
      }),
      AHORA,
    )
    expect(as).toHaveLength(5)
    for (const a of as) expect(a.accion.length).toBeGreaterThan(10)
  })

  it('y las claves son estables y unicas, para poder silenciar una sola', () => {
    const as = evaluarAlertas(
      foto({
        ncfEnRiesgo: [
          { slug: 'a', tipo: 'B01', restantes: 0, motivo: 'agotada' },
          { slug: 'b', tipo: 'B02', restantes: 0, motivo: 'agotada' },
        ],
      }),
      AHORA,
    )
    expect(new Set(as.map((a) => a.clave)).size).toBe(as.length)
  })
})
