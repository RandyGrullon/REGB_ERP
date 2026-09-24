import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import {
  agregarLinea,
  alternarCuenta,
  contabilizarAsiento,
  crearAsiento,
  crearCuenta,
  crearCuentasPorDefecto,
} from './actions'
import { filasBalanza } from './consultas'

/**
 * El catalogo de cuentas contra el mapa de los asientos automaticos
 * (cliente misterioso, 23 sep):
 *
 *  - "Desactivar" una cuenta que el mapa usa (la Caja, el ITBIS por
 *    pagar) se dejaba sin decir nada, y desde ese momento cada venta o
 *    pago se quedaba reintentando en el despachador sin llegar al mayor.
 *  - Registrar una cuenta con un codigo que ya existe tumbaba la pantalla
 *    con la excepcion de la base en vez de decirlo.
 */

let c: ClientePrueba

async function cuenta(code: string): Promise<{ id: string; activa: boolean }> {
  const [a] = await db()<{ id: string; is_active: boolean }[]>`
    select id, is_active from public.accounts where tenant_id = ${c.tenantId} and code = ${code}`
  return { id: a!.id, activa: a!.is_active }
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-cuentas-mapa',
    nombre: 'Contabilidad del Mapa SRL',
    modulos: ['accounting'],
    roles: { Contador: { '*': true } },
  })
  expect(await crearCuentasPorDefecto(c.fd())).toEqual({ ok: true })
})

afterAll(async () => {
  const sql = db()
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`
    for (const t of [
      'journal_entry_lines',
      'journal_entries',
      'accounting_account_map',
      'accounts',
    ]) {
      await tx.unsafe(`delete from public.${t} where tenant_id = $1`, [c.tenantId])
    }
  })
  await c.limpiar()
  await cerrarBase()
})

describe('desactivar cuentas', () => {
  it('una cuenta que usa el mapa no se desactiva, y se dice cual uso moverla', async () => {
    const caja = await cuenta('1101')
    const r = await alternarCuenta(c.fd({ id: caja.id }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Caja \(efectivo\).*Mapa de cuentas/)
    expect((await cuenta('1101')).activa).toBe(true)
  })

  it('una cuenta que el mapa no usa se desactiva y se vuelve a activar', async () => {
    expect(
      await crearCuenta(c.fd({ code: '6205', name: 'Fletes pagados', type: 'expense' })),
    ).toEqual({
      ok: true,
    })
    const flete = await cuenta('6205')
    expect(await alternarCuenta(c.fd({ id: flete.id }))).toEqual({ ok: true })
    expect((await cuenta('6205')).activa).toBe(false)
    expect(await alternarCuenta(c.fd({ id: flete.id }))).toEqual({ ok: true })
    expect((await cuenta('6205')).activa).toBe(true)
  })
})

describe('balanza al dia', () => {
  it('con corte solo suma los asientos hasta esa fecha', async () => {
    const caja = await cuenta('1101')
    const ventas = await cuenta('4101')
    for (const [fecha, monto] of [
      ['2026-08-31', '1000'],
      ['2026-09-15', '250'],
    ] as const) {
      expect(
        await crearAsiento(c.fd({ description: `Venta del ${fecha}`, entryDate: fecha })),
      ).toEqual({ ok: true })
      const [e] = await db()<{ id: string }[]>`
        select id from public.journal_entries where tenant_id = ${c.tenantId} and entry_date = ${fecha}`
      await agregarLinea(c.fd({ entryId: e!.id, accountId: caja.id, lado: 'debit', amount: monto }))
      await agregarLinea(
        c.fd({ entryId: e!.id, accountId: ventas.id, lado: 'credit', amount: monto }),
      )
      expect(await contabilizarAsiento(c.fd({ entryId: e!.id }))).toEqual({ ok: true })
    }
    const saldoCaja = async (hasta?: string) => {
      const filas = await asUser(crypto.randomUUID(), c.tenantId, (tx) =>
        filasBalanza(tx, c.tenantId, hasta),
      )
      return filas.find((f) => f.accountCode === '1101')?.totalDebit ?? 0
    }
    expect(await saldoCaja()).toBe(1250)
    expect(await saldoCaja('2026-08-31')).toBe(1000)
  })

  it('una fecha de asiento mal escrita es un error legible', async () => {
    const r = await crearAsiento(c.fd({ description: 'Ajuste raro', entryDate: '31/08/2026' }))
    expect(r).toEqual({ ok: false, error: 'La fecha del asiento no es valida.' })
  })
})

describe('registrar cuentas', () => {
  it('un codigo repetido es un error legible, no una excepcion', async () => {
    const r = await crearCuenta(c.fd({ code: '1101', name: 'Caja chica', type: 'asset' }))
    expect(r).toEqual({ ok: false, error: 'Ya tienes una cuenta con el codigo 1101.' })
  })
})
