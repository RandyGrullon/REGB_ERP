import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Contabilidad (modulo 16, F6) contra Postgres real.
 *
 * Lo que no se puede comprobar sin base de datos:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. Un asiento CONTABILIZADO es inmutable de verdad -ni un superusuario
 *     via SQL directo puede editarlo o borrarlo, el trigger no distingue
 *     por rol-.
 *  3. `post_journal_entry()` rechaza lo que no cuadra o tiene menos de dos
 *     lineas, y valida el tenant igual que `next_purchase_order_number`
 *     desde la 0031.
 *  4. La numeracion no repite ni deja huecos bajo concurrencia.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let cajaA: string
let ventasA: string
let asientoA: string
let asientoB: string

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
    update regb.tenant_modules set enabled = ${encendido}
    where tenant_id = ${tenant} and module_id = ${id}`
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`acc-a-${RUN}`}, 'Contable A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`acc-b-${RUN}`}, 'Contable B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'accounting', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ca] = await sql`
    insert into public.accounts (tenant_id, code, name, type)
    values (${tenantA}, ${`CAJA-${RUN}`}, 'Caja', 'asset') returning id`
  const [va] = await sql`
    insert into public.accounts (tenant_id, code, name, type)
    values (${tenantA}, ${`VENT-${RUN}`}, 'Ventas', 'revenue') returning id`
  cajaA = ca!.id
  ventasA = va!.id

  const [oa] = await sql`
    insert into public.journal_entries (tenant_id, number, description)
    values (${tenantA}, ${`AS-TEST-A-${RUN}`}, 'Asiento de prueba A') returning id`
  const [ob] = await sql`
    insert into public.journal_entries (tenant_id, number, description)
    values (${tenantB}, ${`AS-TEST-B-${RUN}`}, 'Asiento de prueba B') returning id`
  asientoA = oa!.id
  asientoB = ob!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  // Los asientos contabilizados no se pueden borrar con un DELETE normal
  // -es la garantia que este archivo prueba-, asi que la limpieza apaga
  // los triggers de inmutabilidad primero. Es la unica excepcion valida:
  // es un tenant de PRUEBA que se destruye entero al final.
  await sql`alter table public.journal_entry_lines disable trigger no_editar_lineas_contabilizado`
  await sql`alter table public.journal_entries disable trigger no_editar_contabilizado`
  await sql`delete from public.journal_entry_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.journal_entries where tenant_id in ${sql(ts)}`
  await sql`alter table public.journal_entry_lines enable trigger no_editar_lineas_contabilizado`
  await sql`alter table public.journal_entries enable trigger no_editar_contabilizado`
  await sql`delete from public.journal_entry_counters where tenant_id in ${sql(ts)}`
  await sql`delete from public.accounts where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('B no ve las cuentas ni los asientos de A', async () => {
    const [cuentas, asientos] = await as(userB, tenantB, async (tx) => {
      const c = await tx<{ id: string }[]>`
        select id from public.accounts where tenant_id = ${tenantA}`
      const a = await tx<{ id: string }[]>`
        select id from public.journal_entries where tenant_id = ${tenantA}`
      return [c, a] as const
    })
    expect(cuentas).toHaveLength(0)
    expect(asientos).toHaveLength(0)
  })

  it('B no puede colar una linea en un asiento de A usando su PROPIO tenant_id', async () => {
    // Mismo truco que en 0040: la RLS de insert solo compara el tenant_id
    // de la fila nueva contra quien llama -aqui SI coincide, tenantB=
    // tenantB-, no revisa a quien pertenece `entry_id`. Sin la comprobacion
    // extra en `impedir_editar_linea_contabilizada()`, esto colaria una
    // linea de B en un asiento de A.
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit)
          values (${asientoA}, ${tenantB}, ${cajaA}, 100, 0)`,
      ),
    ).rejects.toThrow(/no pertenece a ese asiento/)
  })

  it('B no puede usar una cuenta de A aunque el asiento sea suyo', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit)
          values (${asientoB}, ${tenantB}, ${cajaA}, 100, 0)`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('el asiento de B existe y es suyo: aislar no puede romper lo propio', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.journal_entries`,
    )
    expect(filas.map((f) => f.id)).toEqual([asientoB])
  })
})

describe('Partida doble', () => {
  it('un asiento con menos de dos lineas se rechaza al contabilizar', async () => {
    const [e] = await sql`
      insert into public.journal_entries (tenant_id, number, description)
      values (${tenantA}, ${`AS-1LINEA-${RUN}`}, 'Una sola linea') returning id`
    await sql`
      insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit)
      values (${e!.id}, ${tenantA}, ${cajaA}, 100, 0)`

    await expect(
      as(userA, tenantA, (tx) => tx`select public.post_journal_entry(${e!.id})`),
    ).rejects.toThrow(/al menos dos lineas/)
  })

  it('un asiento descuadrado se rechaza al contabilizar', async () => {
    const [e] = await sql`
      insert into public.journal_entries (tenant_id, number, description)
      values (${tenantA}, ${`AS-DESCUADRE-${RUN}`}, 'No cuadra') returning id`
    await sql`
      insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit)
      values (${e!.id}, ${tenantA}, ${cajaA}, 1000, 0),
             (${e!.id}, ${tenantA}, ${ventasA}, 0, 900)`

    await expect(
      as(userA, tenantA, (tx) => tx`select public.post_journal_entry(${e!.id})`),
    ).rejects.toThrow(/no cuadra/)
  })

  it('un asiento cuadrado se contabiliza y queda con status posted', async () => {
    await sql`
      insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit)
      values (${asientoA}, ${tenantA}, ${cajaA}, 500, 0),
             (${asientoA}, ${tenantA}, ${ventasA}, 0, 500)`

    await as(userA, tenantA, (tx) => tx`select public.post_journal_entry(${asientoA})`)

    const [r] = await sql<{ status: string }[]>`
      select status from public.journal_entries where id = ${asientoA}`
    expect(r!.status).toBe('posted')
  })

  it('B no puede contabilizar un asiento de A', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`select public.post_journal_entry(${asientoA})`),
    ).rejects.toThrow(/no es de este cliente/)
  })
})

describe('Un asiento contabilizado es inmutable', () => {
  it('no se puede editar su descripcion', async () => {
    await expect(
      sql`update public.journal_entries set description = 'cambiado' where id = ${asientoA}`,
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('no se puede borrar', async () => {
    await expect(
      sql`delete from public.journal_entries where id = ${asientoA}`,
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('no se le puede agregar una linea nueva', async () => {
    await expect(
      sql`
        insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit)
        values (${asientoA}, ${tenantA}, ${cajaA}, 10, 0)`,
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('no se le puede borrar una linea existente', async () => {
    const [l] = await sql<{ id: string }[]>`
      select id from public.journal_entry_lines where entry_id = ${asientoA} limit 1`
    await expect(
      sql`delete from public.journal_entry_lines where id = ${l!.id}`,
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('no se puede contabilizar dos veces', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`select public.post_journal_entry(${asientoA})`),
    ).rejects.toThrow(/Solo un borrador/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantA, 'accounting', true))

  it('sin el modulo, cuentas y asientos dan cero filas', async () => {
    await modulo(tenantA, 'accounting', false)
    const [cuentas, asientos] = await as(userA, tenantA, async (tx) => {
      const c = await tx<{ id: string }[]>`select id from public.accounts`
      const a = await tx<{ id: string }[]>`select id from public.journal_entries`
      return [c, a] as const
    })
    expect(cuentas).toHaveLength(0)
    expect(asientos).toHaveLength(0)
  })

  it('sin el modulo, el numerador tampoco entrega numeros', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx<{ next_journal_entry_number: string }[]>`
          select public.next_journal_entry_number(${tenantA})`,
      ),
    ).rejects.toThrow(/no esta activo/)
  })
})

describe('Numeracion', () => {
  it('el primer asiento del ano lleva el formato AS-ANO-00001', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ next_journal_entry_number: string }[]>`
        select public.next_journal_entry_number(${tenantB})`,
    )
    expect(r!.next_journal_entry_number).toMatch(/^AS-\d{4}-00001$/)
  })

  it('ocho capturas a la vez: sin repetidos y SIN HUECOS', async () => {
    const salida = (
      await Promise.all(
        Array.from({ length: 8 }, () =>
          as(
            userB,
            tenantB,
            (tx) => tx<{ next_journal_entry_number: string }[]>`
              select public.next_journal_entry_number(${tenantB})`,
          ),
        ),
      )
    ).map((r) => r[0]!.next_journal_entry_number)

    expect(new Set(salida).size).toBe(8)
    expect(salida.map((n) => Number(n.slice(-5))).sort((a, b) => a - b)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ])
  })

  it('B no puede consumir la numeracion de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx<{ next_journal_entry_number: string }[]>`
          select public.next_journal_entry_number(${tenantA})`,
      ),
    ).rejects.toThrow(/otro cliente/)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un tipo de cuenta inventado se rechaza', async () => {
    await expect(
      sql`
        insert into public.accounts (tenant_id, code, name, type)
        values (${tenantA}, ${`X-${RUN}`}, 'Cuenta rara', 'inventado')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una linea con debito y credito a la vez se rechaza', async () => {
    const [e] = await sql`
      insert into public.journal_entries (tenant_id, number, description)
      values (${tenantA}, ${`AS-BADLINE-${RUN}`}, 'Linea mala') returning id`
    await expect(
      sql`
        insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit)
        values (${e!.id}, ${tenantA}, ${cajaA}, 100, 50)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una linea sin debito ni credito se rechaza', async () => {
    const [e] = await sql`
      insert into public.journal_entries (tenant_id, number, description)
      values (${tenantA}, ${`AS-VACIA-${RUN}`}, 'Linea vacia') returning id`
    await expect(
      sql`
        insert into public.journal_entry_lines (entry_id, tenant_id, account_id, debit, credit)
        values (${e!.id}, ${tenantA}, ${cajaA}, 0, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el numero de asiento no se repite dentro del mismo cliente', async () => {
    await expect(
      sql`
        insert into public.journal_entries (tenant_id, number, description)
        values (${tenantA}, ${`AS-TEST-A-${RUN}`}, 'Duplicado')`,
    ).rejects.toThrow(/duplicate key/)
  })
})
