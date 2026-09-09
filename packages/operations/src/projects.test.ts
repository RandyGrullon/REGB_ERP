import { describe, expect, it } from 'vitest'
import { puedeAvanzarPorDependencias, transicionValidaProyecto, transicionValidaTarea } from './projects.js'

describe('transicionValidaProyecto', () => {
  it('planificacion avanza a activo o cancelado', () => {
    expect(transicionValidaProyecto('planning', 'active')).toBe(true)
    expect(transicionValidaProyecto('planning', 'cancelled')).toBe(true)
  })

  it('activo puede pausarse, completarse o cancelarse', () => {
    expect(transicionValidaProyecto('active', 'on_hold')).toBe(true)
    expect(transicionValidaProyecto('active', 'completed')).toBe(true)
  })

  it('completado y cancelado son terminales', () => {
    expect(transicionValidaProyecto('completed', 'active')).toBe(false)
    expect(transicionValidaProyecto('cancelled', 'active')).toBe(false)
  })
})

describe('transicionValidaTarea', () => {
  it('pendiente avanza a en curso o bloqueada', () => {
    expect(transicionValidaTarea('todo', 'in_progress')).toBe(true)
  })

  it('hecha puede reabrirse a en curso -no es terminal-', () => {
    expect(transicionValidaTarea('done', 'in_progress')).toBe(true)
    expect(transicionValidaTarea('done', 'todo')).toBe(false)
  })
})

describe('puedeAvanzarPorDependencias', () => {
  it('deja pasar a bloqueada o pendiente sin importar las dependencias', () => {
    expect(puedeAvanzarPorDependencias(['todo', 'in_progress'], 'blocked')).toBe(true)
    expect(puedeAvanzarPorDependencias(['todo'], 'todo')).toBe(true)
  })

  it('bloquea avanzar a en curso si una dependencia no esta hecha', () => {
    expect(puedeAvanzarPorDependencias(['done', 'in_progress'], 'in_progress')).toBe(false)
  })

  it('permite avanzar a hecha solo si TODAS las dependencias estan hechas', () => {
    expect(puedeAvanzarPorDependencias(['done', 'done'], 'done')).toBe(true)
    expect(puedeAvanzarPorDependencias([], 'done')).toBe(true)
  })
})
