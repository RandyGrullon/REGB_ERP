import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { calculateMonthly, type ActiveModuleInput } from '@regb/billing'
import { fromCents, roundBankers, toCents } from '@regb/core'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { loadClientDetail } from './control'
import { generateMonthlyInvoices } from './invoicing'

/**
 * La factura automatica de REGB Control, generada DE VERDAD (0128).
 *
 * Hasta 0128 cotizaba con `usage = 0` y sin impuesto (defi-v1 §2.1): base
 * + modulos - descuento, sin usuarios ni sucursales ni empresas extra, sin
 * storage y sin ITBIS. Tambien nacia vencida (due_at = inicio del periodo)
 * y nunca cobraba la instalacion de un modulo.
 *
 * El cliente sembrado es MEDIANO y pasa de todo lo incluido:
 *   28 usuarios activos (+1 inactivo)       incluidos 25 -> 3 x US$7
 *    7 sucursales activas (+1 inactiva, +1 borrada)  5 -> 2 x US$20
 *    4 empresas (+1 borrada)                          3 -> 1 x US$90
 *   ~102 GiB en archivos (+1 en la papelera)       100 -> 1 x US$0.40
 *    7 modulos standard activos                     5 incluidos -> 2 x US$69
 *   + 1 en prueba vigente (US$0) y 1 en prueba vencida (no existe)
 * y es de RD: ITBIS 18 %.
 *
 * Cada linea se compara contra `calculateMonthly` alimentado con esos
 * numeros escritos a mano -no con lo que calcula el codigo probado-.
 */

const STANDARD = ['inventory', 'pos', 'ar', 'ap', 'purchase-orders', 'sales-orders', 'price-lists']
const MARZO = new Date(2099, 2, 15)
const ABRIL = new Date(2099, 3, 15)
const GB2 = 2_147_483_647 // el maximo de `files.size_bytes` (integer)

let c: ClientePrueba

interface Linea {
  label: string
  detail: string | null
  amount: number
}

interface Factura {
  id: string
  subtotal: string
  discount: string
  tax: string
  total: string
  due_at: string
  lines: Linea[]
}

async function factura(periodo: string): Promise<Factura> {
  const [f] = await db()<Factura[]>`
    select id, subtotal::text, discount::text, tax::text, total::text, due_at::text, lines
    from regb.invoices where tenant_id = ${c.tenantId} and period_start = ${periodo}`
  if (!f) throw new Error(`no hay factura de ${periodo}`)
  return f
}

const linea = (f: Factura, label: string) => f.lines.find((l) => l.label === label)

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-factura',
    nombre: 'Distribuidora Factura Completa SRL',
    modulos: STANDARD,
    roles: { Owner: { '*': true } },
  })
  const sql = db()
  await sql`update regb.tenants set tier = 'mediano', country = 'DO' where id = ${c.tenantId}`

  // Una prueba vigente (se ve, US$0) y una vencida (no se ve ni se cotiza).
  await sql`
    insert into regb.tenant_modules (tenant_id, module_id, status, enabled, trial_ends_at)
    values (${c.tenantId}, 'quotes', 'trial', true, current_date + 30),
           (${c.tenantId}, 'crm', 'trial', true, current_date - 1)`

  const [rol] = await sql<{ id: string }[]>`
    select id from public.roles where tenant_id = ${c.tenantId} and name = 'Owner'`
  for (let i = 0; i < 29; i++) {
    await sql`
      insert into public.memberships (tenant_id, user_id, role_id, is_active)
      values (${c.tenantId}, ${crypto.randomUUID()}, ${rol!.id}, ${i < 28})`
  }

  const empresas: string[] = []
  for (let i = 0; i < 5; i++) {
    const [e] = await sql<{ id: string }[]>`
      insert into public.companies (tenant_id, legal_name, is_default, deleted_at)
      values (${c.tenantId}, ${`Empresa ${i + 1} SRL`}, ${i === 0},
              ${i === 4 ? new Date() : null})
      returning id`
    empresas.push(e!.id)
  }
  for (let i = 0; i < 9; i++) {
    await sql`
      insert into public.branches (tenant_id, company_id, name, is_active, deleted_at)
      values (${c.tenantId}, ${empresas[0]!}, ${`Sucursal ${i + 1}`}, ${i !== 7},
              ${i === 8 ? new Date() : null})`
  }

  // 51 x 2,147,483,647 B = 101.99 GiB -> 101 GB facturables (hacia abajo).
  for (let i = 0; i < 52; i++) {
    await sql`
      insert into public.files (tenant_id, name, size_bytes, deleted_at)
      values (${c.tenantId}, ${`respaldo-${i}.zip`}, ${GB2}, ${i === 51 ? new Date() : null})`
  }
})

afterAll(async () => {
  await c.limpiar([
    'regb.module_installation_charges',
    'regb.invoices',
    'public.files',
    'public.branches',
    'public.companies',
    'public.memberships',
  ])
  await cerrarBase()
})

const MODULOS: ActiveModuleInput[] = [
  ...STANDARD.map((moduleId) => ({ moduleId, category: 'standard' as const })),
  { moduleId: 'quotes', category: 'standard', trial: true },
]
const USO = { activeUsers: 28, branches: 7, companies: 4, storageGb: 101, transactions: 0 }

describe('La factura cobra la formula completa', () => {
  let esperada: ReturnType<typeof calculateMonthly>
  let delPanel: Awaited<ReturnType<typeof loadClientDetail>>

  beforeAll(async () => {
    // Lo que el panel dice que se va a facturar, ANTES de facturar.
    delPanel = await loadClientDetail(c.slug)
    const r = await generateMonthlyInvoices(MARZO, c.slug)
    expect(r.created).toHaveLength(1)

    esperada = calculateMonthly({
      tier: 'mediano',
      activeModules: MODULOS,
      usage: USO,
      taxRate: 0.18,
      // Instalacion de lo recien activado: 5 dentro de los incluidos, 2 a US$600.
      oneTimeCharges: [{ label: 'Instalacion de modulos', amountCents: toCents(1200) }],
    })
  })

  it('usuarios, sucursales, empresas y storage de mas, cada uno con su precio', async () => {
    const f = await factura('2099-03-01')
    expect(linea(f, 'Base mensual')?.amount).toBe(399)
    expect(linea(f, 'Modulos activos')).toMatchObject({
      amount: 138,
      detail: '2 de 7 facturables (5 incluidos en el tier)',
    })
    expect(linea(f, 'Modulos en prueba')?.amount).toBe(0)
    expect(linea(f, 'Usuarios extra')).toMatchObject({
      amount: 21,
      detail: '28 usuarios, 25 incluidos -> 3 x',
    })
    expect(linea(f, 'Sucursales extra')?.amount).toBe(40)
    expect(linea(f, 'Empresas extra')?.amount).toBe(90)
    expect(linea(f, 'Storage extra')).toMatchObject({
      amount: 0.4,
      detail: '101 GB, 100 GB incluido -> 1 GB',
    })
  })

  it('la instalacion de lo recien activado, una vez y sin descuento', async () => {
    const f = await factura('2099-03-01')
    expect(linea(f, 'Instalacion de modulos')?.amount).toBe(1200)
  })

  it('ITBIS 18 % sobre todo, porque el cliente es de RD', async () => {
    const f = await factura('2099-03-01')
    // (688.40 recurrente + 1,200 de instalacion) x 18 % = 339.91
    expect(linea(f, 'ITBIS')?.amount).toBe(339.91)
    expect(Number(f.subtotal)).toBe(1888.4)
    expect(Number(f.discount)).toBe(0)
    expect(Number(f.tax)).toBe(339.91)
    expect(Number(f.total)).toBe(2228.31)
  })

  it('linea por linea, es lo que dice calculateMonthly con esos numeros', async () => {
    const f = await factura('2099-03-01')
    const plano = esperada.lines.map((l) => [l.label, roundBankers(fromCents(l.amountCents), 2)])
    expect(f.lines.map((l) => [l.label, l.amount])).toEqual(plano)
    expect(Number(f.total)).toBe(esperada.total)
  })

  it('REGB Control ensenaba exactamente esta factura antes de emitirla', async () => {
    const f = await factura('2099-03-01')
    const panel = delPanel!.invoice
    expect(
      panel.lines.map((l) => ({
        label: l.label,
        detail: l.detail ?? null,
        amount: roundBankers(fromCents(l.amountCents), 2),
      })),
    ).toEqual(f.lines)
    expect(panel.total).toBe(Number(f.total))
    expect(delPanel!.usage).toEqual(USO)
    expect(delPanel!.taxRate).toBe(0.18)
  })

  it('no nace vencida: 15 dias desde que empieza su periodo o se emite', async () => {
    const f = await factura('2099-03-01')
    expect(f.due_at).toBe('2099-03-16')
  })
})

describe('La instalacion se cobra una vez', () => {
  it('cada modulo queda marcado con la factura que lo cobro', async () => {
    const f = await factura('2099-03-01')
    const cargos = await db()<{ module_id: string; amount: string; invoice_id: string }[]>`
      select module_id, amount::text, invoice_id::text from regb.module_installation_charges
      where tenant_id = ${c.tenantId} order by module_id`
    expect(cargos).toHaveLength(7)
    expect(cargos.every((x) => x.invoice_id === f.id)).toBe(true)
    expect(cargos.reduce((a, x) => a + Number(x.amount), 0)).toBe(1200)
    expect(cargos.filter((x) => Number(x.amount) === 600)).toHaveLength(2)
  })

  it('el mes siguiente ya no aparece: solo la mensualidad', async () => {
    const r = await generateMonthlyInvoices(ABRIL, c.slug)
    expect(r.created).toHaveLength(1)
    const f = await factura('2099-04-01')
    expect(linea(f, 'Instalacion de modulos')).toBeUndefined()
    // 688.40 + 18 % = 812.31
    expect(Number(f.total)).toBe(812.31)
  })
})

describe('Fuera de RD', () => {
  it('sin ITBIS: no se inventa una tasa para otro pais', async () => {
    await db()`update regb.tenants set country = 'US' where id = ${c.tenantId}`
    try {
      const d = await loadClientDetail(c.slug)
      expect(d!.taxRate).toBe(0)
      expect(d!.monthly.taxCents).toBe(0)
      expect(d!.monthly.lines.some((l) => l.label === 'ITBIS')).toBe(false)
      expect(d!.monthly.total).toBe(688.4)
    } finally {
      await db()`update regb.tenants set country = 'DO' where id = ${c.tenantId}`
    }
  })
})

describe('El MRR del panel', () => {
  it('va sin ITBIS: el impuesto es de la DGII, no ingreso de REGB', async () => {
    const d = await loadClientDetail(c.slug)
    expect(d!.client.monthlyTotal).toBe(812.31)
    expect(d!.client.monthlyNet).toBe(688.4)
  })
})
