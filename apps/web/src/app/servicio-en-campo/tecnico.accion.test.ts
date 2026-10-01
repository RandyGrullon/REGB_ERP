import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { alternarPaso, asignarTecnico, crearOrden, transicionarOrden } from './actions'

/**
 * Servicio en campo, visto por el técnico (revisión del área de
 * operación, 30 sep):
 *
 *  - El rol de fábrica "Técnico de Campo" no podía abrir su pantalla
 *    (0155). Ahora la abre, y cada técnico trabaja SOLO sus órdenes: las
 *    acciones de ejecutar comprueban en el servidor que la orden sea suya.
 *  - Quién va a cada visita se asigna al crearla o después, y solo a
 *    alguien con acceso activo en el negocio.
 *
 * En modo demostración el usuario que actúa es siempre el demo
 * (…0001): "su" orden es la asignada a ese id.
 */

const YO = '00000000-0000-0000-0000-000000000001'
const OTRO = '00000000-0000-0000-0000-00000000c0de'

let c: ClientePrueba
let cliente: string

async function ordenNueva(tecnico: string | null): Promise<string> {
  const campos: Record<string, string> = {
    customerId: cliente,
    description: `Revisar nevera ${crypto.randomUUID().slice(0, 4)}`,
    scheduledAt: '2026-10-02T09:00',
  }
  if (tecnico) campos.technicianId = tecnico
  expect(await crearOrden(c.fd(campos, 'Despachador'))).toEqual({ ok: true })
  const [o] = await db()<{ id: string }[]>`
    select id from public.service_orders where tenant_id = ${c.tenantId}
    order by created_at desc limit 1`
  return o!.id
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-servicio',
    nombre: 'Refrigeración del Cibao SRL',
    modulos: ['field-service'],
    roles: {
      Despachador: { 'field-service.*': true },
      Técnico: {
        'field-service.view': true,
        'field-service.view.assigned': true,
        'field-service.execute': true,
      },
    },
  })
  const sql = db()
  const [cl] = await sql<{ id: string }[]>`
    insert into public.customers (tenant_id, name) values (${c.tenantId}, 'Supermercado La Económica')
    returning id`
  cliente = cl!.id
  // El demo y otro técnico, los dos con acceso activo al negocio.
  const [rol] = await sql<{ id: string }[]>`
    select id from public.roles where tenant_id = ${c.tenantId} and name = 'Técnico'`
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id, is_active)
    values (${c.tenantId}, ${YO}, ${rol!.id}, true), (${c.tenantId}, ${OTRO}, ${rol!.id}, true)`
})

afterAll(async () => {
  await c.limpiar(['public.service_checklist_items', 'public.service_orders', 'public.memberships'])
  await cerrarBase()
})

describe('asignar el técnico', () => {
  it('se asigna al crear la orden y queda guardado', async () => {
    const o = await ordenNueva(OTRO)
    const [x] = await db()<{ technician_id: string }[]>`
      select technician_id from public.service_orders where id = ${o}`
    expect(x!.technician_id).toBe(OTRO)
  })

  it('no se asigna a alguien sin acceso al negocio', async () => {
    const o = await ordenNueva(null)
    const r = await asignarTecnico(
      c.fd({ orderId: o, technicianId: '00000000-0000-0000-0000-00000000dead' }, 'Despachador'),
    )
    expect(r).toEqual({ ok: false, error: 'Ese técnico no tiene acceso activo en este negocio.' })
  })

  it('el técnico no reparte órdenes: eso es de quien gestiona', async () => {
    const o = await ordenNueva(null)
    const r = await asignarTecnico(c.fd({ orderId: o, technicianId: YO }, 'Técnico'))
    expect(r.ok).toBe(false)
  })
})

describe('cada técnico trabaja lo suyo', () => {
  it('marca los pasos y llega al sitio en SU orden', async () => {
    const o = await ordenNueva(YO)
    const sql = db()
    const [p] = await sql<{ id: string }[]>`
      insert into public.service_checklist_items (tenant_id, order_id, position, label, required)
      values (${c.tenantId}, ${o}, 0, 'Medir temperatura', true) returning id`
    expect(await alternarPaso(c.fd({ orderId: o, itemId: p!.id }, 'Técnico'))).toEqual({ ok: true })
    expect(
      await transicionarOrden(c.fd({ orderId: o, siguiente: 'in_progress' }, 'Técnico')),
    ).toEqual({ ok: true })
  })

  it('no toca la orden de otro técnico, aunque tenga el enlace', async () => {
    const o = await ordenNueva(OTRO)
    const sql = db()
    const [p] = await sql<{ id: string }[]>`
      insert into public.service_checklist_items (tenant_id, order_id, position, label, required)
      values (${c.tenantId}, ${o}, 0, 'Lavar serpentín', true) returning id`
    const r = await alternarPaso(c.fd({ orderId: o, itemId: p!.id }, 'Técnico'))
    expect(r).toEqual({ ok: false, error: 'Esa orden está asignada a otro técnico.' })
    const [x] = await sql<{ done: boolean }[]>`
      select done from public.service_checklist_items where id = ${p!.id}`
    expect(x!.done).toBe(false)
  })

  it('un paso de otra orden no se marca pasando el id de la propia', async () => {
    const mia = await ordenNueva(YO)
    const ajena = await ordenNueva(OTRO)
    const sql = db()
    const [p] = await sql<{ id: string }[]>`
      insert into public.service_checklist_items (tenant_id, order_id, position, label, required)
      values (${c.tenantId}, ${ajena}, 0, 'Cambiar capacitor', true) returning id`
    await alternarPaso(c.fd({ orderId: mia, itemId: p!.id }, 'Técnico'))
    const [x] = await sql<{ done: boolean }[]>`
      select done from public.service_checklist_items where id = ${p!.id}`
    expect(x!.done).toBe(false)
  })

  it('quien gestiona sí puede trabajar cualquier orden', async () => {
    const o = await ordenNueva(OTRO)
    expect(
      await transicionarOrden(c.fd({ orderId: o, siguiente: 'in_progress' }, 'Despachador')),
    ).toEqual({ ok: true })
  })
})
