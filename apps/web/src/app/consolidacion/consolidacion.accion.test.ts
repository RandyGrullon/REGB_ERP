import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { generarCorrida } from './actions'

/**
 * generarCorrida() llamada DE VERDAD, contra la base de pruebas.
 *
 * supabase/tests/consolidation.test.ts llama a consolidation_freeze() a
 * mano. Lo que no fijaba nadie es que la ACCION la llame: si alguien
 * quita esa linea, la corrida nace vacia, la pantalla dice "0" y el
 * consolidado se entrega sin un peso. Eso es lo que prueba este archivo,
 * mas que la foto es una FOTO: un asiento contabilizado despues no la
 * mueve.
 */

let c: ClientePrueba
let matriz: string
let filial: string
let ingreso: string
let gasto: string
let grupo: string
let grupoSolo: string
let n = 0

async function asiento(empresa: string, fecha: string, monto: string): Promise<void> {
  n += 1
  const [e] = await db()<{ id: string }[]>`
    insert into public.journal_entries (tenant_id, number, description, entry_date, company_id)
    values (${c.tenantId}, ${`AS-${n}`}, 'Venta de mercancia', ${fecha}::date, ${empresa})
    returning id`
  // Borrador, lineas y DESPUES contabilizar: al reves la 0041 no deja
  // tocar las lineas.
  await db()`
    insert into public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit)
    values (${c.tenantId}, ${e!.id}, ${gasto}, ${monto}::numeric, 0),
           (${c.tenantId}, ${e!.id}, ${ingreso}, 0, ${monto}::numeric)`
  await db()`
    update public.journal_entries set status = 'posted', posted_at = now() where id = ${e!.id}`
}

async function corridas(groupId: string) {
  return db()<{ id: string; unlabeled_entries: number }[]>`
    select id, unlabeled_entries from public.consolidation_runs
    where tenant_id = ${c.tenantId} and group_id = ${groupId}`
}

async function foto(runId: string) {
  return db()<{ company_id: string; total_debit: string; total_credit: string }[]>`
    select company_id, total_debit::text, total_credit::text
    from public.consolidation_run_balances
    where run_id = ${runId} and account_id = ${ingreso}
    order by public.consolidation_run_balances.total_credit desc`
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-cons',
    nombre: 'Grupo Accion Consolida SRL',
    modulos: ['accounting', 'orgs', 'consolidation'],
    roles: {
      Consolidador: { 'consolidation.*': true, 'accounting.*': true, 'orgs.*': true },
    },
  })
  const sql = db()
  const [m] = await sql<{ id: string }[]>`
    insert into public.companies (tenant_id, legal_name, currency, is_default)
    values (${c.tenantId}, 'Matriz Accion SRL', 'DOP', true) returning id`
  const [f] = await sql<{ id: string }[]>`
    insert into public.companies (tenant_id, legal_name, currency)
    values (${c.tenantId}, 'Filial Accion SRL', 'DOP') returning id`
  matriz = m!.id
  filial = f!.id

  const [ci] = await sql<{ id: string }[]>`
    insert into public.accounts (tenant_id, code, name, type)
    values (${c.tenantId}, '4100', 'Ingresos por ventas', 'revenue') returning id`
  const [cg] = await sql<{ id: string }[]>`
    insert into public.accounts (tenant_id, code, name, type)
    values (${c.tenantId}, '5100', 'Costo de ventas', 'expense') returning id`
  ingreso = ci!.id
  gasto = cg!.id

  const [g] = await sql<{ id: string }[]>`
    insert into public.consolidation_groups (tenant_id, name, presentation_currency)
    values (${c.tenantId}, 'Grupo Accion', 'DOP') returning id`
  grupo = g!.id
  await sql`
    insert into public.consolidation_group_members (tenant_id, group_id, company_id, is_parent)
    values (${c.tenantId}, ${grupo}, ${matriz}, true), (${c.tenantId}, ${grupo}, ${filial}, false)`

  const [g1] = await sql<{ id: string }[]>`
    insert into public.consolidation_groups (tenant_id, name, presentation_currency)
    values (${c.tenantId}, 'Grupo de Una', 'DOP') returning id`
  grupoSolo = g1!.id
  await sql`
    insert into public.consolidation_group_members (tenant_id, group_id, company_id, is_parent)
    values (${c.tenantId}, ${grupoSolo}, ${matriz}, true)`

  // Dentro del periodo, y uno muy anterior: la foto es el acumulado.
  await asiento(matriz, '2026-08-10', '50000.00')
  await asiento(matriz, '2025-06-15', '1000000.00')
  await asiento(filial, '2026-09-01', '20000.00')
})

afterAll(async () => {
  // Los asientos contabilizados no se borran por diseño (0041). En vez de
  // apagar el trigger para TODOS -alter table es global y hay otras
  // pruebas corriendo-, se apagan solo en esta transaccion.
  await db().begin(async (tx) => {
    await tx.unsafe('set local session_replication_role = replica')
    for (const t of [
      'public.consolidation_run_balances',
      'public.consolidation_runs',
      'public.consolidation_group_members',
      'public.consolidation_groups',
      'public.journal_entry_lines',
      'public.journal_entries',
    ]) {
      await tx.unsafe(`delete from ${t} where tenant_id = $1`, [c.tenantId])
    }
  })
  await c.limpiar(['public.accounts', 'public.companies'])
  await cerrarBase()
})

describe('generarCorrida congela la foto', () => {
  let corrida: string

  it('crea la corrida y la foto trae el acumulado de cada empresa', async () => {
    const r = await generarCorrida(
      c.fd({ groupId: grupo, periodStart: '2026-07-01', periodEnd: '2026-09-30' }),
    )
    expect(r).toEqual({ ok: true })

    const rs = await corridas(grupo)
    expect(rs).toHaveLength(1)
    corrida = rs[0]!.id

    expect(await foto(corrida)).toEqual([
      { company_id: matriz, total_debit: '0.00', total_credit: '1050000.00' },
      { company_id: filial, total_debit: '0.00', total_credit: '20000.00' },
    ])
  })

  it('un asiento contabilizado DESPUES no mueve la foto', async () => {
    await asiento(matriz, '2026-09-15', '7000.00')
    expect(await foto(corrida)).toEqual([
      { company_id: matriz, total_debit: '0.00', total_credit: '1050000.00' },
      { company_id: filial, total_debit: '0.00', total_credit: '20000.00' },
    ])
  })

  it('emite consolidation.run.created', async () => {
    const [e] = await db()<{ c: string }[]>`
      select count(*)::text as c from public.event_outbox
      where tenant_id = ${c.tenantId} and type = 'consolidation.run.created'`
    expect(e!.c).toBe('1')
  })

  it('el mismo grupo y periodo no se genera dos veces', async () => {
    const r = await generarCorrida(
      c.fd({ groupId: grupo, periodStart: '2026-07-01', periodEnd: '2026-09-30' }),
    )
    expect(r).toEqual({ ok: false, error: 'Ese grupo ya tiene una corrida para ese mismo periodo.' })
    expect(await corridas(grupo)).toHaveLength(1)
  })

  it('un grupo de una sola empresa se niega y no deja corrida a medias', async () => {
    const r = await generarCorrida(
      c.fd({ groupId: grupoSolo, periodStart: '2026-07-01', periodEnd: '2026-09-30' }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/menos de dos empresas/)
    expect(await corridas(grupoSolo)).toHaveLength(0)
  })
})
