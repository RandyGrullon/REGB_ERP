import { describe, expect, it } from 'vitest'
import {
  MAX_CANTIDAD,
  avanceDelConteo,
  leerCantidad,
  ordenarParaContar,
  type LineaConteo,
} from './conteo-movil.js'

const linea = (p: Partial<LineaConteo> = {}): LineaConteo => ({
  id: 'l1',
  sku: 'CEM-100',
  nombre: 'Cemento gris 42.5 kg',
  unidad: 'saco',
  contado: null,
  ...p,
})

describe('Cero es un resultado, no es "sin contar"', () => {
  it('cero se acepta', () => {
    // "No hay ninguno" es el resultado MAS valioso de un conteo.
    // Confundirlo con "todavia no lo conte" es como se pierden los
    // faltantes: la linea se queda pendiente para siempre.
    const r = leerCantidad('0')
    expect(r.ok).toBe(true)
    expect(r.ok && r.valor).toBe(0)
  })

  it('y una linea contada en cero cuenta como hecha', () => {
    const a = avanceDelConteo([linea({ contado: 0 }), linea({ id: 'l2' })])
    expect(a.hechas).toBe(1)
  })
})

describe('Lo que se teclea en un pasillo', () => {
  it('acepta la coma como decimal: es lo que teclea un dominicano', () => {
    const r = leerCantidad('2,5')
    expect(r.ok && r.valor).toBe(2.5)
  })

  it('acepta espacios de sobra', () => {
    expect(leerCantidad('  12  ').ok).toBe(true)
  })

  it('vacio no es cero', () => {
    const r = leerCantidad('')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.problema).toBe('vacio')
  })

  it('letras dan un mensaje, no un NaN guardado', () => {
    const r = leerCantidad('doce')
    expect(!r.ok && r.problema).toBe('no-numero')
  })

  it('negativo no se puede contar', () => {
    expect(leerCantidad('-3').ok).toBe(false)
  })

  it('un digito de mas se detiene antes de guardarse', () => {
    // Teclear 55 y que salga 5500000 pasa. Guardarlo genera un ajuste de
    // inventario enorme que despues hay que perseguir.
    const r = leerCantidad(String(MAX_CANTIDAD + 1))
    expect(!r.ok && r.problema).toBe('demasiado')
  })
})

describe('El orden de la lista', () => {
  it('lo que falta va primero', () => {
    const l = ordenarParaContar([
      linea({ id: 'a', nombre: 'Arena', contado: 5 }),
      linea({ id: 'b', nombre: 'Bloques', contado: null }),
    ])
    expect(l.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('dentro de cada grupo, por nombre', () => {
    const l = ordenarParaContar([
      linea({ id: 'z', nombre: 'Zinc', contado: null }),
      linea({ id: 'a', nombre: 'Arena', contado: null }),
    ])
    expect(l.map((x) => x.id)).toEqual(['a', 'z'])
  })

  it('no toca el arreglo original', () => {
    const orig = [linea({ id: 'a', contado: 1 }), linea({ id: 'b' })]
    ordenarParaContar(orig)
    expect(orig.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('El avance que ve quien cuenta', () => {
  it('dice cuantas van de cuantas', () => {
    const a = avanceDelConteo([linea({ contado: 3 }), linea({ id: '2' }), linea({ id: '3' })])
    expect(a.texto).toBe('1 de 3 contados')
    expect(a.fraccion).toBeCloseTo(1 / 3)
  })

  it('al terminar lo dice sin ambiguedad', () => {
    expect(avanceDelConteo([linea({ contado: 0 })]).texto).toMatch(/Listo/)
  })

  it('un conteo vacio no divide entre cero', () => {
    const a = avanceDelConteo([])
    expect(a.fraccion).toBe(0)
    expect(a.texto).toMatch(/no tiene productos/)
  })
})

describe('El que cuenta NO ve el sistema', () => {
  it('el tipo de una linea no tiene por donde traer la cantidad del sistema', () => {
    // Es una comprobacion de FORMA, y por eso vale: si alguien agrega
    // `system_qty` al tipo para "ayudar al que cuenta", esto se cae y
    // obliga a leer el comentario de por que no va.
    //
    // Un conteo que confirma lo que ya se sabia no encuentra nada, y
    // entonces cerrar el pasillo y pagar las horas no sirvio de nada.
    const claves = Object.keys(linea()).sort()
    expect(claves).toEqual(['contado', 'id', 'nombre', 'sku', 'unidad'])
  })
})
