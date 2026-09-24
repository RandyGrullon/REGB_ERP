import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { solicitarActivacion } from './actions'

/**
 * Pedir modulos le sube la factura al dueño: no lo decide cualquier rol.
 *
 * Antes `solicitarActivacion` no llamaba a `exigir()`: un Cajero que
 * llegara al marketplace (o que llamara la accion directo, que es un
 * endpoint) podia abrir una solicitud a nombre de la empresa. Ocultar el
 * boton no basta (§8.3); aqui se prueba la accion misma.
 *
 *  - Owner (`*`) pide y queda la solicitud con la cotizacion del motor.
 *  - Cajero (sin `subscription.manage`) recibe el motivo en palabras y no
 *    se guarda nada.
 *  - Admin de fabrica (`*` pero `subscription.manage: false`, 0006) igual:
 *    la denegacion explicita gana sobre el comodin.
 */

let c: ClientePrueba

const filas = async () =>
  db()<{ modules: string[]; quoted_monthly: string }[]>`
    select modules, quoted_monthly::text from regb.activation_requests
    where tenant_id = ${c.tenantId}`

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-solicitar',
    modulos: ['pos'],
    roles: {
      Owner: { '*': true },
      Cajero: { 'pos.sale.create': true, 'marketplace.view': true },
      Admin: { '*': true, 'subscription.manage': false },
    },
  })
})

afterAll(async () => {
  await c.limpiar(['regb.activation_requests'])
  await cerrarBase()
})

describe('solicitarActivacion: solo quien paga pide', () => {
  it('un Cajero no puede pedir modulos y no queda ninguna solicitud', async () => {
    const r = await solicitarActivacion(c.fd({ modulos: JSON.stringify(['ar']) }, 'Cajero'))
    expect(r).toEqual({
      ok: false,
      error: 'Solo el dueño de la cuenta puede pedir módulos: pídeselo a él.',
    })
    expect(await filas()).toHaveLength(0)
  })

  it('el Admin de fabrica tampoco: tiene la facturacion de REGB negada', async () => {
    const r = await solicitarActivacion(c.fd({ modulos: JSON.stringify(['ar']) }, 'Admin'))
    expect(r.ok).toBe(false)
    expect(await filas()).toHaveLength(0)
  })

  it('el Owner pide y queda la solicitud con la cotizacion del motor', async () => {
    const r = await solicitarActivacion(c.fd({ modulos: JSON.stringify(['ar']) }, 'Owner'))
    expect(r).toEqual({ ok: true })
    const [f] = await filas()
    expect(f?.modules).toContain('ar') // registry:allow — dato de la prueba
    expect(Number(f?.quoted_monthly)).toBeGreaterThan(0)
  })
})
