import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Consolidacion (modulo 28, F11) contra Postgres real.
 *
 * Lo que no se puede comprobar sin base de datos:
 *
 *  1. Aislamiento normal entre clientes, y que B no pueda colar un
 *     miembro, una corrida, un saldo ni una eliminacion en el grupo de A
 *     usando su PROPIO tenant_id -el agujero de siempre, cinco tablas-.
 *  2. Que una empresa en otra moneda NO entre al grupo: este corte no
 *     traduce moneda y la puerta se cierra en la base, no en una nota.
 *  3. Que una corrida cerrada sea inmutable de verdad -ni un superusuario
 *     via SQL directo, el trigger no distingue por rol-, igual que un
 *     asiento contabilizado en 0041.
 *  4. Que una eliminacion solo pueda apuntar a empresas que SON miembros
 *     del grupo de esa corrida: eso no lo puede expresar una FK.
 *  5. Que journal_entries.company_id no acepte la empresa de otro cliente.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()

let tenantA: string
let tenantB: string
let matrizA: string
let filialA: string
let terceraA: string
let dolarA: string
let empresaB: string
let cuentaIngresoA: string
let cuentaGastoA: string
let cuentaB: string
let grupoA: string
let grupoB: string
let corridaA: string
let corridaCerradaA: string

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
    values (${`cons-a-${RUN}`}, 'Grupo Consolida A SRL', 'grande', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`cons-b-${RUN}`}, 'Grupo Consolida B SRL', 'grande', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    for (const m of ['accounting', 'orgs', 'consolidation']) {
      await sql`
        insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
        values (${t}, ${m}, 'active', true)
        on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
    }
  }

  // Dos razones sociales en DOP (el grupo real), una tercera fuera del
  // grupo y una en USD para probar que la moneda cierra la puerta.
  const [m1] = await sql`
    insert into public.companies (tenant_id, legal_name, currency, is_default)
    values (${tenantA}, 'Matriz Consolida SRL', 'DOP', true) returning id`
  const [m2] = await sql`
    insert into public.companies (tenant_id, legal_name, currency)
    values (${tenantA}, 'Filial Consolida SRL', 'DOP') returning id`
  const [m3] = await sql`
    insert into public.companies (tenant_id, legal_name, currency)
    values (${tenantA}, 'Tercera Fuera del Grupo SRL', 'DOP') returning id`
  const [m4] = await sql`
    insert into public.companies (tenant_id, legal_name, currency)
    values (${tenantA}, 'Consolida Miami LLC', 'USD') returning id`
  const [mb] = await sql`
    insert into public.companies (tenant_id, legal_name, currency, is_default)
    values (${tenantB}, 'Empresa Ajena SRL', 'DOP', true) returning id`
  matrizA = m1!.id
  filialA = m2!.id
  terceraA = m3!.id
  dolarA = m4!.id
  empresaB = mb!.id

  const [ci] = await sql`
    insert into public.accounts (tenant_id, code, name, type)
    values (${tenantA}, '4100', 'Ingresos por ventas', 'revenue') returning id`
  const [cg] = await sql`
    insert into public.accounts (tenant_id, code, name, type)
    values (${tenantA}, '5100', 'Costo de ventas', 'expense') returning id`
  const [cb] = await sql`
    insert into public.accounts (tenant_id, code, name, type)
    values (${tenantB}, '4100', 'Ingresos por ventas', 'revenue') returning id`
  cuentaIngresoA = ci!.id
  cuentaGastoA = cg!.id
  cuentaB = cb!.id

  const [ga] = await sql`
    insert into public.consolidation_groups (tenant_id, name, presentation_currency)
    values (${tenantA}, 'Grupo Consolida', 'DOP') returning id`
  const [gb] = await sql`
    insert into public.consolidation_groups (tenant_id, name, presentation_currency)
    values (${tenantB}, 'Grupo Ajeno', 'DOP') returning id`
  grupoA = ga!.id
  grupoB = gb!.id

  await sql`
    insert into public.consolidation_group_members (tenant_id, group_id, company_id, is_parent)
    values (${tenantA}, ${grupoA}, ${matrizA}, true)`
  await sql`
    insert into public.consolidation_group_members (tenant_id, group_id, company_id)
    values (${tenantA}, ${grupoA}, ${filialA})`
  await sql`
    insert into public.consolidation_group_members (tenant_id, group_id, company_id, is_parent)
    values (${tenantB}, ${grupoB}, ${empresaB}, true)`

  const [ra] = await sql`
    insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
    values (${tenantA}, ${grupoA}, '2026-01-01', '2026-03-31') returning id`
  const [rc] = await sql`
    insert into public.consolidation_runs
      (tenant_id, group_id, period_start, period_end, status, closed_at)
    values (${tenantA}, ${grupoA}, '2025-01-01', '2025-12-31', 'closed', now()) returning id`
  corridaA = ra!.id
  corridaCerradaA = rc!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  // Una corrida cerrada no se borra con un DELETE normal -es justo la
  // garantia que este archivo prueba-, asi que la limpieza apaga los
  // triggers de inmutabilidad. Misma excepcion que accounting.test.ts:
  // son clientes de PRUEBA que se destruyen enteros al final.
  await sql`alter table public.consolidation_eliminations disable trigger no_eliminacion_ajena`
  await sql`alter table public.consolidation_run_balances disable trigger no_saldo_de_corrida_ajena`
  await sql`alter table public.consolidation_runs disable trigger no_editar_corrida_cerrada`
  await sql`delete from public.consolidation_eliminations where tenant_id in ${sql(ts)}`
  await sql`delete from public.consolidation_run_balances where tenant_id in ${sql(ts)}`
  await sql`delete from public.consolidation_runs where tenant_id in ${sql(ts)}`
  await sql`alter table public.consolidation_runs enable trigger no_editar_corrida_cerrada`
  await sql`alter table public.consolidation_run_balances enable trigger no_saldo_de_corrida_ajena`
  await sql`alter table public.consolidation_eliminations enable trigger no_eliminacion_ajena`
  await sql`delete from public.consolidation_group_members where tenant_id in ${sql(ts)}`
  await sql`delete from public.consolidation_groups where tenant_id in ${sql(ts)}`
  await sql`delete from public.journal_entry_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.journal_entries where tenant_id in ${sql(ts)}`
  await sql`delete from public.accounts where tenant_id in ${sql(ts)}`
  await sql`delete from public.companies where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio grupo normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.consolidation_groups`,
    )
    expect(filas.map((f) => f.id)).toEqual([grupoA])
  })

  it('B no ve los grupos de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.consolidation_groups where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede meter una empresa en el grupo de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.consolidation_group_members (tenant_id, group_id, company_id)
          values (${tenantB}, ${grupoA}, ${empresaB})`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('B no puede generar una corrida sobre el grupo de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
          values (${tenantB}, ${grupoA}, '2026-01-01', '2026-03-31')`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('B no puede colar un saldo en la foto de una corrida de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.consolidation_run_balances
            (tenant_id, run_id, company_id, account_id, total_debit)
          values (${tenantB}, ${corridaA}, ${empresaB}, ${cuentaB}, 1000)`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('B no puede colar una eliminacion en una corrida de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.consolidation_eliminations
            (tenant_id, run_id, from_company_id, to_company_id,
             debit_account_id, credit_account_id, amount, description)
          values (${tenantB}, ${corridaA}, ${empresaB}, ${empresaB},
                  ${cuentaB}, ${cuentaB}, 500, 'Ajena')`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente|violates check constraint/)
  })

  it('B consolida normalmente en SU propio grupo: aislar no rompe lo propio', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
        values (${tenantB}, ${grupoB}, '2026-01-01', '2026-03-31')`,
    )
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.consolidation_runs`,
    )
    expect(filas).toHaveLength(1)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantA, 'consolidation', true))

  it('sin el modulo, los grupos y las corridas dan cero filas', async () => {
    await modulo(tenantA, 'consolidation', false)
    const [grupos, corridas] = await as(userA, tenantA, async (tx) => {
      const g = await tx<{ id: string }[]>`select id from public.consolidation_groups`
      const c = await tx<{ id: string }[]>`select id from public.consolidation_runs`
      return [g, c] as const
    })
    expect(grupos).toHaveLength(0)
    expect(corridas).toHaveLength(0)
  })
})

describe('La moneda cierra la puerta', () => {
  it('una empresa en USD no entra a un grupo que presenta en DOP', async () => {
    await expect(
      sql`
        insert into public.consolidation_group_members (tenant_id, group_id, company_id)
        values (${tenantA}, ${grupoA}, ${dolarA})`,
    ).rejects.toThrow(/no traduce moneda/)
  })
})

describe('Una corrida cerrada es inmutable', () => {
  it('ni un superusuario puede editarla', async () => {
    await expect(
      sql`
        update public.consolidation_runs set period_end = '2025-11-30'
        where id = ${corridaCerradaA}`,
    ).rejects.toThrow(/ya esta cerrada/)
  })

  it('ni un superusuario puede borrarla', async () => {
    await expect(
      sql`delete from public.consolidation_runs where id = ${corridaCerradaA}`,
    ).rejects.toThrow(/ya esta cerrada/)
  })

  it('no acepta eliminaciones nuevas', async () => {
    await expect(
      sql`
        insert into public.consolidation_eliminations
          (tenant_id, run_id, from_company_id, to_company_id,
           debit_account_id, credit_account_id, amount, description)
        values (${tenantA}, ${corridaCerradaA}, ${matrizA}, ${filialA},
                ${cuentaIngresoA}, ${cuentaGastoA}, 1000, 'Tarde')`,
    ).rejects.toThrow(/ya esta cerrada/)
  })

  it('no deja tocar su foto de saldos', async () => {
    await expect(
      sql`
        insert into public.consolidation_run_balances
          (tenant_id, run_id, company_id, account_id, total_credit)
        values (${tenantA}, ${corridaCerradaA}, ${matrizA}, ${cuentaIngresoA}, 1000)`,
    ).rejects.toThrow(/ya esta cerrada/)
  })

  it('cerrar una corrida en borrador si funciona: inmutable no es intocable antes de cerrar', async () => {
    const [r] = await sql`
      insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
      values (${tenantA}, ${grupoA}, '2026-04-01', '2026-06-30') returning id`
    await as(
      userA,
      tenantA,
      (tx) => tx`
        update public.consolidation_runs set status = 'closed', closed_at = now()
        where id = ${r!.id}`,
    )
    const [fila] = await sql<{ status: string }[]>`
      select status from public.consolidation_runs where id = ${r!.id}`
    expect(fila!.status).toBe('closed')
  })
})

describe('Una eliminacion solo vive entre miembros del grupo', () => {
  it('la eliminacion normal entre dos miembros entra sin problema', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.consolidation_eliminations
          (tenant_id, run_id, from_company_id, to_company_id,
           debit_account_id, credit_account_id, amount, kind, description)
        values (${tenantA}, ${corridaA}, ${matrizA}, ${filialA},
                ${cuentaIngresoA}, ${cuentaGastoA}, 1000, 'revenue_expense',
                'Venta de la matriz a la filial')`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`
        select id from public.consolidation_eliminations where run_id = ${corridaA}`,
    )
    expect(filas).toHaveLength(1)
  })

  it('una empresa del mismo cliente que NO es miembro del grupo se rechaza', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.consolidation_eliminations
            (tenant_id, run_id, from_company_id, to_company_id,
             debit_account_id, credit_account_id, amount, description)
          values (${tenantA}, ${corridaA}, ${matrizA}, ${terceraA},
                  ${cuentaIngresoA}, ${cuentaGastoA}, 500, 'Fuera del grupo')`,
      ),
    ).rejects.toThrow(/miembros del grupo/)
  })

  it('una cuenta de otro cliente en la eliminacion se rechaza', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.consolidation_eliminations
            (tenant_id, run_id, from_company_id, to_company_id,
             debit_account_id, credit_account_id, amount, description)
          values (${tenantA}, ${corridaA}, ${matrizA}, ${filialA},
                  ${cuentaB}, ${cuentaGastoA}, 500, 'Cuenta ajena')`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })
})

describe('El asiento ahora sabe de que empresa es', () => {
  it('un asiento con la empresa de otro cliente se rechaza', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.journal_entries (tenant_id, number, description, company_id)
          values (${tenantA}, ${`AS-CONS-${RUN}-1`}, 'Con empresa ajena', ${empresaB})`,
      ),
    ).rejects.toThrow(/Esa empresa no pertenece a ese cliente/)
  })

  it('un asiento de una empresa propia entra normal', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.journal_entries (tenant_id, number, description, company_id)
        values (${tenantA}, ${`AS-CONS-${RUN}-2`}, 'De la filial', ${filialA})`,
    )
    const [fila] = await as(
      userA,
      tenantA,
      (tx) => tx<{ company_id: string }[]>`
        select company_id from public.journal_entries where number = ${`AS-CONS-${RUN}-2`}`,
    )
    expect(fila!.company_id).toBe(filialA)
  })

  it('un asiento SIN empresa sigue entrando: no se rompe nada de lo ya capturado', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.journal_entries (tenant_id, number, description)
        values (${tenantA}, ${`AS-CONS-${RUN}-3`}, 'Sin etiquetar')`,
    )
    const [fila] = await as(
      userA,
      tenantA,
      (tx) => tx<{ company_id: string | null }[]>`
        select company_id from public.journal_entries where number = ${`AS-CONS-${RUN}-3`}`,
    )
    expect(fila!.company_id).toBeNull()
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un grupo no puede tener dos matrices', async () => {
    await expect(
      sql`
        insert into public.consolidation_group_members (tenant_id, group_id, company_id, is_parent)
        values (${tenantA}, ${grupoA}, ${terceraA}, true)`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('la misma empresa no se repite en el grupo', async () => {
    await expect(
      sql`
        insert into public.consolidation_group_members (tenant_id, group_id, company_id)
        values (${tenantA}, ${grupoA}, ${filialA})`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('eliminarse contra uno mismo no es una eliminacion', async () => {
    await expect(
      sql`
        insert into public.consolidation_eliminations
          (tenant_id, run_id, from_company_id, to_company_id,
           debit_account_id, credit_account_id, amount, description)
        values (${tenantA}, ${corridaA}, ${matrizA}, ${matrizA},
                ${cuentaIngresoA}, ${cuentaGastoA}, 100, 'Contra si misma')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('la misma cuenta al debito y al credito se rechaza', async () => {
    await expect(
      sql`
        insert into public.consolidation_eliminations
          (tenant_id, run_id, from_company_id, to_company_id,
           debit_account_id, credit_account_id, amount, description)
        values (${tenantA}, ${corridaA}, ${matrizA}, ${filialA},
                ${cuentaIngresoA}, ${cuentaIngresoA}, 100, 'Misma cuenta')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un monto de cero no se elimina', async () => {
    await expect(
      sql`
        insert into public.consolidation_eliminations
          (tenant_id, run_id, from_company_id, to_company_id,
           debit_account_id, credit_account_id, amount, description)
        values (${tenantA}, ${corridaA}, ${matrizA}, ${filialA},
                ${cuentaIngresoA}, ${cuentaGastoA}, 0, 'Nada')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una fila de la foto en cero es ruido, no informacion', async () => {
    await expect(
      sql`
        insert into public.consolidation_run_balances
          (tenant_id, run_id, company_id, account_id, total_debit, total_credit)
        values (${tenantA}, ${corridaA}, ${matrizA}, ${cuentaIngresoA}, 0, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un periodo que termina antes de empezar se rechaza', async () => {
    await expect(
      sql`
        insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
        values (${tenantA}, ${grupoA}, '2026-12-31', '2026-01-01')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una corrida cerrada sin fecha de cierre no se puede auditar, y no entra', async () => {
    await expect(
      sql`
        insert into public.consolidation_runs
          (tenant_id, group_id, period_start, period_end, status)
        values (${tenantA}, ${grupoA}, '2027-01-01', '2027-03-31', 'closed')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo periodo no se consolida dos veces para el mismo grupo', async () => {
    await expect(
      sql`
        insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
        values (${tenantA}, ${grupoA}, '2026-01-01', '2026-03-31')`,
    ).rejects.toThrow(/duplicate key/)
  })

  it('un grupo con corridas no se puede borrar: el consolidado entregado no desaparece', async () => {
    await expect(
      sql`delete from public.consolidation_groups where id = ${grupoA}`,
    ).rejects.toThrow(/violates foreign key constraint/)
  })
})
