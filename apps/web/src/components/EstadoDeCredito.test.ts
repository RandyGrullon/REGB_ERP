import { describe, expect, it } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EstadoDeCredito, type ResumenCredito } from './EstadoDeCredito'

/**
 * Grabando la demo (15 oct 2026), el pedido con "Crédito al día" enseñaba
 * una franja vacía con borde al pie de la tarjeta: el pedido le pasa
 * `{bloqueado && ...}{bloqueado && ...}`, y `[false, false]` contaba como
 * contenido.
 */

;(globalThis as { React?: typeof React }).React = React

const AL_DIA: ResumenCredito = {
  allowed: true,
  mensaje: null,
  creditLimit: 50000,
  exposure: 12000,
  available: 38000,
  oldestOverdueDays: 0,
  overdueBlockDays: 30,
}

/** Los separadores con borde arriba: el de las cifras y el del pie. */
const separadores = (html: string): number => html.match(/border-t /g)?.length ?? 0

describe('EstadoDeCredito', () => {
  it('con el crédito al día y children en false no pinta el pie vacío', () => {
    const html = renderToStaticMarkup(createElement(EstadoDeCredito, { s: AL_DIA }, false, false))
    expect(html).toContain('Crédito al día')
    expect(separadores(html)).toBe(1)
  })

  it('con contenido de verdad sí pinta el pie', () => {
    const html = renderToStaticMarkup(
      createElement(
        EstadoDeCredito,
        { s: { ...AL_DIA, allowed: false, mensaje: 'Tiene facturas vencidas.' } },
        false,
        createElement('p', null, 'Hace falta una excepción.'),
      ),
    )
    expect(html).toContain('Hace falta una excepción.')
    expect(separadores(html)).toBe(2)
  })
})
