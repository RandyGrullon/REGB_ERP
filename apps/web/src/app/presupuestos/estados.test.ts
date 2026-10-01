import { describe, expect, it } from 'vitest'
import { estadoGasto, estadoIngreso } from './estados'

/**
 * Cómo se lee una fila de presupuesto. Antes todas se leían como gasto:
 * vender más de lo planeado salía "Sobrepasado" en rojo, y un mes que
 * todavía no llegaba salía "Bien" o "Por debajo".
 */
describe('estadoIngreso', () => {
  it('pasarse de la meta es buena noticia', () => {
    expect(estadoIngreso(8000, 26185, false)).toEqual({ label: 'Meta cumplida', tone: 'success' })
  })

  it('quedarse corto en un mes que ya pasó se marca', () => {
    expect(estadoIngreso(25000, 0, false).label).toBe('Por debajo de la meta')
    expect(estadoIngreso(10000, 9500, false).label).toBe('Cerca de la meta')
  })

  it('un mes que no ha llegado está por venir, no por debajo', () => {
    expect(estadoIngreso(15000, 0, true)).toEqual({ label: 'Por venir', tone: 'neutral' })
  })

  it('un ingreso sin meta no es una alerta', () => {
    expect(estadoIngreso(0, 500, false)).toEqual({ label: 'Sin meta', tone: 'neutral' })
  })
})

describe('estadoGasto', () => {
  it('un gasto sin plan se dice así', () => {
    expect(estadoGasto(0, 12400, 'over')).toEqual({ label: 'Sin presupuesto', tone: 'danger' })
  })

  it('usa el semáforo de siempre cuando hubo plan', () => {
    expect(estadoGasto(5000, 6803.5, 'over').label).toBe('Sobrepasado')
    expect(estadoGasto(9000, 8000, 'ok').label).toBe('Bien')
  })

  it('un mes futuro sin gasto está por venir', () => {
    expect(estadoGasto(9000, 0, 'ok', true)).toEqual({ label: 'Por venir', tone: 'neutral' })
  })
})
