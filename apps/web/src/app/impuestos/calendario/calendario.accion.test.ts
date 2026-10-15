import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { registrarInformativo, registrarInformativoForm } from './actions'

/**
 * registrarInformativo() llamada DE VERDAD, contra la base de pruebas.
 *
 * Grabando la demo (15 oct 2026) "Ya lo presenté" fallaba con "permission
 * denied for table tax_filings": la accion hacia el INSERT directo que la
 * 0116 le revoco a `authenticated`. Ninguna prueba llamaba a la accion, y
 * `tsc` no ve permisos de la base. Ahora pasa por registrar_declaracion(),
 * la misma puerta que el cierre del IT-1.
 */

const TABLAS = ['public.tax_filings']

const CONTADOR = { 'taxes.*': true }
const AUXILIAR = { 'taxes.*': true, 'taxes.filing.close': false }

/** El usuario del modo demostración (bootstrap.ts). */
const YO = '00000000-0000-0000-0000-000000000001'

interface Fila {
  status: string
  due_date: string
  filed_by: string | null
  filed: boolean
  amount_due: string
  credit_forward: string
}

async function filas(tenantId: string, form: string, period: string): Promise<Fila[]> {
  return db()<Fila[]>`
    select status, due_date::text, filed_by::text, filed_at is not null as filed,
           amount_due::text, credit_forward::text
    from public.tax_filings
    where tenant_id = ${tenantId} and form = ${form} and period = ${period}`
}

let c: ClientePrueba

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-calendario',
    modulos: ['taxes'],
    roles: { Contador: CONTADOR, Auxiliar: AUXILIAR },
  })
})

afterAll(async () => {
  await c.limpiar(TABLAS)
  await cerrarBase()
})

describe('Ya lo presenté', () => {
  it('anota el 606 como presentado, sin montos y con quien lo anotó', async () => {
    expect(await registrarInformativo(c.fd({ form: '606', period: '202409' }))).toEqual({
      ok: true,
    })
    const [f, ...resto] = await filas(c.tenantId, '606', '202409')
    expect(resto).toHaveLength(0)
    // El 606 de septiembre vence el 15 de octubre.
    expect(f).toEqual({
      status: 'filed',
      due_date: '2024-10-15',
      filed_by: YO,
      filed: true,
      amount_due: '0.00',
      credit_forward: '0.00',
    })
  })

  it('anotarlo otra vez no falla ni duplica', async () => {
    expect(await registrarInformativo(c.fd({ form: '606', period: '202409' }))).toEqual({
      ok: true,
    })
    expect(await filas(c.tenantId, '606', '202409')).toHaveLength(1)
  })

  it('el IT-1 no se anota aquí: se cierra en la liquidación', async () => {
    const r = await registrarInformativo(c.fd({ form: 'IT-1', period: '202409' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/pantalla de liquidación/)
    expect(await filas(c.tenantId, 'IT-1', '202409')).toHaveLength(0)
  })

  it('un rol sin taxes.filing.close no lo anota', async () => {
    const r = await registrarInformativo(c.fd({ form: '607', period: '202409' }, 'Auxiliar'))
    expect(r.ok).toBe(false)
    expect(await filas(c.tenantId, '607', '202409')).toHaveLength(0)
  })

  it('la version de formulario deja el aviso de listo', async () => {
    tarro.delete(COOKIE_AVISO)
    await registrarInformativoForm(c.fd({ form: 'IR-17', period: '202409' }))
    const aviso = JSON.parse(tarro.get(COOKIE_AVISO)?.value ?? '{}') as {
      tipo?: string
      texto?: string
    }
    expect(aviso).toEqual({ tipo: 'ok', texto: 'Listo, lo anotamos como presentado.' })
    expect(await filas(c.tenantId, 'IR-17', '202409')).toHaveLength(1)
  })
})
