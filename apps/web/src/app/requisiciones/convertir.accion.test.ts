import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { marcarConvertida } from './actions'

/**
 * Marcar convertida una requisición aprobada (revisión del área de
 * operación, 30 sep). La pantalla dice que lo aprobado "pasa a Compras
 * para convertirlo en orden", pero solo quien aprueba podía marcarla: el
 * comprador de fábrica, que es quien hace la orden, no veía el botón.
 * Ahora la marca quien aprueba o quien crea órdenes de compra; nadie más.
 */

let c: ClientePrueba
let empleado: string

async function requisicion(estado: 'approved' | 'pending'): Promise<string> {
  const [r] = await db()<{ id: string }[]>`
    insert into public.purchase_requisitions (tenant_id, employee_id, description, estimated_amount, status)
    values (${c.tenantId}, ${empleado}, 'Estantería para el almacén', 18500, ${estado})
    returning id`
  return r!.id
}

async function estado(id: string): Promise<{ status: string; po_reference: string | null }> {
  const [r] = await db()<{ status: string; po_reference: string | null }[]>`
    select status, po_reference from public.purchase_requisitions where id = ${id}`
  return r!
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-requisicion',
    nombre: 'Ferretería del Ozama SRL',
    modulos: ['requisitions', 'purchase-orders'],
    roles: {
      Comprador: {
        'requisitions.view': true,
        'requisitions.request': true,
        'purchase-orders.view': true,
        'purchase-orders.create': true,
      },
      Empleado: { 'requisitions.view': true, 'requisitions.request': true },
    },
  })
  const [e] = await db()<{ id: string }[]>`
    insert into public.employees (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${c.tenantId}, 'E-900', 'Rafael', 'Prueba', '2026-01-05', 'Almacenista', 32000)
    returning id`
  empleado = e!.id
})

afterAll(async () => {
  // Una requisición resuelta no se edita ni se borra (la base lo impide):
  // en modo réplica para limpiar el cliente de prueba.
  await db().begin(async (tx) => {
    await tx`set local session_replication_role = replica`
    for (const t of ['purchase_requisitions', 'employees']) {
      await tx.unsafe(`delete from public.${t} where tenant_id = $1`, [c.tenantId])
    }
  })
  await c.limpiar()
  await cerrarBase()
})

describe('marcar convertida', () => {
  it('el comprador la marca con el número de la orden', async () => {
    const id = await requisicion('approved')
    expect(
      await marcarConvertida(
        c.fd({ requisitionId: id, poReference: 'OC-2026-00077' }, 'Comprador'),
      ),
    ).toEqual({ ok: true })
    expect(await estado(id)).toEqual({ status: 'converted', po_reference: 'OC-2026-00077' })
  })

  it('quien solo pide requisiciones no puede marcarla', async () => {
    const id = await requisicion('approved')
    const r = await marcarConvertida(c.fd({ requisitionId: id }, 'Empleado'))
    expect(r.ok).toBe(false)
    expect((await estado(id)).status).toBe('approved')
  })

  it('una pendiente no se convierte: primero se aprueba', async () => {
    const id = await requisicion('pending')
    expect(await marcarConvertida(c.fd({ requisitionId: id }, 'Comprador'))).toEqual({
      ok: false,
      error: 'Solo una requisición aprobada se puede convertir.',
    })
  })
})
