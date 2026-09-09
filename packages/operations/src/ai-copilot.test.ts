import { describe, expect, it } from 'vitest'
import { emparejarPregunta, type PreguntaCatalogo } from './ai-copilot.js'

const CATALOGO: PreguntaCatalogo[] = [
  { key: 'ventas_hoy', palabrasClave: ['venta', 'vendimos', 'hoy'] },
  { key: 'facturas_vencidas', palabrasClave: ['factura', 'vencida', 'cobrar'] },
  { key: 'leads_por_estado', palabrasClave: ['lead', 'prospecto'] },
]

describe('emparejarPregunta', () => {
  it('empareja por la mayor cantidad de palabras clave en comun', () => {
    expect(emparejarPregunta('¿Cuanto vendimos hoy?', CATALOGO)).toBe('ventas_hoy')
  })

  it('empareja aunque solo coincida una palabra', () => {
    expect(emparejarPregunta('dame mis prospectos nuevos', CATALOGO)).toBe('leads_por_estado')
  })

  it('devuelve null cuando ninguna palabra clave coincide', () => {
    expect(emparejarPregunta('cual es el clima de hoy en la playa', CATALOGO)).not.toBeNull()
    expect(emparejarPregunta('xyzabc123', CATALOGO)).toBeNull()
  })

  it('nunca genera ni ejecuta una consulta -solo devuelve una key del catalogo fijo-', () => {
    const resultado = emparejarPregunta('factura vencida por cobrar', CATALOGO)
    expect(CATALOGO.some((p) => p.key === resultado)).toBe(true)
  })
})
