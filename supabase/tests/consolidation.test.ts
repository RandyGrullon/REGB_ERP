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
 *  6. Que una fila no se MUDE de una corrida cerrada a un borrador: el
 *     trigger miraba solo la corrida destino, asi que vaciar un
 *     consolidado entregado pasaba limpio y sin dejar rastro.
 *  7. Que la foto solo acepte empresas miembros del grupo -la tabla que
 *     suma dinero, igual que la que lo resta-.
 *  8. Que consolidation_freeze() congele el ACUMULADO hasta period_end y
 *     cuente los asientos sin empresa con esa misma ventana.
 *  9. Que la moneda del grupo no se cambie por detras con los miembros
 *     ya dentro, ni con consolidados cerrados.
 * 10. Que consolidation_run_accounts() siga devolviendo una cuenta
 *     desactivada despues si la corrida la uso.
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

/**
 * Un asiento contabilizado de verdad: borrador, lineas, y solo entonces
 * `posted`. Al reves no se puede -0041 no deja tocar las lineas de un
 * asiento ya contabilizado-, y la foto solo mira los contabilizados.
 */
async function asientoContabilizado(opts: {
  tenant: string
  numero: string
  fecha: string
  empresa: string | null
  monto: number
  cuentaDebito: string
  cuentaCredito: string
}) {
  const [e] = await sql<{ id: string }[]>`
    insert into public.journal_entries
      (tenant_id, number, description, entry_date, company_id)
    values (${opts.tenant}, ${opts.numero}, 'Fixture de consolidacion',
            ${opts.fecha}::date, ${opts.empresa})
    returning id`
  const id = e!.id
  await sql`
    insert into public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit)
    values (${opts.tenant}, ${id}, ${opts.cuentaDebito}, ${opts.monto}, 0),
           (${opts.tenant}, ${id}, ${opts.cuentaCredito}, 0, ${opts.monto})`
  await sql`
    update public.journal_entries set status = 'posted', posted_at = now() where id = ${id}`
  return id
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
  corridaA = ra!.id

  // La corrida cerrada se arma en borrador, con su foto y su eliminacion
  // dentro, y se cierra despues: asi es como nace de verdad, y asi se
  // puede comprobar que lo que se entrego sigue ahi.
  const [rc] = await sql`
    insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
    values (${tenantA}, ${grupoA}, '2025-01-01', '2025-12-31') returning id`
  corridaCerradaA = rc!.id
  await sql`
    insert into public.consolidation_run_balances
      (tenant_id, run_id, company_id, account_id, total_credit)
    values (${tenantA}, ${corridaCerradaA}, ${matrizA}, ${cuentaIngresoA}, 1000000)`
  await sql`
    insert into public.consolidation_eliminations
      (tenant_id, run_id, from_company_id, to_company_id,
       debit_account_id, credit_account_id, amount, description)
    values (${tenantA}, ${corridaCerradaA}, ${matrizA}, ${filialA},
            ${cuentaIngresoA}, ${cuentaGastoA}, 250000, 'Venta entre empresas del 2025')`
  await sql`
    update public.consolidation_runs set status = 'closed', closed_at = now()
    where id = ${corridaCerradaA}`
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
  // Mismo motivo con la contabilidad: un asiento contabilizado no se
  // borra, y estos fixtures lo estan a proposito.
  await sql`alter table public.journal_entry_lines disable trigger no_editar_lineas_contabilizado`
  await sql`alter table public.journal_entries disable trigger no_editar_contabilizado`
  await sql`delete from public.journal_entry_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.journal_entries where tenant_id in ${sql(ts)}`
  await sql`alter table public.journal_entries enable trigger no_editar_contabilizado`
  await sql`alter table public.journal_entry_lines enable trigger no_editar_lineas_contabilizado`
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

describe('Una fila no se muda de una corrida cerrada a un borrador', () => {
  // El agujero de la regla 3 a medias: el trigger cubria el UPDATE, pero
  // solo la mitad del UPDATE -el destino-. Con eso, un PATCH de
  // `run_id` vaciaba la foto de un consolidado entregado y el dinero
  // reaparecia declarado en el periodo nuevo, sin un aviso y sin una
  // linea en la bitacora: esta tabla no se audita a proposito.
  it('la foto de una corrida CERRADA no se puede mudar a un borrador', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          update public.consolidation_run_balances set run_id = ${corridaA}
          where run_id = ${corridaCerradaA}`,
      ),
    ).rejects.toThrow(/ya esta cerrada/)
  })

  it('las eliminaciones de una corrida CERRADA tampoco', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          update public.consolidation_eliminations set run_id = ${corridaA}
          where run_id = ${corridaCerradaA}`,
      ),
    ).rejects.toThrow(/ya esta cerrada/)
  })

  it('el consolidado entregado sigue entero despues del intento', async () => {
    const [foto] = await sql<{ c: number; total: string }[]>`
      select count(*)::int as c, coalesce(sum(total_credit), 0)::text as total
      from public.consolidation_run_balances where run_id = ${corridaCerradaA}`
    expect(foto!.c).toBe(1)
    expect(foto!.total).toBe('1000000.00')

    const [elim] = await sql<{ c: number; total: string }[]>`
      select count(*)::int as c, coalesce(sum(amount), 0)::text as total
      from public.consolidation_eliminations where run_id = ${corridaCerradaA}`
    expect(elim!.c).toBe(1)
    expect(elim!.total).toBe('250000.00')
  })

  it('mover una fila entre dos BORRADORES sigue siendo posible: cerrada es cerrada, borrador no', async () => {
    const [r] = await sql<{ id: string }[]>`
      insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
      values (${tenantA}, ${grupoA}, '2028-01-01', '2028-03-31') returning id`
    const [b] = await sql<{ id: string }[]>`
      insert into public.consolidation_run_balances
        (tenant_id, run_id, company_id, account_id, total_debit)
      values (${tenantA}, ${r!.id}, ${matrizA}, ${cuentaGastoA}, 700) returning id`
    const [r2] = await sql<{ id: string }[]>`
      insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
      values (${tenantA}, ${grupoA}, '2028-04-01', '2028-06-30') returning id`
    await as(
      userA,
      tenantA,
      (tx) => tx`
        update public.consolidation_run_balances set run_id = ${r2!.id} where id = ${b!.id}`,
    )
    const [fila] = await sql<{ run_id: string }[]>`
      select run_id from public.consolidation_run_balances where id = ${b!.id}`
    expect(fila!.run_id).toBe(r2!.id)
  })
})

describe('La foto solo suma empresas del grupo', () => {
  it('un saldo de una empresa del mismo cliente que NO es miembro se rechaza', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.consolidation_run_balances
            (tenant_id, run_id, company_id, account_id, total_debit)
          values (${tenantA}, ${corridaA}, ${terceraA}, ${cuentaIngresoA}, 5000000)`,
      ),
    ).rejects.toThrow(/no es miembro del grupo/)
  })

  it('el de una empresa miembro entra normal: cerrar la puerta no rompe la ruta buena', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.consolidation_run_balances
          (tenant_id, run_id, company_id, account_id, total_debit)
        values (${tenantA}, ${corridaA}, ${filialA}, ${cuentaGastoA}, 4000)`,
    )
    const filas = await sql<{ id: string }[]>`
      select id from public.consolidation_run_balances
      where run_id = ${corridaA} and company_id = ${filialA}`
    expect(filas).toHaveLength(1)
  })
})

describe('La corrida con foto no cambia de grupo ni de periodo', () => {
  let grupoBis: string

  beforeAll(async () => {
    const [g] = await sql<{ id: string }[]>`
      insert into public.consolidation_groups (tenant_id, name)
      values (${tenantA}, ${`Grupo A bis ${RUN}`}) returning id`
    grupoBis = g!.id
  })

  it('mudarla a otro grupo se rechaza: sus saldos son de las empresas del grupo viejo', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          update public.consolidation_runs set group_id = ${grupoBis} where id = ${corridaA}`,
      ),
    ).rejects.toThrow(/foto congelada/)
  })

  it('estirarle el periodo tambien: la foto se calculo a otra fecha', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          update public.consolidation_runs set period_end = '2030-12-31' where id = ${corridaA}`,
      ),
    ).rejects.toThrow(/foto congelada/)
  })

  it('cerrarla si se puede: lo que se congela es el grupo y el periodo, no la corrida entera', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        update public.consolidation_runs set status = 'closed', closed_at = now()
        where id = ${corridaA}`,
    )
    const [fila] = await sql<{ status: string }[]>`
      select status from public.consolidation_runs where id = ${corridaA}`
    expect(fila!.status).toBe('closed')
  })
})

describe('La moneda del grupo tampoco se cambia por detras', () => {
  it('un grupo con empresas dentro no pasa a presentar en otra moneda', async () => {
    await expect(
      sql`update public.consolidation_groups set presentation_currency = 'USD' where id = ${grupoB}`,
    ).rejects.toThrow(/no traduce moneda/)
  })

  it('uno con consolidados cerrados no cambia ni aunque las empresas coincidan', async () => {
    await expect(
      sql`update public.consolidation_groups set presentation_currency = 'USD' where id = ${grupoA}`,
    ).rejects.toThrow(/consolidados cerrados/)
  })

  it('un grupo vacio y sin historia si cambia: la puerta cerrada no estorba lo legitimo', async () => {
    const [g] = await sql<{ id: string }[]>`
      insert into public.consolidation_groups (tenant_id, name)
      values (${tenantA}, ${`Grupo Vacio ${RUN}`}) returning id`
    await sql`
      update public.consolidation_groups set presentation_currency = 'USD' where id = ${g!.id}`
    const [fila] = await sql<{ presentation_currency: string }[]>`
      select presentation_currency from public.consolidation_groups where id = ${g!.id}`
    expect(fila!.presentation_currency).toBe('USD')
  })
})

describe('consolidation_freeze congela la foto con UNA sola ventana', () => {
  let corridaFoto: string
  let corridaSinMatriz: string

  beforeAll(async () => {
    // Uno dentro del periodo, uno muy anterior -la foto es acumulada- y
    // uno sin empresa tambien anterior: ese ultimo es justo el que el
    // contador de la pantalla no veia, porque contaba `between`.
    await asientoContabilizado({
      tenant: tenantA,
      numero: `AS-FOTO-${RUN}-1`,
      fecha: '2026-08-10',
      empresa: matrizA,
      monto: 50000,
      cuentaDebito: cuentaGastoA,
      cuentaCredito: cuentaIngresoA,
    })
    await asientoContabilizado({
      tenant: tenantA,
      numero: `AS-FOTO-${RUN}-2`,
      fecha: '2025-06-15',
      empresa: matrizA,
      monto: 1000000,
      cuentaDebito: cuentaGastoA,
      cuentaCredito: cuentaIngresoA,
    })
    await asientoContabilizado({
      tenant: tenantA,
      numero: `AS-FOTO-${RUN}-3`,
      fecha: '2025-07-20',
      empresa: null,
      monto: 777000,
      cuentaDebito: cuentaGastoA,
      cuentaCredito: cuentaIngresoA,
    })

    const [r] = await sql<{ id: string }[]>`
      insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
      values (${tenantA}, ${grupoA}, '2026-07-01', '2026-09-30') returning id`
    corridaFoto = r!.id
    await as(userA, tenantA, (tx) => tx`select public.consolidation_freeze(${corridaFoto}::uuid)`)

    // El mismo periodo para un grupo de dos filiales que deja fuera al
    // holding: la principal no es miembro, asi que sus asientos sin
    // etiquetar no se suman a nadie.
    const [g] = await sql<{ id: string }[]>`
      insert into public.consolidation_groups (tenant_id, name)
      values (${tenantA}, ${`Grupo Sin Matriz ${RUN}`}) returning id`
    await sql`
      insert into public.consolidation_group_members (tenant_id, group_id, company_id)
      values (${tenantA}, ${g!.id}, ${filialA}), (${tenantA}, ${g!.id}, ${terceraA})`
    const [r2] = await sql<{ id: string }[]>`
      insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
      values (${tenantA}, ${g!.id}, '2026-07-01', '2026-09-30') returning id`
    corridaSinMatriz = r2!.id
    await as(
      userA,
      tenantA,
      (tx) => tx`select public.consolidation_freeze(${corridaSinMatriz}::uuid)`,
    )
  })

  it('la foto es el acumulado: un asiento anterior al periodo tambien entra', async () => {
    const [fila] = await sql<{ total_credit: string }[]>`
      select total_credit::text from public.consolidation_run_balances
      where run_id = ${corridaFoto} and company_id = ${matrizA}
        and account_id = ${cuentaIngresoA}`
    // 50,000 de agosto + 1,000,000 de junio del ano pasado + 777,000 sin
    // empresa, que se leen como de la principal.
    expect(fila!.total_credit).toBe('1827000.00')
  })

  it('los asientos sin empresa se cuentan con la MISMA ventana que la foto', async () => {
    const [r] = await sql<
      { unlabeled_entries: number; unlabeled_amount: string; unlabeled_included: boolean }[]
    >`
      select unlabeled_entries, unlabeled_amount::text, unlabeled_included
      from public.consolidation_runs where id = ${corridaFoto}`
    expect(r!.unlabeled_entries).toBe(1)
    expect(r!.unlabeled_amount).toBe('777000.00')
    expect(r!.unlabeled_included).toBe(true)
  })

  it('con la principal fuera del grupo NO entran, y la corrida lo dice', async () => {
    const filas = await sql<{ id: string }[]>`
      select id from public.consolidation_run_balances
      where run_id = ${corridaSinMatriz} and company_id = ${matrizA}`
    expect(filas).toHaveLength(0)

    const [r] = await sql<{ unlabeled_entries: number; unlabeled_included: boolean }[]>`
      select unlabeled_entries, unlabeled_included
      from public.consolidation_runs where id = ${corridaSinMatriz}`
    expect(r!.unlabeled_entries).toBe(1)
    expect(r!.unlabeled_included).toBe(false)
  })

  it('una cuenta desactivada despues sigue en la hoja de la corrida que la uso', async () => {
    const [nueva] = await sql<{ id: string }[]>`
      insert into public.accounts (tenant_id, code, name, type, is_active)
      values (${tenantA}, ${`9${RUN.slice(0, 3)}`}, 'Dormida y sin movimiento', 'expense', false)
      returning id`
    await sql`update public.accounts set is_active = false where id = ${cuentaIngresoA}`

    const cuentas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`
        select id from public.consolidation_run_accounts(${corridaFoto}::uuid)`,
    )
    await sql`update public.accounts set is_active = true where id = ${cuentaIngresoA}`

    const ids = cuentas.map((c) => c.id)
    expect(ids).toContain(cuentaIngresoA)
    expect(ids).not.toContain(nueva!.id)
  })
})
