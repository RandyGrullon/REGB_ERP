import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { loadClientDetail } from './control'
import {
  generateMonthlyInvoices,
  listInvoices,
  previewMonthlyInvoices,
  resumenDeCorrida,
} from './invoicing'

/**
 * La corrida de facturas vista por el proveedor.
 *
 *  - La vista previa dice, cliente por cliente, lo MISMO que despues se
 *    emite (antes "Generar facturas del mes" emitia a ciegas).
 *  - La linea de instalacion habla en nombres, no en identificadores.
 *  - La ficha puede ensenar el desglose guardado de cada factura.
 *  - El aviso dice cuantas se emitieron (antes siempre el generico).
 */

const JUNIO = new Date(2099, 5, 10)
let c: ClientePrueba

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-corrida',
    nombre: 'Ferreteria Corrida SRL',
    modulos: ['pos', 'ar', 'sales-orders'],
    roles: { Owner: { '*': true } },
  })
  await db()`update regb.tenants set country = 'DO' where id = ${c.tenantId}`
})

afterAll(async () => {
  await c.limpiar(['regb.module_installation_charges', 'regb.invoices'])
  await cerrarBase()
})

describe('vista previa y emision', () => {
  it('la vista previa anuncia el total que despues se emite, con ITBIS e instalacion', async () => {
    const { rows } = await previewMonthlyInvoices(JUNIO)
    const fila = rows.find((r) => r.slug === c.slug)
    expect(fila?.skip).toBeNull()
    expect(fila?.installation).toBe(450) // 3 estandar PYME a US$150, ninguno incluido
    expect(fila?.tax).toBeGreaterThan(0)

    const r = await generateMonthlyInvoices(JUNIO, c.slug)
    expect(r.created).toHaveLength(1)
    expect(r.created[0]?.total).toBe(fila?.total)
  })

  it('la linea de instalacion nombra los modulos, no sus identificadores', async () => {
    const [f] = await listInvoices(c.slug)
    const inst = f?.lines.find((l) => l.label === 'Instalación de módulos')
    expect(inst?.amount).toBe(450)
    expect(inst?.detail).toContain('Punto de venta')
    expect(inst?.detail).toContain('Cuentas por cobrar')
    expect(inst?.detail).not.toMatch(/\bpos\b|sales-orders/)
    expect(f?.lines.find((l) => l.label === 'Base mensual')?.detail).toBe('Plan Pyme')
  })

  it('despues de emitir, la vista previa ya no la cuenta y la ficha la lista', async () => {
    const { rows } = await previewMonthlyInvoices(JUNIO)
    const fila = rows.find((r) => r.slug === c.slug)
    expect(fila?.total).toBeNull()
    expect(fila?.skip).toMatch(/^ya tiene la REGB-/)

    // La instalacion ya se cobro: la proxima factura no la vuelve a traer.
    const ficha = await loadClientDetail(c.slug)
    expect(ficha?.pendingInstall).toEqual([])
  })

  it('el aviso cuenta lo que paso de verdad', () => {
    expect(
      resumenDeCorrida({
        created: [{ tenant: 'A' }, { tenant: 'B' }],
        skipped: [{ tenant: 'C', reason: 'ya existe REGB-1' }],
      }),
    ).toBe('Listo, emitimos 2 facturas: 1 cliente ya tenía la de este mes.')
    expect(
      resumenDeCorrida({
        created: [],
        skipped: [
          { tenant: 'C', reason: 'ya existe REGB-1' },
          { tenant: 'D', reason: 'en prueba: no factura' },
        ],
      }),
    ).toBe(
      'No emitimos ninguna factura nueva: 1 cliente ya tenía la de este mes y 1 no factura por su estado.',
    )
  })
})
