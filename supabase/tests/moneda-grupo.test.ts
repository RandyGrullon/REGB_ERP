import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * La moneda de una empresa que ya consolida (0119) contra Postgres real.
 *
 * 0117 impedia que una empresa en otra moneda ENTRARA al grupo y que el
 * GRUPO cambiara de moneda con miembros dentro. Quedaba la otra puerta:
 * cambiarle la moneda a la empresa ya miembro. Aqui se prueba:
 *
 *  1. Que esa puerta este cerrada, por SQL directo y como usuario, y aun
 *     con el modulo consolidation apagado -la RLS esconderia los grupos y
 *     un trigger sin security definer dejaria pasar el cambio-.
 *  2. Que una empresa que salio del grupo pero ya figura en un consolidado
 *     CERRADO -en la foto o solo en una eliminacion- tampoco cambie.
 *  3. Que el camino legitimo siga abierto: una empresa que no esta en
 *     ningun grupo, o que salio sin dejar huella en nada entregado, cambia
 *     sin problema; y editar otras columnas de un miembro no se estorba.
 *  4. Aislamiento: B no toca las empresas de A, ni A las de B.
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
let sueltaA: string
let salienteA: string
let sociaA: string
let pasajeraA: string
let empresaB: string
let grupoA: string

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

async function monedaDe(id: string) {
  const [c] = await sql<{ currency: string }[]>`
    select currency from public.companies where id = ${id}`
  return c!.currency
}

async function empresa(tenant: string, nombre: string, principal = false) {
  const [c] = await sql<{ id: string }[]>`
    insert into public.companies (tenant_id, legal_name, currency, is_default)
    values (${tenant}, ${nombre}, 'DOP', ${principal}) returning id`
  return c!.id
}

async function miembro(tenant: string, grupo: string, company: string, matriz = false) {
  await sql`
    insert into public.consolidation_group_members (tenant_id, group_id, company_id, is_parent)
    values (${tenant}, ${grupo}, ${company}, ${matriz})`
}

beforeAll(async () => {
  const slugA = 'mongr-a-' + RUN
  const slugB = 'mongr-b-' + RUN
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${slugA}, 'Moneda Grupo A SRL', 'grande', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${slugB}, 'Moneda Grupo B SRL', 'grande', 'active') returning id`
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

  matrizA = await empresa(tenantA, 'Matriz Moneda SRL', true)
  filialA = await empresa(tenantA, 'Filial Moneda SRL')
  sueltaA = await empresa(tenantA, 'Suelta Sin Grupo SRL')
  salienteA = await empresa(tenantA, 'Saliente Con Historia SRL')
  sociaA = await empresa(tenantA, 'Socia Solo Eliminada SRL')
  pasajeraA = await empresa(tenantA, 'Pasajera Sin Huella SRL')
  empresaB = await empresa(tenantB, 'Empresa Ajena Moneda SRL', true)

  const [ci] = await sql<{ id: string }[]>`
    insert into public.accounts (tenant_id, code, name, type)
    values (${tenantA}, '4100', 'Ingresos por ventas', 'revenue') returning id`
  const [cg] = await sql<{ id: string }[]>`
    insert into public.accounts (tenant_id, code, name, type)
    values (${tenantA}, '5100', 'Costo de ventas', 'expense') returning id`

  const [ga] = await sql<{ id: string }[]>`
    insert into public.consolidation_groups (tenant_id, name, presentation_currency)
    values (${tenantA}, 'Grupo Moneda', 'DOP') returning id`
  const [gb] = await sql<{ id: string }[]>`
    insert into public.consolidation_groups (tenant_id, name, presentation_currency)
    values (${tenantB}, 'Grupo Ajeno Moneda', 'DOP') returning id`
  grupoA = ga!.id

  await miembro(tenantA, grupoA, matrizA, true)
  await miembro(tenantA, grupoA, filialA)
  await miembro(tenantA, grupoA, salienteA)
  await miembro(tenantA, grupoA, sociaA)
  await miembro(tenantA, grupoA, pasajeraA)
  await miembro(tenantB, gb!.id, empresaB, true)

  // Un consolidado entregado donde la saliente aporta a la foto y la socia
  // solo aparece en una eliminacion: son las dos formas de "figurar" en
  // algo cerrado, y el trigger tiene que ver las dos.
  const [rc] = await sql<{ id: string }[]>`
    insert into public.consolidation_runs (tenant_id, group_id, period_start, period_end)
    values (${tenantA}, ${grupoA}, '2025-01-01', '2025-12-31') returning id`
  await sql`
    insert into public.consolidation_run_balances
      (tenant_id, run_id, company_id, account_id, total_credit)
    values (${tenantA}, ${rc!.id}, ${salienteA}, ${ci!.id}, 500000)`
  await sql`
    insert into public.consolidation_eliminations
      (tenant_id, run_id, from_company_id, to_company_id,
       debit_account_id, credit_account_id, amount, description)
    values (${tenantA}, ${rc!.id}, ${matrizA}, ${sociaA},
            ${ci!.id}, ${cg!.id}, 120000, 'Venta entre empresas del 2025')`
  await sql`
    update public.consolidation_runs set status = 'closed', closed_at = now()
    where id = ${rc!.id}`

  // Salen del grupo despues de entregado: sacar la empresa NO borra su
  // huella en el consolidado cerrado, y eso es lo que se prueba.
  await sql`
    delete from public.consolidation_group_members
    where group_id = ${grupoA} and company_id in ${sql([salienteA, sociaA, pasajeraA])}`
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  // Mismo motivo que consolidation.test.ts: una corrida cerrada no se
  // borra con un DELETE normal y estos son clientes de PRUEBA.
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
  await sql`delete from public.accounts where tenant_id in ${sql(ts)}`
  await sql`delete from public.companies where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('La puerta cerrada: una empresa miembro no cambia de moneda', () => {
  it('por SQL directo, con el mismo errcode que el grupo (55000)', async () => {
    await expect(
      sql`update public.companies set currency = 'USD' where id = ${filialA}`,
    ).rejects.toMatchObject({ code: '55000', message: expect.stringMatching(/no traduce moneda/) })
    expect(await monedaDe(filialA)).toBe('DOP')
  })

  it('el mensaje dice en que grupo esta y que hacer', async () => {
    await expect(
      sql`update public.companies set currency = 'USD' where id = ${filialA}`,
    ).rejects.toThrow(/Grupo Moneda.*presenta en DOP.*Sacala del grupo/)
  })

  it('como usuario del cliente, igual', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.companies set currency = 'USD' where id = ${filialA}`),
    ).rejects.toThrow(/no traduce moneda/)
    expect(await monedaDe(filialA)).toBe('DOP')
  })

  it('con el modulo consolidation apagado, la puerta sigue cerrada', async () => {
    await modulo(tenantA, 'consolidation', false)
    try {
      // Apagado, A no ve sus propios grupos: prueba de que el trigger no
      // depende de lo que la RLS le deja ver al usuario.
      const grupos = await as(userA, tenantA, (tx) =>
        tx<{ id: string }[]>`select id from public.consolidation_groups`)
      expect(grupos).toHaveLength(0)
      await expect(
        as(userA, tenantA, (tx) => tx`
          update public.companies set currency = 'USD' where id = ${filialA}`),
      ).rejects.toThrow(/no traduce moneda/)
    } finally {
      await modulo(tenantA, 'consolidation', true)
    }
    expect(await monedaDe(filialA)).toBe('DOP')
  })
})

describe('Lo entregado tampoco: consolidados cerrados', () => {
  it('salio del grupo, pero su foto esta en un consolidado cerrado: no cambia', async () => {
    await expect(
      sql`update public.companies set currency = 'USD' where id = ${salienteA}`,
    ).rejects.toMatchObject({
      code: '55000',
      message: expect.stringMatching(/consolidados cerrados en DOP/),
    })
    expect(await monedaDe(salienteA)).toBe('DOP')
  })

  it('solo figura en una eliminacion cerrada: tampoco cambia', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.companies set currency = 'USD' where id = ${sociaA}`),
    ).rejects.toThrow(/consolidados cerrados/)
    expect(await monedaDe(sociaA)).toBe('DOP')
  })
})

describe('El camino legitimo sigue abierto', () => {
  it('una empresa que no esta en ningun grupo cambia de moneda sin problema', async () => {
    const filas = await as(userA, tenantA, (tx) => tx`
      update public.companies set currency = 'USD' where id = ${sueltaA} returning id`)
    expect(filas).toHaveLength(1)
    expect(await monedaDe(sueltaA)).toBe('USD')
  })

  it('una empresa que salio del grupo sin dejar huella en nada cerrado, tambien', async () => {
    await sql`update public.companies set currency = 'USD' where id = ${pasajeraA}`
    expect(await monedaDe(pasajeraA)).toBe('USD')
  })

  it('a un miembro se le edita el nombre sin que el trigger estorbe', async () => {
    await as(userA, tenantA, (tx) => tx`
      update public.companies set trade_name = 'Filial Renombrada' where id = ${filialA}`)
    const [c] = await sql<{ trade_name: string }[]>`
      select trade_name from public.companies where id = ${filialA}`
    expect(c!.trade_name).toBe('Filial Renombrada')
  })

  it('reescribir la MISMA moneda en un miembro no es un cambio', async () => {
    await sql`update public.companies set currency = 'DOP' where id = ${filialA}`
    expect(await monedaDe(filialA)).toBe('DOP')
  })
})

describe('Aislamiento entre clientes', () => {
  it('A no ve, no edita ni borra las empresas de B', async () => {
    const [vistas, editadas, borradas] = await as(userA, tenantA, async (tx) => {
      const v = await tx`select id from public.companies where id = ${empresaB}`
      const e = await tx`
        update public.companies set currency = 'USD' where id = ${empresaB} returning id`
      const d = await tx`delete from public.companies where id = ${empresaB} returning id`
      return [v, e, d] as const
    })
    expect(vistas).toHaveLength(0)
    expect(editadas).toHaveLength(0)
    expect(borradas).toHaveLength(0)
    expect(await monedaDe(empresaB)).toBe('DOP')
  })

  it('B no le cambia la moneda a una empresa suelta de A', async () => {
    const filas = await as(userB, tenantB, (tx) => tx`
      update public.companies set currency = 'EUR' where id = ${sueltaA} returning id`)
    expect(filas).toHaveLength(0)
    expect(await monedaDe(sueltaA)).toBe('USD')
  })

  it('el grupo de B no frena a A: la regla mira solo los grupos de la propia empresa', async () => {
    // La pasajera de A ya esta fuera de todo grupo; que B tenga un grupo
    // en DOP no le importa.
    await as(userA, tenantA, (tx) => tx`
      update public.companies set currency = 'DOP' where id = ${pasajeraA}`)
    expect(await monedaDe(pasajeraA)).toBe('DOP')
  })
})
