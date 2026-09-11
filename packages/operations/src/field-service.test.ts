import { describe, expect, it } from 'vitest'
import {
  avanceChecklist,
  costoRepuestos,
  diasOrdenAbierta,
  minutosEnSitio,
  motivoNoCierre,
  pasosObligatoriosPendientes,
  puedeCerrarOrden,
  transicionValidaOrden,
} from './field-service.js'

describe('transicionValidaOrden', () => {
  it('sigue el camino normal de una visita', () => {
    expect(transicionValidaOrden('draft', 'scheduled')).toBe(true)
    expect(transicionValidaOrden('scheduled', 'in_progress')).toBe(true)
    expect(transicionValidaOrden('in_progress', 'done')).toBe(true)
  })

  it('deja reprogramar una visita sin cancelarla', () => {
    expect(transicionValidaOrden('scheduled', 'scheduled')).toBe(true)
  })

  it('no deja saltarse la visita', () => {
    expect(transicionValidaOrden('draft', 'done')).toBe(false)
    expect(transicionValidaOrden('scheduled', 'done')).toBe(false)
  })

  it('done y cancelled son terminales', () => {
    expect(transicionValidaOrden('done', 'in_progress')).toBe(false)
    expect(transicionValidaOrden('cancelled', 'scheduled')).toBe(false)
  })
})

describe('pasosObligatoriosPendientes', () => {
  it('ignora los opcionales', () => {
    const pasos = [
      { required: true, done: true },
      { required: false, done: false },
      { required: false, done: false },
    ]
    expect(pasosObligatoriosPendientes(pasos)).toBe(0)
  })

  it('cuenta solo los obligatorios sin marcar', () => {
    const pasos = [
      { required: true, done: false },
      { required: true, done: false },
      { required: true, done: true },
    ]
    expect(pasosObligatoriosPendientes(pasos)).toBe(2)
  })

  it('un checklist vacio no tiene pendientes', () => {
    expect(pasosObligatoriosPendientes([])).toBe(0)
  })
})

describe('motivoNoCierre', () => {
  const completo = [
    { required: true, done: true },
    { required: false, done: false },
  ]

  it('dice cuantos pasos faltan, en singular y plural', () => {
    expect(motivoNoCierre([{ required: true, done: false }], 'Ana')).toContain('1 paso obligatorio')
    expect(
      motivoNoCierre(
        [
          { required: true, done: false },
          { required: true, done: false },
        ],
        'Ana',
      ),
    ).toContain('2 pasos obligatorios')
  })

  it('el checklist se reclama antes que la firma', () => {
    expect(motivoNoCierre([{ required: true, done: false }], null)).toContain('checklist')
  })

  it('reclama la firma cuando el checklist ya esta', () => {
    expect(motivoNoCierre(completo, null)).toContain('firma')
    expect(motivoNoCierre(completo, '   ')).toContain('firma')
  })

  it('con checklist completo y firma no hay motivo', () => {
    expect(motivoNoCierre(completo, 'Ana Rosario')).toBeNull()
    expect(puedeCerrarOrden(completo, 'Ana Rosario')).toBe(true)
  })
})

describe('costoRepuestos', () => {
  it('suma antes de redondear', () => {
    // tres piezas a 0.335 son 1.005 exactos: redondear cada una daria 1.02
    expect(
      costoRepuestos([
        { qty: 1, unitCost: 0.335 },
        { qty: 1, unitCost: 0.335 },
        { qty: 1, unitCost: 0.335 },
      ]),
    ).toBe(1.01)
  })

  it('sin repuestos, cero', () => {
    expect(costoRepuestos([])).toBe(0)
  })

  it('multiplica cantidad por costo', () => {
    expect(costoRepuestos([{ qty: 3, unitCost: 450 }])).toBe(1350)
  })
})

describe('minutosEnSitio', () => {
  const inicio = new Date('2026-09-10T09:00:00Z')

  it('devuelve null mientras la visita no termina', () => {
    expect(minutosEnSitio(inicio, null)).toBeNull()
  })

  it('cuenta los minutos reales', () => {
    expect(minutosEnSitio(inicio, new Date('2026-09-10T10:30:00Z'))).toBe(90)
  })

  it('nunca negativo si las horas vienen al reves', () => {
    expect(minutosEnSitio(inicio, new Date('2026-09-10T08:00:00Z'))).toBe(0)
  })
})

describe('helpers reutilizados', () => {
  it('diasOrdenAbierta es la misma resta de quality', () => {
    expect(diasOrdenAbierta(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-10T00:00:00Z'))).toBe(9)
  })

  it('avanceChecklist devuelve null sin pasos', () => {
    expect(avanceChecklist(0, 0)).toBeNull()
    expect(avanceChecklist(3, 4)).toBe(0.75)
  })
})
