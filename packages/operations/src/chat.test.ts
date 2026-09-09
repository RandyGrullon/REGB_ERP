import { describe, expect, it } from 'vitest'
import { formatearMencion } from './chat.js'

describe('formatearMencion', () => {
  it('quita espacios y antepone @', () => {
    expect(formatearMencion('Maria Rosario')).toBe('@MariaRosario')
  })

  it('recorta espacios sobrantes en los extremos', () => {
    expect(formatearMencion('  Juan Perez  ')).toBe('@JuanPerez')
  })
})
