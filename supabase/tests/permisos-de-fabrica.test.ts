import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Los roles de fabrica que recibe un cliente NUEVO (0135), contra Postgres real.
 *
 * 0025 arreglo los roles del Cajero, el Vendedor y el Contador con un
 * `update ... where is_system`, que solo toco a los clientes que existian
 * ese dia. Todo cliente creado despues nacia de la plantilla vieja de 0006:
 * el Cajero no podia ver ni el ticket que acababa de cobrar. Estas pruebas
 * crean un cliente como lo crearia REGB Control -un insert en
 * `regb.tenants`- y miran con que roles nace.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
let tenant: string

async function permisos(rol: string): Promise<Record<string, unknown>> {
  const [r] = await sql<{ permissions: Record<string, unknown> }[]>`
    select permissions from public.roles where tenant_id = ${tenant} and name = ${rol}`
  expect(r, `el rol ${rol} deberia existir`).toBeDefined()
  return r!.permissions
}

beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`fabrica-${RUN}`}, 'Colmado Nuevo de Prueba SRL', 'pyme', 'active')
    returning id`
  tenant = t!.id
})

afterAll(async () => {
  await sql`delete from audit.log where tenant_id = ${tenant}`
  await sql`delete from regb.tenants where id = ${tenant}`
  await sql.end()
})

describe('Un cliente nuevo nace con los roles de fabrica completos', () => {
  it('el Cajero ve su caja y sus tickets, y puede descontar hasta su tope', async () => {
    const p = await permisos('Cajero')
    expect(p['pos.sell']).toBe(true)
    expect(p['pos.view']).toBe(true)
    expect(p['pos.report.view']).toBe(true)
    expect(p['pos.discount']).toBe(true)
    expect(p['pos.discount.max']).toBe(10)
    // Lo que 0006 le nego sigue negado.
    expect(p['pos.void']).toBe(false)
  })

  it('el Vendedor toma pedidos pero no descuenta (0025)', async () => {
    const p = await permisos('Vendedor')
    expect(p['sales-orders.confirm']).toBe(true)
    expect(p['ar.view']).toBe(true)
    expect(p['sales-orders.discount']).toBe(false)
  })

  it('el Almacenista puede recibir, transferir y contar: lo que dice su descripcion', async () => {
    const p = await permisos('Almacenista')
    for (const k of [
      'receipts.view',
      'receipts.receive',
      'transfers.view',
      'transfers.dispatch',
      'stock-counts.count',
      'barcode.scan',
      'lots-serials.view',
    ]) {
      expect(p[k], k).toBe(true)
    }
    // Y sigue sin ver precios de venta ni costos.
    expect(p['products.price.view']).toBe(false)
    expect(p['inventory.cost.view']).toBe(false)
  })

  it('el Comprador pide y recibe, pero aprobar sigue siendo de gerencia', async () => {
    const p = await permisos('Comprador')
    expect(p['requisitions.request']).toBe(true)
    expect(p['receipts.receive']).toBe(true)
    expect(p['purchase-orders.approve']).toBe(false)
  })

  it('el Contador ve la cartera completa (0025)', async () => {
    const p = await permisos('Contador')
    expect(p['ar.invoice.create']).toBe(true)
    expect(p['inventory.cost.view']).toBe(true)
    // Lo fiscal de la caja (0129): el 607 y los NCF de un colmado solo-pos.
    expect(p['pos.export']).toBe(true)
    expect(p['pos.ncf.manage']).toBe(true)
  })
})

describe('El Empleado entra a su portal', () => {
  it('tiene el permiso que /portal pide de verdad, no solo el `.own` que ninguna ruta mira', async () => {
    const p = await permisos('Empleado')
    expect(p['hr-portal.view']).toBe(true)
    expect(p['hr-portal.request-time-off']).toBe(true)
    // Y sigue sin ver la nomina de nadie por la puerta de RRHH.
    expect(p['payroll.view']).toBeUndefined()
  })
})

describe('Solo agrega: lo que el cliente configuro se respeta', () => {
  it('si el cliente le quito el descuento a su Cajero, volver a aplicar no se lo devuelve', async () => {
    await sql`
      update public.roles
      set permissions = permissions || '{"pos.discount": false, "pos.report.view": false}'::jsonb
      where tenant_id = ${tenant} and name = 'Cajero'`

    await sql`select regb.permisos_de_fabrica(${tenant})`

    const p = await permisos('Cajero')
    expect(p['pos.discount']).toBe(false)
    expect(p['pos.report.view']).toBe(false)
    expect(p['pos.view']).toBe(true)
  })

  it('un rol hecho por el cliente con el mismo nombre de otro tenant no se toca', async () => {
    const [otro] = await sql<{ id: string }[]>`
      insert into regb.tenants (slug, legal_name, tier, status)
      values (${`fabrica-otro-${RUN}`}, 'Otro Cliente SRL', 'pyme', 'active')
      returning id`
    try {
      await sql`
        update public.roles set permissions = '{"pos.sell": true}'::jsonb
        where tenant_id = ${otro!.id} and name = 'Cajero'`
      await sql`select regb.permisos_de_fabrica(${tenant})`
      const [r] = await sql<{ permissions: Record<string, unknown> }[]>`
        select permissions from public.roles where tenant_id = ${otro!.id} and name = 'Cajero'`
      expect(r!.permissions).toEqual({ 'pos.sell': true })
    } finally {
      await sql`delete from audit.log where tenant_id = ${otro!.id}`
      await sql`delete from regb.tenants where id = ${otro!.id}`
    }
  })
})
