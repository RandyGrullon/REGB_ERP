import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { crearEmpresa, editarEmpresa } from './actions'

/**
 * crearEmpresa() llamada DE VERDAD: deja `orgs.company.created` en el
 * outbox, en la misma transaccion que la empresa.
 *
 * El manifiesto de `orgs` lo declaraba desde F2 y ningun codigo lo
 * emitia: una automatizacion o un webhook sobre ese tema se guardaba y
 * no se disparaba nunca.
 */

let c: ClientePrueba

async function eventos(tipo: string) {
  return db()<{ payload: Record<string, unknown>; emitted_by: string }[]>`
    select payload, emitted_by from public.event_outbox
    where tenant_id = ${c.tenantId} and type = ${tipo}
    order by id`
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-orgs',
    nombre: 'Eventos Empresas SRL',
    modulos: ['orgs'],
    roles: { Administrador: { 'orgs.*': true } },
  })
})

afterAll(async () => {
  await c.limpiar(['public.companies'])
  await cerrarBase()
})

describe('crearEmpresa emite orgs.company.created', () => {
  it('una empresa nueva deja un solo evento, con su id y su moneda', async () => {
    const r = await crearEmpresa(
      c.fd({ legal: 'Ferreteria del Cibao SRL', rnc: '1-31-99999-1', currency: 'USD' }),
    )
    expect(r).toEqual({ ok: true })

    const [empresa] = await db()<{ id: string }[]>`
      select id from public.companies
      where tenant_id = ${c.tenantId} and legal_name = 'Ferreteria del Cibao SRL'`
    expect(empresa).toBeDefined()

    const ev = await eventos('orgs.company.created')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.emitted_by).toBe('orgs')
    // Payload minimo: ni razon social ni RNC viajan a un webhook.
    expect(ev[0]!.payload).toEqual({ companyId: empresa!.id, currency: 'USD' })
  })

  it('editar una empresa no la vuelve a "crear"', async () => {
    const [empresa] = await db()<{ id: string }[]>`
      select id from public.companies where tenant_id = ${c.tenantId} limit 1`
    const r = await editarEmpresa(
      c.fd({ id: empresa!.id, legal: 'Ferreteria del Cibao SAS', rnc: '' }),
    )
    expect(r).toEqual({ ok: true })
    expect(await eventos('orgs.company.created')).toHaveLength(1)
  })

  it('sin permiso no hay empresa ni evento', async () => {
    const sinPermiso = await sembrarCliente({
      prefijo: 'accion-orgs',
      modulos: ['orgs'],
      roles: { Consulta: { 'orgs.view': true } },
    })
    try {
      const r = await crearEmpresa(sinPermiso.fd({ legal: 'No Deberia Existir SRL' }))
      expect(r.ok).toBe(false)
      const [n] = await db()<{ c: string }[]>`
        select count(*)::text as c from public.event_outbox where tenant_id = ${sinPermiso.tenantId}`
      expect(n!.c).toBe('0')
    } finally {
      await sinPermiso.limpiar(['public.companies'])
    }
  })
})
