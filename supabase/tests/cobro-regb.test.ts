import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * La parte de BASE de 0128: la mora y las pruebas con dientes.
 *
 *  1. Una prueba de modulo vence: vencida, la RLS deja de dar sus filas
 *     (no las borra) y el menu del movil la quita. Sin fecha, recibe 14 dias.
 *  2. Activar un modulo de pago deja su instalacion pendiente, UNA vez;
 *     ni los core ni las pruebas.
 *  3. Pagar reactiva al cliente si ya no debe nada.
 *  4. "Solo lectura" impide escribir por PostgREST: con
 *     `rls.aplicar_estado_de_cuenta()` la transaccion no escribe, pero lee.
 *
 * La factura (uso, ITBIS, vencimiento, cobro de la instalacion) se prueba
 * generandola de verdad en apps/web/src/lib/factura-mensual.accion.test.ts.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const usuario = crypto.randomUUID()
let tenant: string

const claims = (userId: string, tenantId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { tenant_id: tenantId, is_provider: false } })

async function as<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(usuario, tenant)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

async function modulo(id: string, status: string, fin: string | null) {
  await sql.unsafe(
    `insert into regb.tenant_modules (tenant_id, module_id, status, enabled, trial_ends_at)
     values ($1, $2, $3, true, ${fin ?? 'null'})
     on conflict (tenant_id, module_id) do update
       set status = excluded.status, trial_ends_at = excluded.trial_ends_at`,
    [tenant, id, status],
  )
}

const canalesVisibles = () =>
  as((tx) => tx<{ n: number }[]>`select count(*)::int as n from public.chat_channels`).then(
    (r) => r[0]!.n,
  )

const enMenuMovil = (id: string) =>
  as((tx) => tx<{ module_id: string }[]>`select module_id from public.mis_modulos()`).then((r) =>
    r.some((m) => m.module_id === id),
  )

async function instalacion(id: string) {
  const [r] = await sql<{ amount: string | null }[]>`
    select amount::text from regb.module_installation_charges
    where tenant_id = ${tenant} and module_id = ${id}`
  return r
}

beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`cobro-${RUN}`}, 'Colmado Cobro Completo SRL', 'pyme', 'active') returning id`
  tenant = t!.id
  await modulo('chat', 'trial', 'current_date + 3')
  await sql`insert into public.chat_channels (tenant_id, name) values (${tenant}, 'General')`
})

afterAll(async () => {
  await sql`delete from regb.dunning_log where tenant_id = ${tenant}`
  await sql`delete from regb.payment_attempts where invoice_id in
    (select id from regb.invoices where tenant_id = ${tenant})`
  await sql`delete from regb.invoices where tenant_id = ${tenant}`
  await sql`delete from public.chat_channels where tenant_id = ${tenant}`
  await sql`delete from audit.log where tenant_id = ${tenant}`
  await sql`delete from regb.tenants where id = ${tenant}`
  await sql.end()
})

describe('Una prueba de modulo vence', () => {
  it('vigente, se usa', async () => {
    expect(await canalesVisibles()).toBe(1)
    expect(await enMenuMovil('chat')).toBe(true)
  })

  it('el ultimo dia todavia vale', async () => {
    await modulo('chat', 'trial', 'current_date')
    expect(await canalesVisibles()).toBe(1)
  })

  it('vencida, deja de verse por la RLS y del menu del movil', async () => {
    await modulo('chat', 'trial', 'current_date - 1')
    expect(await canalesVisibles()).toBe(0)
    expect(await enMenuMovil('chat')).toBe(false)
    const [r] = await as((tx) => tx<{ ok: boolean }[]>`select rls.module_active('chat') as ok`)
    expect(r!.ok).toBe(false)
  })

  it('...pero sus datos siguen ahi', async () => {
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.chat_channels where tenant_id = ${tenant}`
    expect(r!.n).toBe(1)
  })

  it('activado, vuelve con todo lo que tenia', async () => {
    await modulo('chat', 'active', 'current_date - 1')
    expect(await canalesVisibles()).toBe(1)
    expect(await enMenuMovil('chat')).toBe(true)
  })

  it('una prueba sin fecha no es eterna: recibe 14 dias', async () => {
    await modulo('crm', 'trial', null)
    const [r] = await sql<{ dias: number }[]>`
      select (trial_ends_at - current_date)::int as dias from regb.tenant_modules
      where tenant_id = ${tenant} and module_id = 'crm'`
    expect(r!.dias).toBe(14)
  })
})

describe('La instalacion de un modulo pagado queda pendiente, una vez', () => {
  it('activar un modulo de pago la deja pendiente de facturar', async () => {
    await modulo('inventory', 'active', null)
    expect(await instalacion('inventory')).toEqual({ amount: null })
  })

  it('un modulo core no se instala: viene con el plan', async () => {
    expect(await instalacion('products')).toBeUndefined()
  })

  it('en prueba no; al pasar a activo, si', async () => {
    await modulo('pos', 'trial', 'current_date + 5')
    expect(await instalacion('pos')).toBeUndefined()
    await modulo('pos', 'active', null)
    expect(await instalacion('pos')).toEqual({ amount: null })
  })

  it('el chat pasado a activo arriba tambien quedo pendiente', async () => {
    expect(await instalacion('chat')).toEqual({ amount: null })
  })

  it('apagar y volver a activar no instala de nuevo', async () => {
    // Como si la factura ya la hubiera cobrado.
    await sql`update regb.module_installation_charges set amount = 0, note = 'prueba'
              where tenant_id = ${tenant} and module_id = 'inventory'`
    await modulo('inventory', 'suspended', null)
    await modulo('inventory', 'active', null)
    const filas = await sql`
      select 1 from regb.module_installation_charges
      where tenant_id = ${tenant} and module_id = 'inventory'`
    expect(filas).toHaveLength(1)
    expect(await instalacion('inventory')).toEqual({ amount: '0.00' })
  })

  it('el cliente ve sus cargos de instalacion, no los toca', async () => {
    const filas = await as((tx) => tx`select module_id from regb.module_installation_charges`)
    expect(filas.length).toBeGreaterThan(0)
    await expect(
      as((tx) => tx`update regb.module_installation_charges set amount = 0`),
    ).rejects.toThrow(/permission denied/)
  })
})

async function facturaVencida(periodo: string): Promise<string> {
  const [f] = await sql<{ id: string }[]>`
    insert into regb.invoices
      (tenant_id, number, period_start, period_end, subtotal, discount, tax, total,
       currency, status, due_at, lines)
    values (${tenant}, regb.next_invoice_number(), ${periodo},
            (${periodo}::date + interval '1 month' - interval '1 day')::date,
            98, 0, 17.64, 115.64, 'USD', 'overdue', ${periodo}, '[]'::jsonb)
    returning id`
  return f!.id
}

const estado = async () => {
  const [t] = await sql<
    { status: string }[]
  >`select status::text from regb.tenants where id = ${tenant}`
  return t!.status
}

describe('Pagar reactiva al cliente', () => {
  it('si todavia debe otra factura, sigue en solo lectura', async () => {
    const vieja = await facturaVencida('2098-01-01')
    await facturaVencida('2098-02-01')
    await sql`update regb.tenants set status = 'readonly' where id = ${tenant}`

    await sql`select regb.record_payment(${vieja}, ${`manual-${vieja}`}, 'manual')`
    expect(await estado()).toBe('readonly')
  })

  it('con la ultima pagada, vuelve a active sin esperar al dunning', async () => {
    const [f] = await sql<{ id: string }[]>`
      select id from regb.invoices where tenant_id = ${tenant} and status = 'overdue'`
    await sql`select regb.record_payment(${f!.id}, ${`manual-${f!.id}`}, 'manual')`
    expect(await estado()).toBe('active')
  })
})

describe('Solo lectura impide escribir (PostgREST)', () => {
  const escribir = (tx: postgres.TransactionSql) => tx`
    insert into public.chat_channels (tenant_id, name) values (${tenant}, 'Otro canal')`

  it('al dia: la funcion no cambia nada y se escribe', async () => {
    await sql`update regb.tenants set status = 'active' where id = ${tenant}`
    await as(async (tx) => {
      await tx`select rls.aplicar_estado_de_cuenta()`
      await escribir(tx)
    })
    await sql`delete from public.chat_channels where tenant_id = ${tenant} and name = 'Otro canal'`
  })

  it('en solo lectura: lee, pero cualquier escritura se rechaza', async () => {
    await sql`update regb.tenants set status = 'readonly' where id = ${tenant}`
    try {
      const n = await as(async (tx) => {
        await tx`select rls.aplicar_estado_de_cuenta()`
        const [r] = await tx<{ n: number }[]>`select count(*)::int as n from public.chat_channels`
        return r!.n
      })
      expect(n).toBe(1)

      await expect(
        as(async (tx) => {
          await tx`select rls.aplicar_estado_de_cuenta()`
          await escribir(tx)
        }),
      ).rejects.toThrow(/read-only transaction/)

      // Tampoco por dentro de una funcion: la transaccion entera es de lectura.
      await expect(
        as(async (tx) => {
          await tx`select rls.aplicar_estado_de_cuenta()`
          await tx`select public.marcar_avisos_leidos()`
        }),
      ).rejects.toThrow(/read-only transaction/)
    } finally {
      await sql`update regb.tenants set status = 'active' where id = ${tenant}`
    }
  })
})
