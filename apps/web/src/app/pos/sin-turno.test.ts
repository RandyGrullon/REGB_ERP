import { describe, expect, it } from 'vitest'
import { motivoSinTurno } from './sin-turno'

/**
 * Por que la caja no muestra "Abrir turno", dicho con la causa verdadera.
 *
 * Antes, sin almacen, /pos le decia al Owner "Tu rol no puede abrir la
 * caja. Pidele a un encargado": el dueño del negocio, con todos los
 * permisos, buscando a quien pedirle. La causa era otra -no habia
 * almacen- y el remedio estaba a un enlace.
 */

const base = {
  puedeAbrir: true,
  hayAlmacenes: false,
  tieneExistencias: true,
  puedeCrearAlmacen: true,
  qs: '?tenant=x&rol=Owner',
}

describe('motivoSinTurno', () => {
  it('con permiso y almacen no hay nada que explicar: se ve "Abrir turno"', () => {
    expect(motivoSinTurno({ ...base, hayAlmacenes: true })).toBeNull()
  })

  it('el Owner sin almacen no lee que su rol no puede: lee que falta el almacen, con el enlace', () => {
    const m = motivoSinTurno(base)!
    expect(m.titulo).toBe('Falta crear un almacen')
    expect(m.descripcion).not.toContain('Tu rol')
    expect(m.enlace).toEqual({
      href: '/inventory/warehouses?tenant=x&rol=Owner',
      texto: 'Crear un almacen',
    })
  })

  it('si no puede crear almacenes, se le dice a quien pedirselo, sin enlace a un 404', () => {
    const m = motivoSinTurno({ ...base, puedeCrearAlmacen: false })!
    expect(m.titulo).toBe('Falta crear un almacen')
    expect(m.descripcion).toContain('Existencias > Almacenes')
    expect(m.enlace).toBeNull()
  })

  it('sin el modulo de existencias, el almacen no se ve: se dice y se manda al marketplace', () => {
    const m = motivoSinTurno({ ...base, tieneExistencias: false })!
    expect(m.titulo).toBe('La caja necesita un almacen')
    expect(m.descripcion).toContain('Existencias')
    expect(m.enlace).toEqual({
      href: '/marketplace?tenant=x&rol=Owner',
      texto: 'Ver Existencias en el Marketplace',
    })
  })

  it('un rol que de verdad no puede abrir la caja sigue leyendo eso', () => {
    const m = motivoSinTurno({ ...base, puedeAbrir: false, hayAlmacenes: true })!
    expect(m.titulo).toBe('No hay turno abierto')
    expect(m.descripcion).toContain('Tu rol no puede abrir la caja')
    expect(m.enlace).toBeNull()
  })
})
