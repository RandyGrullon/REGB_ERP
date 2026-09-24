import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { adjudicarRfq, crearRfq, invitarProveedor, registrarCotizacion } from './actions'

/**
 * Adjudicar un RFQ (cliente misterioso, 23 sep).
 *
 * El modulo promete "gana siempre el monto mas bajo -desempate por el
 * plazo mas corto-, nunca a criterio de quien compra". La pantalla ponia
 * la insignia "Mejor oferta", pero cada fila tenia su boton "Adjudicar" y
 * la accion aceptaba cualquier proveedor, aunque no hubiera cotizado. Se
 * adjudico a Materiales Del Este por RD$ 120,500.50 teniendo una oferta de
 * RD$ 118,000.00 en la misma pantalla.
 */

let c: ClientePrueba
let barato: string
let caro: string
let sinCotizar: string
let rfq: string

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-rfq',
    nombre: 'Compras Transparentes SRL',
    modulos: ['suppliers', 'rfq'],
    roles: { Comprador: { '*': true } },
  })
  const sql = db()
  const prov = async (name: string) => {
    const [s] = await sql<{ id: string }[]>`
      insert into public.suppliers (tenant_id, name) values (${c.tenantId}, ${name}) returning id`
    return s!.id
  }
  barato = await prov('Ferreteria Central Import SRL')
  caro = await prov('Materiales Del Este SRL')
  sinCotizar = await prov('Pinturas del Cibao SRL')

  expect(
    await crearRfq(c.fd({ title: 'Pintura blanca temporada', deadline: '2026-10-10' })),
  ).toEqual({
    ok: true,
  })
  const [r] = await sql<
    { id: string }[]
  >`select id from public.rfqs where tenant_id = ${c.tenantId}`
  rfq = r!.id
})

afterAll(async () => {
  const sql = db()
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`
    for (const t of ['rfq_quotes', 'rfq_invitations', 'rfqs', 'suppliers']) {
      await tx.unsafe(`delete from public.${t} where tenant_id = $1`, [c.tenantId])
    }
  })
  await c.limpiar()
  await cerrarBase()
})

describe('invitar y cotizar', () => {
  it('invitar dos veces al mismo proveedor es un error legible', async () => {
    expect(await invitarProveedor(c.fd({ rfqId: rfq, supplierId: barato }))).toEqual({ ok: true })
    expect(await invitarProveedor(c.fd({ rfqId: rfq, supplierId: barato }))).toEqual({
      ok: false,
      error: 'Ese proveedor ya esta invitado.',
    })
  })

  it('una segunda cotizacion del mismo proveedor es un error legible', async () => {
    expect(
      await registrarCotizacion(
        c.fd({ rfqId: rfq, supplierId: barato, totalAmount: '118000', leadTimeDays: '10' }),
      ),
    ).toEqual({ ok: true })
    expect(
      await registrarCotizacion(
        c.fd({ rfqId: rfq, supplierId: caro, totalAmount: '120,500.50', leadTimeDays: '5' }),
      ),
    ).toEqual({ ok: true })
    const r = await registrarCotizacion(
      c.fd({ rfqId: rfq, supplierId: barato, totalAmount: '100000', leadTimeDays: '1' }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ya cotizo/)
  })
})

describe('adjudicar', () => {
  it('no se adjudica a quien no cotizo', async () => {
    const r = await adjudicarRfq(c.fd({ rfqId: rfq, supplierId: sinCotizar }))
    expect(r).toEqual({ ok: false, error: 'Ese proveedor no cotizo en este RFQ.' })
  })

  it('no se adjudica a una oferta que no es la mejor, aunque entregue antes', async () => {
    const r = await adjudicarRfq(c.fd({ rfqId: rfq, supplierId: caro }))
    expect(r.ok).toBe(false)
    const [x] = await db()<{ status: string }[]>`select status from public.rfqs where id = ${rfq}`
    expect(x!.status).toBe('open')
  })

  it('la mejor oferta si se adjudica', async () => {
    expect(await adjudicarRfq(c.fd({ rfqId: rfq, supplierId: barato }))).toEqual({ ok: true })
    const [x] = await db()<{ status: string; awarded_supplier_id: string }[]>`
      select status, awarded_supplier_id from public.rfqs where id = ${rfq}`
    expect(x).toEqual({ status: 'awarded', awarded_supplier_id: barato })
  })
})
