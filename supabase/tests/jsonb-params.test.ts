/**
 * La trampa del jsonb parametrizado — nos mordio dos veces (respaldos e
 * importaciones), asi que queda fijada con un test.
 *
 * postgres.js decide como serializar cada parametro segun el tipo que
 * Postgres infiere para el. Con `$1::jsonb`, el tipo inferido es jsonb, el
 * driver aplica JSON.stringify a lo que le pases y una cadena que YA era
 * JSON acaba guardada como un jsonb de tipo *string*: `jsonb_object_keys`
 * falla y `.map()` explota al leerlo.
 *
 * La forma correcta es `$1::text::jsonb`: el parametro se infiere como
 * text, viaja tal cual, y el parseo ocurre en el servidor.
 */
import { afterAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 2, onnotice: () => {} })

afterAll(() => sql.end())

const payload = [{ row: 3, column: 'sku', message: 'vacio' }]

describe('parametros jsonb', () => {
  it('`::jsonb` a secas guarda un string, NO un arreglo — por eso no se usa', async () => {
    const [r] = await sql<{ tipo: string }[]>`
      select jsonb_typeof(${JSON.stringify(payload)}::jsonb) as tipo`
    expect(r!.tipo).toBe('string')
  })

  it('`::text::jsonb` guarda el arreglo de verdad', async () => {
    const [r] = await sql<{ tipo: string }[]>`
      select jsonb_typeof(${JSON.stringify(payload)}::text::jsonb) as tipo`
    expect(r!.tipo).toBe('array')
  })

  it('lo guardado con `::text::jsonb` vuelve como arreglo utilizable', async () => {
    const [r] = await sql<{ data: { row: number; column: string }[] }[]>`
      select ${JSON.stringify(payload)}::text::jsonb as data`
    expect(Array.isArray(r!.data)).toBe(true)
    expect(r!.data[0]!.column).toBe('sku')
  })

  it('jsonb_build_object en SQL nunca sufre el problema (asi se arman los respaldos)', async () => {
    const [r] = await sql<{ tipo: string }[]>`
      select jsonb_typeof(jsonb_build_object('a', 1, 'b', 2)) as tipo`
    expect(r!.tipo).toBe('object')
  })
})

/**
 * Los helpers de claims tienen que tolerar "no hay sesion": la bitacora
 * los llama desde triggers que corren tambien en limpiezas administrativas
 * y crons, donde no hay JWT. Antes de 0017, ''::jsonb lanzaba y un simple
 * delete de mantenimiento fallaba.
 */
describe('helpers de claims sin sesion', () => {
  it('devuelven null / false en vez de lanzar', async () => {
    const [r] = await sql<{ uid: string | null; tenant: string | null; provider: boolean }[]>`
      select rls.regb_uid() as uid, rls.tenant_id() as tenant,
             rls.is_provider() as provider`
    expect(r!.uid).toBeNull()
    expect(r!.tenant).toBeNull()
    expect(r!.provider).toBe(false)
  })

  it('tampoco lanzan con la cadena vacia explicita', async () => {
    const [r] = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', '', true)`
      return tx<{ uid: string | null }[]>`select rls.regb_uid() as uid`
    })
    expect(r!.uid).toBeNull()
  })
})

/**
 * La tasa de impuesto va en FRACCION en toda la base (0.18 = 18%).
 *
 * Nos mordio en S20: `sales_order_lines.tax_rate` nacio como porcentaje
 * mientras `products.tax_rate` era fraccion, y un pedido de RD$5,375
 * mostraba RD$9.68 de ITBIS en vez de RD$967.50. El check 0..1 convierte
 * ese error en un fallo ruidoso en vez de un cobro silencioso equivocado.
 */
describe('tasa de impuesto: siempre fraccion', () => {
  it('products y sales_order_lines usan el mismo rango', async () => {
    const rows = await sql<{ table_name: string; numeric_scale: number }[]>`
      select table_name, numeric_scale
      from information_schema.columns
      where table_schema = 'public' and column_name = 'tax_rate'
      order by table_name`
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const r of rows) expect(r.numeric_scale).toBe(4)
  })

  it('la base RECHAZA un 18 escrito como porcentaje', async () => {
    await expect(
      sql`select 1 from public.products where tax_rate = 18`.then(async () => {
        // El insert de prueba corre en transaccion y se revierte.
        return sql.begin(async (tx) => {
          const [t] = await tx<{ id: string }[]>`select id from regb.tenants limit 1`
          await tx`
            insert into public.products (tenant_id, sku, name, tax_rate)
            values (${t!.id}, ${'TEST-TAX-' + Date.now()}, 'Prueba tasa', 18)`
        })
      }),
    ).rejects.toThrow()
  })
})
