import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { alternarSucursal, crearSucursal } from './actions'

/**
 * crearSucursal() llamada DE VERDAD: deja `branches.branch.created` en el
 * outbox, en la misma transaccion que la sucursal.
 */

let c: ClientePrueba
let empresa: string

async function eventos(tipo: string) {
  return db()<{ payload: Record<string, unknown>; emitted_by: string }[]>`
    select payload, emitted_by from public.event_outbox
    where tenant_id = ${c.tenantId} and type = ${tipo}
    order by id`
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-suc',
    nombre: 'Eventos Sucursales SRL',
    modulos: ['orgs', 'branches'],
    roles: { Administrador: { 'branches.*': true, 'orgs.*': true } },
  })
  const [e] = await db()<{ id: string }[]>`
    insert into public.companies (tenant_id, legal_name, currency, is_default)
    values (${c.tenantId}, 'Colmado Eventos SRL', 'DOP', true) returning id`
  empresa = e!.id
})

afterAll(async () => {
  await c.limpiar(['public.branches', 'public.companies'])
  await cerrarBase()
})

describe('crearSucursal emite branches.branch.created', () => {
  it('una sucursal nueva deja un solo evento, con su id y el de su empresa', async () => {
    const r = await crearSucursal(
      c.fd({
        nombre: 'Sucursal Santiago',
        codigo: 'STI',
        companyId: empresa,
        direccion: 'Calle del Sol 10',
      }),
    )
    expect(r).toEqual({ ok: true })

    const [suc] = await db()<{ id: string }[]>`
      select id from public.branches where tenant_id = ${c.tenantId} and code = 'STI'`
    expect(suc).toBeDefined()

    const ev = await eventos('branches.branch.created')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.emitted_by).toBe('branches')
    // Sin nombre ni direccion: el payload dice QUE paso, no copia la ficha.
    expect(ev[0]!.payload).toEqual({ branchId: suc!.id, companyId: empresa })
  })

  it('cerrar y reabrir no emite otra creacion', async () => {
    const [suc] = await db()<{ id: string }[]>`
      select id from public.branches where tenant_id = ${c.tenantId} and code = 'STI'`
    expect(await alternarSucursal(c.fd({ id: suc!.id }))).toEqual({ ok: true })
    expect(await alternarSucursal(c.fd({ id: suc!.id }))).toEqual({ ok: true })
    expect(await eventos('branches.branch.created')).toHaveLength(1)
  })
})
