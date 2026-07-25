/**
 * Tests del bus de eventos contra Postgres real.
 *
 * La politica de reintentos se prueba sin base de datos en
 * @regb/core/events.test.ts. Aqui verificamos lo que solo se puede
 * verificar con un motor de verdad: aislamiento por tenant, el reclamo
 * concurrente y que emitir dentro de una transaccion fallida no deje rastro.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

let tenantA: string
let tenantB: string
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()

const claims = (userId: string, tenantId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { tenant_id: tenantId, is_provider: false } })

async function as<T>(jwt: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${jwt}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

/** Slugs unicos por corrida: el test no depende del estado previo. */
const RUN = crypto.randomUUID().slice(0, 8)

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ev-a-${RUN}`}, 'Ferreteria El Martillo SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ev-b-${RUN}`}, 'Textiles Duarte SRL', 'mediano', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id
})

afterAll(async () => {
  await sql`delete from public.event_outbox where tenant_id in (${tenantA}, ${tenantB})`
  await sql`delete from regb.tenants where id in (${tenantA}, ${tenantB})`
  await sql.end()
})

describe('Emision', () => {
  it('emit_event escribe en el outbox del tenant que emite', async () => {
    const [r] = await as(
      claims(userA, tenantA),
      (tx) =>
        tx<{ id: string }[]>`
        select public.emit_event('sales.order.confirmed',
          '{"orderId":"A-1","total":872.00}'::jsonb, 'sales') as id`,
    )
    expect(r!.id).toBeTruthy()

    const [row] = await sql`
      select tenant_id, type, emitted_by, attempts, processed_at, dead_lettered_at
      from public.event_outbox where id = ${r!.id}`
    expect(row!.tenant_id).toBe(tenantA)
    expect(row!.type).toBe('sales.order.confirmed')
    expect(row!.attempts).toBe(0)
    expect(row!.processed_at).toBeNull()
    expect(row!.dead_lettered_at).toBeNull()
  })

  it('rechaza un tipo que no siga <modulo>.<entidad>.<accion>', async () => {
    await expect(
      as(
        claims(userA, tenantA),
        (tx) => tx`select public.emit_event('OrderConfirmed', '{}'::jsonb, 'sales')`,
      ),
    ).rejects.toThrow(/Formato/)
  })

  it('no se puede emitir sin tenant en el JWT', async () => {
    await expect(
      as(
        JSON.stringify({ sub: userA, app_metadata: {} }),
        (tx) => tx`select public.emit_event('sales.order.confirmed', '{}'::jsonb, 'sales')`,
      ),
    ).rejects.toThrow(/sin tenant/)
  })

  it('si la transaccion de negocio falla, el evento tampoco existe', async () => {
    // Toda la gracia del patron outbox: atomicidad entre el cambio y su evento.
    const marca = crypto.randomUUID()
    await expect(
      as(claims(userA, tenantA), async (tx) => {
        await tx`select public.emit_event('sales.order.confirmed',
          ${sql.json({ marca })}::jsonb, 'sales')`
        throw new Error('el negocio fallo despues de emitir')
      }),
    ).rejects.toThrow()

    const rows = await sql`
      select id from public.event_outbox
      where tenant_id = ${tenantA} and payload->>'marca' = ${marca}`
    expect(rows).toHaveLength(0)
  })
})

describe('Aislamiento del outbox', () => {
  it('un tenant no ve los eventos de otro', async () => {
    await as(
      claims(userB, tenantB),
      (tx) => tx`select public.emit_event('sales.order.confirmed', '{"b":1}'::jsonb, 'sales')`,
    )

    const ajenos = await as(
      claims(userA, tenantA),
      (tx) => tx`select id from public.event_outbox where tenant_id = ${tenantB}`,
    )
    expect(ajenos).toHaveLength(0)

    const propios = await as(
      claims(userA, tenantA),
      (tx) => tx<{ tenant_id: string }[]>`select tenant_id from public.event_outbox`,
    )
    expect(propios.every((r) => r.tenant_id === tenantA)).toBe(true)
  })

  it('claim_events no esta expuesta a los clientes', async () => {
    await expect(
      as(claims(userA, tenantA), (tx) => tx`select * from public.claim_events(10)`),
    ).rejects.toThrow(/permission denied|no existe|does not exist/i)
  })
})

describe('Despacho', () => {
  it('claim_events reclama pendientes e incrementa el intento', async () => {
    const antes = await sql<{ id: string }[]>`
      select id from public.event_outbox
      where tenant_id = ${tenantA} and processed_at is null and dead_lettered_at is null`

    const lote = await sql`select * from public.claim_events(100)`
    expect(lote.length).toBeGreaterThanOrEqual(antes.length)
    expect(lote.every((r) => r.attempts >= 1)).toBe(true)
  })

  it('un evento reclamado no vuelve a salir hasta que venza su backoff', async () => {
    const [ev] = await sql`
      insert into public.event_outbox (tenant_id, type, payload, emitted_by, correlation_id)
      values (${tenantA}, 'inventory.stock.low', '{}'::jsonb, 'inventory', gen_random_uuid())
      returning id`

    await sql`select public.claim_events(100)`
    // Falla y reintenta en 2 minutos.
    await sql`select public.settle_event(${ev!.id}::bigint, false, 'timeout', 120)`

    const lote = await sql<{ id: string }[]>`select id from public.claim_events(100)`
    expect(lote.map((r) => String(r.id))).not.toContain(String(ev!.id))
  })

  it('settle_event con exito cierra el evento', async () => {
    const [ev] = await sql`
      insert into public.event_outbox (tenant_id, type, payload, emitted_by, correlation_id)
      values (${tenantA}, 'sales.invoice.paid', '{}'::jsonb, 'sales', gen_random_uuid())
      returning id`

    await sql`select public.settle_event(${ev!.id}::bigint, true)`

    const [row] = await sql`
      select processed_at, last_error from public.event_outbox where id = ${ev!.id}`
    expect(row!.processed_at).not.toBeNull()
    expect(row!.last_error).toBeNull()
  })

  it('un evento agotado va a dead-letter y NO se borra', async () => {
    const [ev] = await sql`
      insert into public.event_outbox (tenant_id, type, payload, emitted_by, correlation_id, attempts)
      values (${tenantA}, 'sales.order.cancelled', '{}'::jsonb, 'sales', gen_random_uuid(), 5)
      returning id`

    await sql`select public.settle_event(${ev!.id}::bigint, false, 'el manejador nunca respondio', null)`

    const [row] = await sql`
      select dead_lettered_at, last_error from public.event_outbox where id = ${ev!.id}`
    expect(row!.dead_lettered_at).not.toBeNull()
    expect(row!.last_error).toContain('nunca respondio')

    // Y ya no se reclama.
    const lote = await sql<{ id: string }[]>`select id from public.claim_events(100)`
    expect(lote.map((r) => String(r.id))).not.toContain(String(ev!.id))
  })
})
