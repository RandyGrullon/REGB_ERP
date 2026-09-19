import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Impuestos (modulo 24) contra Postgres real.
 *
 * Cubre lo que solo se comprueba hablandole a la base:
 *
 *  1. Aislamiento normal entre clientes, y que B no pueda colar una fila
 *     con el tenant_id de A.
 *  2. Modulo apagado: cero filas, no un error raro.
 *  3. El trigger anti-tenant-ajeno POR TRIPLICADO (proveedor, regla de
 *     ITBIS, regla de ISR) y -esto es lo que el molde de la 0048 no
 *     cubre- tambien en UPDATE: reasignar una regla a la de otro cliente
 *     es una via que un trigger de solo insert no ve.
 *  4. Las restricciones de tabla, empezando por la que impide teclear 18
 *     donde va 0.18.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let proveedorA: string
let proveedorB: string
let tasaA: string
let reglaIsrA: string
let reglaIsrB: string

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
    values (${`tax-a-${RUN}`}, 'Ferreteria Fiscal A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`tax-b-${RUN}`}, 'Distribuidora Fiscal B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'taxes', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`
    insert into public.suppliers (tenant_id, name, tax_id)
    values (${tenantA}, 'Suplidora del Este', '131234567') returning id`
  const [pb] = await sql`
    insert into public.suppliers (tenant_id, name, tax_id)
    values (${tenantB}, 'Servicios Profesionales SRL', '130987654') returning id`
  proveedorA = pa!.id
  proveedorB = pb!.id

  const [ta] = await sql`
    insert into public.tax_rates (tenant_id, code, name, rate, is_default)
    values (${tenantA}, 'ITBIS-18', 'ITBIS general 18%', 0.18, true) returning id`
  tasaA = ta!.id
  await sql`
    insert into public.tax_rates (tenant_id, code, name, rate, is_default)
    values (${tenantB}, 'ITBIS-18', 'ITBIS general 18%', 0.18, true)`

  const [ra] = await sql`
    insert into public.tax_withholding_rules
      (tenant_id, code, name, tax, party_type, base, rate, dgii_isr_type)
    values (${tenantA}, 'ISR-HON', 'ISR honorarios 10%', 'isr', 'fisica', 'subtotal', 0.10, '02')
    returning id`
  const [rb] = await sql`
    insert into public.tax_withholding_rules
      (tenant_id, code, name, tax, party_type, base, rate, dgii_isr_type)
    values (${tenantB}, 'ISR-HON', 'ISR honorarios 10%', 'isr', 'fisica', 'subtotal', 0.10, '02')
    returning id`
  reglaIsrA = ra!.id
  reglaIsrB = rb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.supplier_tax_profiles where tenant_id in ${sql(ts)}`
  await sql`delete from public.tax_filings where tenant_id in ${sql(ts)}`
  await sql`delete from public.tax_withholding_rules where tenant_id in ${sql(ts)}`
  await sql`delete from public.tax_rates where tenant_id in ${sql(ts)}`
  await sql`delete from public.suppliers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia tasa normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.tax_rates`,
    )
    expect(filas.map((f) => f.id)).toEqual([tasaA])
  })

  it('B no ve las tasas de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.tax_rates where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no ve las reglas de retencion de A', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.tax_withholding_rules`,
    )
    expect(filas.map((f) => f.id)).toEqual([reglaIsrB])
  })

  it('B no puede escribir una tasa con el tenant_id de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.tax_rates (tenant_id, code, name, rate)
          values (${tenantA}, 'COLADA', 'Tasa ajena', 0.18)`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('B no puede escribir una declaracion con el tenant_id de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.tax_filings (tenant_id, form, period, due_date)
          values (${tenantA}, 'IT-1', '202609', '2026-10-20')`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('B trabaja normalmente en lo suyo: aislar no rompe lo propio', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        insert into public.tax_filings
          (tenant_id, form, period, due_date, itbis_charged, itbis_paid, amount_due)
        values (${tenantB}, 'IT-1', '202609', '2026-10-20', 5000, 3000, 2000)`,
    )
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.tax_filings`,
    )
    expect(filas).toHaveLength(1)
  })
})

describe('El agujero de siempre, por triplicado', () => {
  it('B no puede darle perfil fiscal a un proveedor de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.supplier_tax_profiles (tenant_id, supplier_id, party_type)
          values (${tenantB}, ${proveedorA}, 'fisica')`,
      ),
    ).rejects.toThrow(/proveedor no pertenece a ese cliente/)
  })

  it('B no puede asignarle a su proveedor una regla de retencion de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.supplier_tax_profiles
            (tenant_id, supplier_id, party_type, isr_rule_id)
          values (${tenantB}, ${proveedorB}, 'fisica', ${reglaIsrA})`,
      ),
    ).rejects.toThrow(/regla de retencion no pertenece a ese cliente/)
  })

  it('B asigna su propio perfil con su propia regla sin problema', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        insert into public.supplier_tax_profiles
          (tenant_id, supplier_id, party_type, isr_rule_id)
        values (${tenantB}, ${proveedorB}, 'fisica', ${reglaIsrB})`,
    )
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.supplier_tax_profiles`,
    )
    expect(filas).toHaveLength(1)
  })

  it('el UPDATE tampoco cuela una regla ajena -lo que el trigger de solo insert no veria-', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          update public.supplier_tax_profiles
          set isr_rule_id = ${reglaIsrA}
          where supplier_id = ${proveedorB}`,
      ),
    ).rejects.toThrow(/regla de retencion no pertenece a ese cliente/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantA, 'taxes', true))

  it('sin el modulo, las tasas dan cero filas', async () => {
    await modulo(tenantA, 'taxes', false)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.tax_rates`,
    )
    expect(filas).toHaveLength(0)
  })

  it('sin el modulo, tampoco se puede escribir una regla', async () => {
    await modulo(tenantA, 'taxes', false)
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.tax_withholding_rules
            (tenant_id, code, name, tax, party_type, base, rate)
          values (${tenantA}, 'ITBIS-30', 'ITBIS 30%', 'itbis', 'juridica', 'itbis', 0.30)`,
      ),
    ).rejects.toThrow(/row-level security/)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una tasa en puntos (18) y no en fraccion (0.18) se rechaza: ahi esta el cobro de 1800%', async () => {
    await expect(
      sql`
        insert into public.tax_rates (tenant_id, code, name, rate)
        values (${tenantB}, 'MAL', 'Dieciocho por ciento mal escrito', 18)`,
    ).rejects.toThrow(/violates check constraint|numeric field overflow/)
  })

  it('el mismo codigo de tasa no se repite para el mismo cliente', async () => {
    await expect(
      sql`
        insert into public.tax_rates (tenant_id, code, name, rate)
        values (${tenantB}, 'ITBIS-18', 'Duplicada', 0.18)`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('no puede haber dos tasas por defecto activas del mismo tipo', async () => {
    await expect(
      sql`
        insert into public.tax_rates (tenant_id, code, name, rate, is_default)
        values (${tenantB}, 'ITBIS-16', 'ITBIS reducido', 0.16, true)`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('una regla de ISR sin codigo DGII se rechaza: sin ese codigo el 606 rebota', async () => {
    await expect(
      sql`
        insert into public.tax_withholding_rules
          (tenant_id, code, name, tax, party_type, base, rate)
        values (${tenantB}, 'ISR-SIN', 'ISR sin codigo', 'isr', 'fisica', 'subtotal', 0.10)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una regla de ITBIS sobre el subtotal se rechaza: la base del ITBIS es el ITBIS', async () => {
    await expect(
      sql`
        insert into public.tax_withholding_rules
          (tenant_id, code, name, tax, party_type, base, rate)
        values (${tenantB}, 'ITBIS-MAL', 'ITBIS sobre subtotal', 'itbis', 'juridica', 'subtotal', 0.30)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un codigo de retencion de ISR fuera del 01-09 se rechaza', async () => {
    await expect(
      sql`
        insert into public.tax_withholding_rules
          (tenant_id, code, name, tax, party_type, base, rate, dgii_isr_type)
        values (${tenantB}, 'ISR-99', 'Codigo inventado', 'isr', 'fisica', 'subtotal', 0.10, '99')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un proveedor exento con regla asignada se rechaza: es una contradiccion que cuesta dinero', async () => {
    await expect(
      sql`
        insert into public.supplier_tax_profiles
          (tenant_id, supplier_id, party_type, is_exempt, isr_rule_id)
        values (${tenantA}, ${proveedorA}, 'juridica', true, ${reglaIsrA})`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un proveedor no puede tener dos perfiles fiscales', async () => {
    await expect(
      sql`
        insert into public.supplier_tax_profiles (tenant_id, supplier_id, party_type)
        values (${tenantB}, ${proveedorB}, 'juridica')`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('un periodo que no sea YYYYMM se rechaza', async () => {
    await expect(
      sql`
        insert into public.tax_filings (tenant_id, form, period, due_date)
        values (${tenantB}, '606', '2026-09', '2026-10-15')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('no se puede deber y tener saldo a favor a la vez', async () => {
    await expect(
      sql`
        insert into public.tax_filings
          (tenant_id, form, period, due_date, amount_due, credit_forward)
        values (${tenantB}, 'IT-1', '202608', '2026-09-21', 100, 50)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una declaracion marcada como presentada sin fecha de presentacion se rechaza', async () => {
    await expect(
      sql`
        insert into public.tax_filings (tenant_id, form, period, due_date, status)
        values (${tenantB}, 'IT-1', '202607', '2026-08-20', 'filed')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo formulario y periodo no se declara dos veces', async () => {
    await expect(
      sql`
        insert into public.tax_filings (tenant_id, form, period, due_date)
        values (${tenantB}, 'IT-1', '202609', '2026-10-20')`,
    ).rejects.toThrow(/duplicate key/)
  })
})
