import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Facturacion electronica (0101) contra Postgres real.
 *
 * Lo primero que se prueba aqui NO es el formato: es que el enrutado por
 * token no mezcle los comprobantes de dos contribuyentes.
 *
 * Importa mas que en cualquier otro modulo porque la ruta que la DGII
 * invoca es PUBLICA y sin sesion: no hay `rls.tenant_id()` que proteja
 * nada. Lo unico que separa las facturas de un cliente de las de otro es
 * un token en la URL. Si `ecf_tenant_por_token` se equivoca, el error no
 * es una pantalla fea: es la contabilidad de un negocio dentro de la de
 * otro.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let tokenA: string
let tokenB: string

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

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ecf-a-${RUN}`}, 'Electronica A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ecf-b-${RUN}`}, 'Electronica B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'e-invoice', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  await sql`insert into public.companies (tenant_id, legal_name, tax_id, is_default)
            values (${tenantA}, 'Electronica A SRL', '131-22334-5', true)`
  await sql`insert into public.companies (tenant_id, legal_name, tax_id, is_default)
            values (${tenantB}, 'Electronica B SRL', '130-99887-6', true)`

  const [ca] = await sql`insert into public.ecf_config (tenant_id) values (${tenantA}) returning endpoint_token`
  const [cb] = await sql`insert into public.ecf_config (tenant_id) values (${tenantB}) returning endpoint_token`
  tokenA = ca!.endpoint_token
  tokenB = cb!.endpoint_token
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.ecf_recibidos where tenant_id in ${sql(ts)}`
  await sql`delete from public.ecf_emitidos where tenant_id in ${sql(ts)}`
  await sql`delete from public.ecf_config where tenant_id in ${sql(ts)}`
  await sql`delete from public.companies where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('El token enruta, y solo a su dueño', () => {
  it('cada tenant nace con un token distinto de 128 bits', () => {
    expect(tokenA).toMatch(/^[a-f0-9]{32}$/)
    expect(tokenB).toMatch(/^[a-f0-9]{32}$/)
    expect(tokenA).not.toBe(tokenB)
  })

  it('el token de A resuelve a A, con su RNC en digitos', async () => {
    const [r] = await sql<{ tenant_id: string; rnc: string; ambiente: string }[]>`
      select * from public.ecf_tenant_por_token(${tokenA})`
    expect(r!.tenant_id).toBe(tenantA)
    expect(r!.rnc).toBe('131223345')
    expect(r!.ambiente).toBe('testecf')
  })

  it('el token de B NUNCA resuelve a A', async () => {
    const [r] = await sql<{ tenant_id: string }[]>`
      select * from public.ecf_tenant_por_token(${tokenB})`
    expect(r!.tenant_id).toBe(tenantB)
    expect(r!.tenant_id).not.toBe(tenantA)
  })

  it('un token inventado no resuelve a nada', async () => {
    const filas = await sql`select * from public.ecf_tenant_por_token(${'f'.repeat(32)})`
    expect(filas).toHaveLength(0)
  })

  it('un token corto no abre nada aunque adivine el principio', async () => {
    const filas = await sql`select * from public.ecf_tenant_por_token(${tokenA.slice(0, 8)})`
    expect(filas).toHaveLength(0)
  })

  it('la cadena vacia tampoco', async () => {
    expect(await sql`select * from public.ecf_tenant_por_token('')`).toHaveLength(0)
  })
})

describe('Aislamiento normal entre clientes', () => {
  beforeAll(async () => {
    await sql`
      insert into public.ecf_emitidos (tenant_id, encf, origen, monto_total, ruta)
      values (${tenantA}, 'E320000000001', 'caja', 4500, 'rfce-resumen')`
    await sql`
      insert into public.ecf_recibidos (tenant_id, encf, rnc_emisor, acuse_estado)
      values (${tenantA}, 'E310000000055', '130111111', 0)`
  })

  it('A ve lo suyo', async () => {
    const filas = await as(userA, tenantA, (tx) => tx`select encf from public.ecf_emitidos`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve los emitidos de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx`select encf from public.ecf_emitidos where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no ve los recibidos de A', async () => {
    const filas = await as(userB, tenantB, (tx) => tx`select encf from public.ecf_recibidos`)
    expect(filas).toHaveLength(0)
  })

  it('B no puede leer el token de A -es una credencial-', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx`select endpoint_token from public.ecf_config where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('sin el modulo e-invoice, no se ve nada', async () => {
    await sql`update regb.tenant_modules set enabled = false
              where tenant_id = ${tenantA} and module_id = 'e-invoice'`
    const filas = await as(userA, tenantA, (tx) => tx`select encf from public.ecf_emitidos`)
    expect(filas).toHaveLength(0)
    await sql`update regb.tenant_modules set enabled = true
              where tenant_id = ${tenantA} and module_id = 'e-invoice'`
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un e-NCF con 8 digitos de secuencia se rechaza -son 10-', async () => {
    await expect(
      sql`insert into public.ecf_emitidos (tenant_id, encf, origen, monto_total, ruta)
          values (${tenantB}, 'E3100000001', 'factura', 100, 'ecf-completo')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un tipo de e-CF que no existe se rechaza', async () => {
    await expect(
      sql`insert into public.ecf_emitidos (tenant_id, encf, origen, monto_total, ruta)
          values (${tenantB}, 'E990000000001', 'factura', 100, 'ecf-completo')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('los seis tipos nuevos si entran', async () => {
    for (const t of ['E41', 'E43', 'E44', 'E45', 'E46', 'E47']) {
      await sql`insert into public.ecf_emitidos (tenant_id, encf, origen, monto_total, ruta)
                values (${tenantB}, ${`${t}0000000009`}, 'factura', 100, 'ecf-completo')`
    }
    const [n] = await sql<{ n: string }[]>`
      select count(*)::text as n from public.ecf_emitidos where tenant_id = ${tenantB}`
    expect(Number(n!.n)).toBe(6)
  })

  it('el mismo e-NCF dos veces en el mismo tenant se rechaza', async () => {
    await expect(
      sql`insert into public.ecf_emitidos (tenant_id, encf, origen, monto_total, ruta)
          values (${tenantA}, 'E320000000001', 'caja', 4500, 'rfce-resumen')`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('decir "no recibido" sin motivo se rechaza', async () => {
    await expect(
      sql`insert into public.ecf_recibidos (tenant_id, encf, rnc_emisor, acuse_estado)
          values (${tenantB}, 'E310000000077', '130111111', 1)`,
    ).rejects.toThrow(/motivo_solo_si_no_recibido/)
  })

  it('y decir "recibido" CON motivo tambien', async () => {
    await expect(
      sql`insert into public.ecf_recibidos (tenant_id, encf, rnc_emisor, acuse_estado, acuse_motivo)
          values (${tenantB}, 'E310000000078', '130111111', 0, 2)`,
    ).rejects.toThrow(/motivo_solo_si_no_recibido/)
  })

  it('una contingencia sin fecha de inicio se rechaza', async () => {
    await expect(
      sql`update public.ecf_config set contingencia = 'sin-sistema' where tenant_id = ${tenantB}`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un ambiente inventado se rechaza', async () => {
    await expect(
      sql`update public.ecf_config set ambiente = 'produccion' where tenant_id = ${tenantB}`,
    ).rejects.toThrow(/violates check constraint/)
  })
})

describe('La bitacora NO guarda el token en claro', () => {
  /**
   * `audit.record()` guarda `to_jsonb(new)`: la fila entera. En casi toda
   * tabla eso es lo que se quiere; en `ecf_config` no, porque ahi va el
   * `endpoint_token`.
   *
   * Ese token es lo UNICO que separa el buzon de e-CF de un cliente del
   * de otro -las tres URL publicas no piden nada mas- y `audit.log` la
   * lee cualquier usuario del tenant con permiso de bitacora, mientras
   * que la fila de `ecf_config` solo la ve quien administra el modulo.
   * La bitacora, puesta ahi para vigilar, filtraba la llave que vigila.
   *
   * 0103 lo corrige pasando las columnas secretas como argumentos del
   * trigger. Se comprueba contra Postgres de verdad porque el defecto
   * vivia en plpgsql: ningun test de TypeScript lo habria visto.
   */
  it('ni al crear ni al cambiarlo', async () => {
    const [antes] = await sql<{ endpoint_token: string }[]>`
      select endpoint_token from public.ecf_config where tenant_id = ${tenantA}`
    const nuevo = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

    await sql`update public.ecf_config set endpoint_token = ${nuevo} where tenant_id = ${tenantA}`

    const filas = await sql<{ antes: string | null; despues: string | null }[]>`
      select before ->> 'endpoint_token' as antes, after ->> 'endpoint_token' as despues
        from audit.log
       where tenant_id = ${tenantA} and entity = 'ecf_config'
       order by at`

    // Si esto sale vacio la prueba no esta probando nada.
    expect(filas.length).toBeGreaterThan(0)

    const enClaro = [antes!.endpoint_token, nuevo]
    for (const f of filas) {
      for (const v of [f.antes, f.despues]) {
        expect(enClaro).not.toContain(v)
        if (v !== null) expect(v).toMatch(/^oculto:[0-9a-f]{8}$/)
      }
    }

    // Devuelto al valor original para no romper el resto del archivo.
    await sql`update public.ecf_config set endpoint_token = ${antes!.endpoint_token}
              where tenant_id = ${tenantA}`
  })

  it('pero el cambio SIGUE siendo detectable, que es para lo que sirve la bitacora', async () => {
    // Se oculta con una huella, no con un '***' fijo: un auditor tiene
    // que poder ver que el token cambio el dia X sin poder reconstruirlo.
    const huellas = await sql<{ n: string }[]>`
      select count(distinct after ->> 'endpoint_token') as n
        from audit.log
       where tenant_id = ${tenantA} and entity = 'ecf_config'`
    expect(Number(huellas[0]!.n)).toBeGreaterThan(1)
  })

  it('y el resto de la fila se audita igual que siempre', async () => {
    // Ocultar una columna no puede convertirse en dejar de auditar.
    const [f] = await sql<{ ambiente: string | null }[]>`
      select after ->> 'ambiente' as ambiente
        from audit.log
       where tenant_id = ${tenantA} and entity = 'ecf_config'
       order by at limit 1`
    expect(f!.ambiente).not.toBeNull()
  })
})

