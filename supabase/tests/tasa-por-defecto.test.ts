import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * La tasa de ITBIS por defecto de Impuestos llega al producto nuevo (0118).
 *
 * Las sentencias de abajo son COPIA de las de products/actions.ts e
 * importar/actions.ts: lo que se prueba es que esas sentencias, corriendo
 * como authenticated bajo RLS, dejen el producto con la tasa correcta.
 *
 * Lo que tiene que sostenerse:
 *  1. Con taxes activo y una tasa por defecto, el producto nace con ella.
 *  2. Sin taxes, o sin tasa por defecto, todo sigue como antes: 0.18.
 *  3. La tasa de un cliente no se filtra a otro, ni sin token.
 *  4. Cambiar la tasa por defecto no reescribe productos existentes, y
 *     editar la ficha ya no devuelve al 18% un producto que nacio al 16%.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let tasa16A: string

const claims = (userId: string, tenantId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { tenant_id: tenantId, is_provider: false } })

async function as<T>(
  userId: string,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenantId)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

async function modulo(tenant: string, id: string, encendido: boolean) {
  await sql`
    insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
    values (${tenant}, ${id}, 'active', ${encendido})
    on conflict (tenant_id, module_id) do update set enabled = ${encendido}, status = 'active'`
}

/** La sentencia de crearProducto, tal cual. */
async function crearComoPantalla(userId: string, tenantId: string, sku: string, exento: boolean) {
  return as(userId, tenantId, async (tx) => {
    const [p] = await tx<{ tax_rate: string }[]>`
      insert into public.products
        (tenant_id, sku, name, unit, price, cost, barcode, category_id,
         category, reorder_point, tax_rate, tracks_stock)
      values
        (${tenantId}, ${sku}, ${'Producto ' + sku}, 'unidad', 100, null,
         null, null, null, null,
         case when ${exento} then 0 else public.tasa_itbis_por_defecto() end,
         true)
      returning tax_rate::text`
    return p!.tax_rate
  })
}

/** La sentencia de la importacion CSV, tal cual (sin lote: es opcional). */
async function crearComoImportacion(userId: string, tenantId: string, sku: string) {
  return as(userId, tenantId, async (tx) => {
    const [p] = await tx<{ tax_rate: string }[]>`
      insert into public.products
        (tenant_id, sku, name, category, unit, price, cost, tax_rate, import_batch_id)
      values (${tenantId}, ${sku}, ${'Importado ' + sku}, null,
              'unidad', 50, null, public.tasa_itbis_por_defecto(),
              null)
      on conflict (tenant_id, sku) do nothing
      returning tax_rate::text`
    return p!.tax_rate
  })
}

/** La parte de la tasa de editarProducto, tal cual. */
async function editarComoPantalla(userId: string, tenantId: string, sku: string, exento: boolean) {
  return as(userId, tenantId, async (tx) => {
    const [p] = await tx<{ tax_rate: string }[]>`
      update public.products set
        name     = name,
        tax_rate = case
                     when ${exento} then 0
                     when tax_rate = 0 then public.tasa_itbis_por_defecto()
                     else tax_rate
                   end,
        updated_at = now()
      where sku = ${sku} and tenant_id = ${tenantId}
      returning tax_rate::text`
    return p!.tax_rate
  })
}

const tasaDe = (userId: string, tenantId: string) =>
  as(userId, tenantId, async (tx) => {
    const [r] = await tx<{ t: string }[]>`select public.tasa_itbis_por_defecto()::text as t`
    return r!.t
  })

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`tasa-a-${RUN}`}, 'Tienda al 16 SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`tasa-b-${RUN}`}, 'Tienda sin Impuestos SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  await modulo(tenantA, 'taxes', true)
  await modulo(tenantA, 'products', true)
  await modulo(tenantB, 'products', true)
  // B sin el modulo taxes: que no lo tenga es el caso de "todo como hoy".
  await sql`delete from regb.tenant_modules where tenant_id = ${tenantB} and module_id = 'taxes'`

  const [t] = await sql`
    insert into public.tax_rates (tenant_id, code, name, rate, is_default)
    values (${tenantA}, 'ITBIS-16', 'ITBIS reducido 16%', 0.16, true) returning id`
  tasa16A = t!.id
  await sql`
    insert into public.tax_rates (tenant_id, code, name, rate, is_default)
    values (${tenantA}, 'ITBIS-18', 'ITBIS general 18%', 0.18, false)`
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.tax_rates where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('El producto nuevo nace con la tasa del catalogo', () => {
  it('con taxes activo y el 16% por defecto, la pantalla crea al 16%', async () => {
    expect(await crearComoPantalla(userA, tenantA, 'A-PANT', false)).toBe('0.1600')
  })

  it('la importacion CSV tambien, aunque el archivo no traiga tasa', async () => {
    expect(await crearComoImportacion(userA, tenantA, 'A-CSV')).toBe('0.1600')
  })

  it('marcar exento sigue dando cero, sea cual sea la tasa por defecto', async () => {
    expect(await crearComoPantalla(userA, tenantA, 'A-EXE', true)).toBe('0.0000')
  })
})

describe('Sin taxes, o sin tasa por defecto, todo sigue como hoy', () => {
  it('un cliente sin el modulo taxes crea al 18%', async () => {
    expect(await crearComoPantalla(userB, tenantB, 'B-PANT', false)).toBe('0.1800')
    expect(await crearComoImportacion(userB, tenantB, 'B-CSV')).toBe('0.1800')
  })

  it('con taxes apagado, A vuelve al 18% aunque su tasa siga en la tabla', async () => {
    await modulo(tenantA, 'taxes', false)
    try {
      expect(await tasaDe(userA, tenantA)).toBe('0.1800')
      expect(await crearComoPantalla(userA, tenantA, 'A-APAG', false)).toBe('0.1800')
    } finally {
      await modulo(tenantA, 'taxes', true)
    }
  })

  it('con taxes activo pero sin ninguna tasa por defecto, 18%', async () => {
    await modulo(tenantB, 'taxes', true)
    try {
      expect(await tasaDe(userB, tenantB)).toBe('0.1800')
    } finally {
      await sql`delete from regb.tenant_modules where tenant_id = ${tenantB} and module_id = 'taxes'`
    }
  })

  it('una tasa por defecto con vigencia futura todavia no aplica', async () => {
    await sql`update public.tax_rates set effective_from = current_date + 30 where id = ${tasa16A}`
    try {
      expect(await tasaDe(userA, tenantA)).toBe('0.1800')
    } finally {
      await sql`update public.tax_rates set effective_from = current_date where id = ${tasa16A}`
    }
  })

  it('una tasa por defecto desactivada tampoco', async () => {
    await sql`update public.tax_rates set is_active = false where id = ${tasa16A}`
    try {
      expect(await tasaDe(userA, tenantA)).toBe('0.1800')
    } finally {
      await sql`update public.tax_rates set is_active = true where id = ${tasa16A}`
    }
  })
})

describe('La tasa de un cliente no se filtra a otro', () => {
  it('B, con taxes activo y sin tasas propias, no recibe el 16% de A', async () => {
    await modulo(tenantB, 'taxes', true)
    try {
      expect(await tasaDe(userB, tenantB)).toBe('0.1800')
    } finally {
      await sql`delete from regb.tenant_modules where tenant_id = ${tenantB} and module_id = 'taxes'`
    }
  })

  it('B no puede fingirse A: el tenant sale del token, no de un parametro', async () => {
    // La funcion no recibe argumentos a proposito. Con un tenant de
    // parametro, bastaria con pasarle el de A.
    const [f] = await sql<{ n: number }[]>`
      select pronargs::int as n from pg_proc
      where oid = 'public.tasa_itbis_por_defecto()'::regprocedure`
    expect(f!.n).toBe(0)
  })

  it('sin token -el dueño de la base, que se salta la RLS- da el respaldo, no la tasa de nadie', async () => {
    const [r] = await sql<{ t: string }[]>`select public.tasa_itbis_por_defecto()::text as t`
    expect(r!.t).toBe('0.1800')
  })

  it('no es security definer: la lectura pasa por la RLS de tax_rates', async () => {
    const [f] = await sql<{ d: boolean }[]>`
      select prosecdef as d from pg_proc
      where oid = 'public.tasa_itbis_por_defecto()'::regprocedure`
    expect(f!.d).toBe(false)
  })
})

describe('Lo que ya existe no se reescribe', () => {
  it('cambiar la tasa por defecto no toca los productos creados antes', async () => {
    const [t18] = await sql<{ id: string }[]>`
      select id from public.tax_rates where tenant_id = ${tenantA} and code = 'ITBIS-18'`
    await sql`update public.tax_rates set is_default = false where id = ${tasa16A}`
    await sql`update public.tax_rates set is_default = true where id = ${t18!.id}`
    try {
      const [p] = await sql<{ t: string }[]>`
        select tax_rate::text as t from public.products
        where tenant_id = ${tenantA} and sku = 'A-PANT'`
      expect(p!.t).toBe('0.1600')
      expect(await crearComoPantalla(userA, tenantA, 'A-NUEVO18', false)).toBe('0.1800')
    } finally {
      await sql`update public.tax_rates set is_default = false where id = ${t18!.id}`
      await sql`update public.tax_rates set is_default = true where id = ${tasa16A}`
    }
  })

  it('editar la ficha de un producto al 16% lo deja al 16%, no al 18%', async () => {
    // Antes la edicion escribia 0.18 fijo en cada guardado.
    await sql`update public.products set tax_rate = 0.16 where tenant_id = ${tenantA} and sku = 'A-CSV'`
    await modulo(tenantA, 'taxes', false)
    try {
      expect(await editarComoPantalla(userA, tenantA, 'A-CSV', false)).toBe('0.1600')
    } finally {
      await modulo(tenantA, 'taxes', true)
    }
  })

  it('marcarlo exento lo pone en cero, y desmarcarlo le da la tasa por defecto', async () => {
    expect(await editarComoPantalla(userA, tenantA, 'A-CSV', true)).toBe('0.0000')
    expect(await editarComoPantalla(userA, tenantA, 'A-CSV', false)).toBe('0.1600')
  })
})

describe('El catalogo del marketplace dice lo que ahora hace', () => {
  it('la feature 1 ya no dice que el catalogo no alimenta la facturacion', async () => {
    const [c] = await sql<{ f: string; faq: string }[]>`
      select features->0->>'detalle' as f, faq::text as faq
      from regb.module_catalog where id = 'taxes'`
    expect(c!.f).toMatch(/nace con esa tasa/)
    // Con o sin tildes (0134): lo que no debe volver es la frase, no su ortografia.
    expect(c!.f).not.toMatch(/Todav[ií]a no alimentan/)
    expect(c!.faq).not.toMatch(/Todav[ií]a no\. El cat[aá]logo/)
  })
})
