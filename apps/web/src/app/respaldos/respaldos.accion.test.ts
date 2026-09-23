import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, db } from '@/lib/db'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { crearRespaldo } from './actions'
import { GET as descargar } from './[id]/descargar/route'

/**
 * El respaldo del cliente, creado y DESCARGADO de verdad.
 *
 * El hallazgo que cierra (docs/modules/backup.md): el archivo traia seis
 * tablas maestras -empresas, sucursales, roles, equipo, productos y
 * configuracion- mientras el aviso le decia al cliente "eso es lo que
 * perderias: mas de una semana de ventas, compras y cobros". Con un
 * respaldo de hoy descargado, el cliente perdia igual todas sus ventas.
 *
 * Lo que se prueba es el ARCHIVO que se lleva el cliente -lo que sale de
 * la ruta de descarga-, no lo que quedo en la base: si la ruta pierde una
 * parte, el cliente la pierde con ella.
 */

const RUN = crypto.randomUUID().slice(0, 8)
const MODULOS = [
  'pos',
  'sales-orders',
  'ar',
  'inventory',
  'accounting',
  'purchase-orders',
  'ap',
  'api-webhooks',
  'employees',
  'payroll',
]

let a: ClientePrueba
let b: ClientePrueba

interface Archivo {
  formato: string
  version: number
  filas: number
  modulos: string[]
  tablas: Record<string, number>
  fuera: { tabla: string; modulos: string[]; motivo: string; detalle: string | null }[]
  omitido: { tabla: string; columna: string; motivo: string }[]
  no_incluye: string[]
  datos: Record<string, Record<string, unknown>[]>
}

/** Siembra un negocio minimo pero real: una venta de cada tipo, su asiento, su inventario. */
async function sembrarNegocio(tenantId: string, marca: string): Promise<void> {
  const sql = db()
  const [w] = await sql<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name)
    values (${tenantId}, ${`Almacen Central ${marca}`}) returning id`
  const [p] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name)
    values (${tenantId}, ${`ARROZ-${marca}`}, ${`Arroz Selecto 10 lb ${marca}`}) returning id`
  const [cu] = await sql<{ id: string }[]>`
    insert into public.customers (tenant_id, name)
    values (${tenantId}, ${`Colmado Dona Ana ${marca}`}) returning id`
  const [su] = await sql<{ id: string }[]>`
    insert into public.suppliers (tenant_id, name)
    values (${tenantId}, ${`Molinos del Cibao ${marca}`}) returning id`
  await sql`
    insert into public.inventory_movements (tenant_id, warehouse_id, product_id, movement_type, qty)
    values (${tenantId}, ${w!.id}, ${p!.id}, 'receipt', 25)`
  const [turno] = await sql<{ id: string }[]>`
    insert into public.pos_shifts (tenant_id, warehouse_id) values (${tenantId}, ${w!.id}) returning id`
  await sql`
    insert into public.pos_sales (tenant_id, shift_id, number)
    values (${tenantId}, ${turno!.id}, ${`T-${marca}`})`
  await sql`
    insert into public.customer_invoices (tenant_id, number, customer_id, due_date, total)
    values (${tenantId}, ${`F-${marca}`}, ${cu!.id}, current_date + 30, 1180)`
  await sql`
    insert into public.sales_orders (tenant_id, number, customer_id, warehouse_id)
    values (${tenantId}, ${`PV-${marca}`}, ${cu!.id}, ${w!.id})`
  await sql`
    insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id)
    values (${tenantId}, ${`OC-${marca}`}, ${su!.id}, ${w!.id})`
  const [cuenta] = await sql<{ id: string }[]>`
    insert into public.accounts (tenant_id, code, name, type)
    values (${tenantId}, '1101', 'Caja general', 'asset') returning id`
  const [asiento] = await sql<{ id: string }[]>`
    insert into public.journal_entries (tenant_id, number, description)
    values (${tenantId}, ${`AS-${marca}`}, 'Venta de contado') returning id`
  await sql`
    insert into public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit)
    values (${tenantId}, ${asiento!.id}, ${cuenta!.id}, 1180, 0)`
  await sql`
    insert into public.webhook_endpoints (tenant_id, url, event_types, secret)
    values (${tenantId}, ${`https://erp.${marca.toLowerCase()}.do/hook`},
            '{backup.snapshot.created}', ${`whsec_${marca}`})`
  await sql`
    insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
    values (${tenantId}, '2026-09-01', '2026-09-15', '2026-09-15')`
}

/**
 * Borra TODO lo del cliente. Varias tablas fiscales no dejan borrar por
 * diseno (0108), asi que se apagan los triggers solo en esta transaccion
 * -como consolidacion.accion.test.ts- y se barren todas las tablas con
 * tenant_id: la misma lista generica que usa el respaldo.
 */
async function barrer(c: ClientePrueba): Promise<void> {
  await db().begin(async (tx) => {
    await tx.unsafe('set local session_replication_role = replica')
    const tablas = await tx<{ tabla: string }[]>`
      select c.relname::text as tabla
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)`
    for (const { tabla } of tablas) {
      await tx.unsafe(`delete from public.${tabla} where tenant_id = $1`, [c.tenantId])
    }
  })
  await c.limpiar()
}

/** Crea un respaldo con la ACCION y devuelve su id (el mas reciente). */
async function crear(c: ClientePrueba, rol?: string): Promise<string | null> {
  tarro.delete(COOKIE_AVISO)
  await crearRespaldo(c.fd({}, rol))
  const [r] = await db()<{ id: string }[]>`
    select id from public.backups where tenant_id = ${c.tenantId}
    order by created_at desc, id limit 1`
  return r?.id ?? null
}

function aviso(): { tipo: string; texto: string } | null {
  const crudo = tarro.get(COOKIE_AVISO)?.value
  return crudo ? (JSON.parse(crudo) as { tipo: string; texto: string }) : null
}

/** Baja el archivo por la RUTA real, como lo haria el navegador. */
async function bajar(c: ClientePrueba, id: string, rol = 'Dueno'): Promise<Response> {
  const url = `http://localhost/respaldos/${id}/descargar?tenant=${c.slug}&rol=${encodeURIComponent(rol)}`
  return descargar(new Request(url), { params: Promise.resolve({ id }) })
}

async function bajarArchivo(c: ClientePrueba, id: string, rol = 'Dueno') {
  const res = await bajar(c, id, rol)
  expect(res.status).toBe(200)
  const texto = await res.text()
  return { texto, archivo: JSON.parse(texto) as Archivo }
}

const numeros = (filas: Record<string, unknown>[] | undefined) =>
  (filas ?? []).map((f) => f.number)

beforeAll(async () => {
  const roles = {
    Dueno: { '*': true },
    // Ve todo menos nomina: su respaldo no puede traer nomina.
    'Respaldo sin nomina': { 'backup.*': true, '*.view': true, 'payroll.view': false },
    // Puede bajar respaldos pero no ve la contabilidad.
    'Auditor sin contabilidad': {
      'backup.view': true,
      'backup.export': true,
      '*.view': true,
      'accounting.view': false,
    },
    // Solo ve lo suyo: un respaldo completo le daria lo de todos.
    'Vendedor propio': { 'backup.*': true, '*.view': true },
    // Sin NINGUNA mencion a contabilidad: ni concedida ni negada.
    'Respaldo de ventas': {
      'backup.*': true,
      'pos.view': true,
      'sales-orders.view': true,
      'ar.view': true,
    },
  }
  a = await sembrarCliente({
    prefijo: 'accion-resp',
    nombre: 'Colmado La Esperanza SRL',
    modulos: MODULOS,
    roles,
  })
  b = await sembrarCliente({
    prefijo: 'accion-resp',
    nombre: 'Distribuidora Caribe SRL',
    modulos: MODULOS,
    roles,
  })
  await db()`
    update public.roles set scope = '{"own_only": true}'::jsonb
    where tenant_id = ${a.tenantId} and name = 'Vendedor propio'`
  await sembrarNegocio(a.tenantId, `A${RUN}`)
  await sembrarNegocio(b.tenantId, `B${RUN}`)
})

afterAll(async () => {
  await barrer(a)
  await barrer(b)
  await cerrarBase()
})

describe('el archivo trae el negocio del cliente', () => {
  let id: string
  let texto: string
  let archivo: Archivo

  beforeAll(async () => {
    id = (await crear(a))!
    ;({ texto, archivo } = await bajarArchivo(a, id))
  })

  it('trae ventas del POS, pedidos, facturas, compras, inventario y asientos', () => {
    expect(archivo.formato).toBe('regb-respaldo')
    expect(archivo.version).toBe(2)
    expect(numeros(archivo.datos.pos_sales)).toEqual([`T-A${RUN}`])
    expect(numeros(archivo.datos.sales_orders)).toEqual([`PV-A${RUN}`])
    expect(numeros(archivo.datos.customer_invoices)).toEqual([`F-A${RUN}`])
    expect(numeros(archivo.datos.purchase_orders)).toEqual([`OC-A${RUN}`])
    expect(numeros(archivo.datos.journal_entries)).toEqual([`AS-A${RUN}`])
    expect(archivo.datos.journal_entry_lines).toHaveLength(1)
    expect(archivo.datos.inventory_movements).toHaveLength(1)
    expect(archivo.datos.stock_levels?.length).toBeGreaterThan(0)
    expect(archivo.datos.customers?.map((f) => f.name)).toEqual([`Colmado Dona Ana A${RUN}`])
    expect(archivo.datos.suppliers?.map((f) => f.name)).toEqual([`Molinos del Cibao A${RUN}`])
    expect(archivo.datos.products?.map((f) => f.sku)).toEqual([`ARROZ-A${RUN}`])
    expect(archivo.datos.payroll_periods).toHaveLength(1)
  })

  it('NO trae ni una fila de otro cliente', () => {
    expect(texto).not.toContain(`B${RUN}`)
    expect(texto).not.toContain(b.tenantId)
    expect(texto.toLowerCase()).not.toContain(`b${RUN}`.toLowerCase())
  })

  it('el indice dice exactamente lo que trae: cada tabla, con su numero de filas', () => {
    const enDatos = Object.fromEntries(
      Object.entries(archivo.datos).map(([t, filas]) => [t, filas.length]),
    )
    expect(archivo.tablas).toEqual(enDatos)
    const total = Object.values(enDatos).reduce((s, n) => s + n, 0)
    expect(archivo.filas).toBe(total)
  })

  it('dice lo que queda fuera y por que', () => {
    const porDiseno = archivo.fuera.filter((f) => f.motivo === 'por-diseno').map((f) => f.tabla)
    expect(porDiseno).toEqual(expect.arrayContaining(['backups', 'backup_parts', 'event_outbox']))
    for (const f of archivo.fuera) expect(archivo.datos[f.tabla]).toBeUndefined()
    expect(archivo.no_incluye.length).toBeGreaterThan(0)
  })

  it('las credenciales no salen: el secreto del webhook no esta en el archivo', () => {
    expect(texto).not.toContain(`whsec_A${RUN}`)
    const [hook] = archivo.datos.webhook_endpoints ?? []
    expect(hook?.url).toBe(`https://erp.a${RUN.toLowerCase()}.do/hook`)
    expect(hook).not.toHaveProperty('secret')
    expect(archivo.omitido).toContainEqual(
      expect.objectContaining({ tabla: 'webhook_endpoints', columna: 'secret' }),
    )
  })

  it('crear emite backup.snapshot.created con numeros, no con datos', async () => {
    const eventos = await db()<{ payload: { backup_id: string; filas: number } }[]>`
      select payload from public.event_outbox
      where tenant_id = ${a.tenantId} and type = 'backup.snapshot.created'
        and payload ->> 'backup_id' = ${id}`
    expect(eventos).toHaveLength(1)
    expect(eventos[0]!.payload.filas).toBe(archivo.filas)
  })

  it('bajarlo lo marca como salido UNA vez y emite backup.snapshot.downloaded una vez', async () => {
    const [m1] = await db()<{ downloaded_at: string | null }[]>`
      select downloaded_at::text from public.backups where id = ${id}`
    expect(m1!.downloaded_at).not.toBeNull()

    await bajarArchivo(a, id)
    const [m2] = await db()<{ downloaded_at: string | null }[]>`
      select downloaded_at::text from public.backups where id = ${id}`
    expect(m2!.downloaded_at).toBe(m1!.downloaded_at)

    const eventos = await db()`
      select 1 from public.event_outbox
      where tenant_id = ${a.tenantId} and type = 'backup.snapshot.downloaded'
        and payload ->> 'backup_id' = ${id}`
    expect(eventos).toHaveLength(1)
  })

  it('el otro cliente no puede bajarlo', async () => {
    const res = await bajar(b, id)
    expect(res.status).toBe(404)
  })
})

describe('lo que el rol o el modulo dejan fuera, el archivo lo dice', () => {
  it('con inventario apagado, sus tablas salen como modulo apagado', async () => {
    await a.modulo('inventory', false)
    try {
      const id = (await crear(a))!
      const { archivo } = await bajarArchivo(a, id)
      expect(archivo.datos.inventory_movements).toBeUndefined()
      expect(archivo.fuera).toContainEqual(
        expect.objectContaining({ tabla: 'inventory_movements', motivo: 'modulo-apagado' }),
      )
      // El resto del negocio sigue entrando.
      expect(archivo.datos.pos_sales).toHaveLength(1)
    } finally {
      await a.modulo('inventory', true)
    }
  })

  it('un rol sin nomina no se la lleva, y el archivo dice que falta por el rol', async () => {
    const id = (await crear(a, 'Respaldo sin nomina'))!
    const { archivo } = await bajarArchivo(a, id)
    expect(archivo.datos.payroll_periods).toBeUndefined()
    expect(archivo.modulos).not.toContain('payroll')
    expect(archivo.fuera).toContainEqual(
      expect.objectContaining({ tabla: 'payroll_periods', motivo: 'sin-permiso' }),
    )
    expect(archivo.datos.journal_entries).toHaveLength(1)
  })

  it('un rol que no tiene contabilidad ni la menciona tampoco se la lleva', async () => {
    const id = (await crear(a, 'Respaldo de ventas'))!
    const [r] = await db()<{ payload: Archivo }[]>`
      select payload from public.backups where id = ${id}`
    expect(r!.payload.tablas.pos_sales).toBe(1)
    expect(r!.payload.tablas.customer_invoices).toBe(1)
    expect(r!.payload.tablas.journal_entries).toBeUndefined()
    expect(r!.payload.fuera).toContainEqual(
      expect.objectContaining({ tabla: 'journal_entries', motivo: 'sin-permiso' }),
    )
    const partes = await db()`
      select 1 from public.backup_parts where backup_id = ${id} and tabla = 'journal_entries'`
    expect(partes).toHaveLength(0)
  })

  it('un rol que solo ve lo suyo no puede sacar un respaldo de toda la empresa', async () => {
    const contar = async () => {
      const [r] = await db()<{ n: number }[]>`
        select count(*)::int as n from public.backups where tenant_id = ${a.tenantId}`
      return r!.n
    }
    const antes = await contar()
    tarro.delete(COOKIE_AVISO)
    await crearRespaldo(a.fd({}, 'Vendedor propio'))
    expect(await contar()).toBe(antes)
    expect(aviso()?.tipo).toBe('error')
  })

  it('quien no ve la contabilidad no puede bajar un respaldo que la trae', async () => {
    const id = (await crear(a))!
    const res = await bajar(a, id, 'Auditor sin contabilidad')
    expect(res.status).toBe(403)
    const [m] = await db()<{ downloaded_at: string | null }[]>`
      select downloaded_at::text from public.backups where id = ${id}`
    expect(m!.downloaded_at).toBeNull()
  })
})

describe('un archivo grande sale por partes y se arma entero', () => {
  it('cinco productos en partes de dos se descargan como un solo arreglo', async () => {
    for (let i = 1; i <= 4; i++) {
      await db()`
        insert into public.products (tenant_id, sku, name)
        values (${a.tenantId}, ${`EXTRA-${i}-${RUN}`}, ${`Habichuelas rojas ${i}`})`
    }
    // Directo a la funcion, con partes de 2 filas: la accion usa el tamano
    // por defecto y no se puede forzar a partir sin sembrar miles de filas.
    const [r] = await asUser('00000000-0000-0000-0000-000000000001', a.tenantId, (tx) =>
      tx<{ id: string }[]>`select public.crear_respaldo(${MODULOS.concat(['products'])}::text[],
                                                       'manual', 2) as id`,
    )
    const [partes] = await db()<{ n: number }[]>`
      select count(*)::int as n from public.backup_parts
      where backup_id = ${r!.id} and tabla = 'products'`
    expect(partes!.n).toBe(3)

    const { archivo } = await bajarArchivo(a, r!.id)
    expect(archivo.datos.products).toHaveLength(5)
    expect(archivo.tablas.products).toBe(5)
  })
})
