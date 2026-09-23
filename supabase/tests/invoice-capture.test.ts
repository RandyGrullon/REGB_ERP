import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * `invoice-capture` no se vende mientras no exista (0124), contra Postgres real.
 *
 * El modulo tiene manifiesto, precio y ficha, y nada mas: ni tablas ni
 * pantallas. Estaba publicado y activo en la demo, y REGB Control le
 * cobraba la mensualidad. Aqui se fija:
 *
 *  1. Que sale del escaparate sin perder su precio -es el que tendra-.
 *  2. Que ningun cliente lo tiene activo ni en prueba, y que la base se
 *     niega a activarlo por cualquier camino: alta nueva, prueba, o
 *     reactivar una licencia archivada.
 *  3. Que no queda ninguna solicitud pendiente que lo traiga de vuelta.
 *
 * Que el motor de facturacion no lo cobre se prueba llamando al motor de
 * verdad, en apps/web/src/lib/cobro-invoice-capture.accion.test.ts.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
let tenant: string

const NO_EXISTE = /todavia no existe/

beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`invcap-${RUN}`}, 'Contadores Asociados del Cibao SRL', 'mediano', 'active')
    returning id`
  tenant = t!.id
})

afterAll(async () => {
  await sql`delete from regb.tenants where id = ${tenant}`
  await sql.end()
})

describe('Fuera del escaparate', () => {
  it('sigue en el catalogo, sin publicar', async () => {
    const [m] = await sql<{ is_published: boolean; setup_minutes: number | null }[]>`
      select is_published, setup_minutes from regb.module_catalog where id = 'invoice-capture'`
    expect(m).toBeDefined()
    expect(m!.is_published).toBe(false)
    // 15 minutos de puesta en marcha de algo que no se puede poner en marcha.
    expect(m!.setup_minutes).toBeNull()
  })

  it('conserva su precio de advanced en los 3 tiers: es el que tendra', async () => {
    const precios = await sql<{ tier: string; install_price: string; monthly_price: string }[]>`
      select mp.tier::text as tier, mp.install_price::text as install_price,
             mp.monthly_price::text as monthly_price
      from regb.module_pricing mp where mp.module_id = 'invoice-capture' order by mp.tier`
    expect(precios.map((p) => [p.tier, Number(p.install_price), Number(p.monthly_price)])).toEqual([
      ['pyme', 400, 45],
      ['mediano', 1500, 160],
      ['grande', 4000, 420],
    ])
  })

  it('la ficha ya no afirma una tasa de acierto que nadie midio', async () => {
    const [m] = await sql<{ faq: { p: string; r: string }[] }[]>`
      select faq from regb.module_catalog where id = 'invoice-capture'`
    // Con o sin tildes: la 0134 corrige la ortografia del catalogo y lo que
    // esta prueba vigila es lo que la ficha AFIRMA, no como se escribe.
    const lee = m!.faq.find((f) => /^¿Qu[eé] tan bien lee\?$/.test(f.p))
    expect(lee?.r).toMatch(/Todav[ií]a no est[aá] construido/)
    expect(lee?.r).not.toMatch(/acierta casi siempre/)
  })
})

describe('Nadie lo tiene y la base no deja tenerlo', () => {
  it('ningun cliente lo tiene activo ni en prueba', async () => {
    const vivos = await sql<{ slug: string; status: string }[]>`
      select t.slug, tm.status::text
      from regb.tenant_modules tm join regb.tenants t on t.id = tm.tenant_id
      where tm.module_id = 'invoice-capture' and tm.status in ('active', 'trial')`
    expect(vivos).toEqual([])
  })

  it('no se puede activar', async () => {
    await expect(sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${tenant}, 'invoice-capture', 'active', true)`).rejects.toThrow(NO_EXISTE)
  })

  it('ni siquiera en prueba, que es lo que hace "Activar solicitud" en el panel', async () => {
    await expect(sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled, trial_ends_at)
      values (${tenant}, 'invoice-capture', 'trial', true, current_date + 14)`).rejects.toThrow(
      NO_EXISTE,
    )
  })

  it('ni reactivando una licencia archivada', async () => {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled, archived_at)
      values (${tenant}, 'invoice-capture', 'archived', true, now())`
    await expect(sql`
      update regb.tenant_modules set status = 'active'
      where tenant_id = ${tenant} and module_id = 'invoice-capture'`).rejects.toThrow(NO_EXISTE)
    // El upsert de activarSolicitud() tampoco la cuela por el `on conflict`.
    await expect(sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${tenant}, 'invoice-capture', 'trial', true)
      on conflict (tenant_id, module_id) do update set status = 'trial'`).rejects.toThrow(NO_EXISTE)

    const [r] = await sql<{ status: string }[]>`
      select status::text from regb.tenant_modules
      where tenant_id = ${tenant} and module_id = 'invoice-capture'`
    expect(r!.status).toBe('archived')
  })

  it('y apagar o encender una licencia archivada no la revive ni falla', async () => {
    // La guarda mira el estado, no `enabled`: el cliente puede tocar su
    // interruptor sin que eso sea una activacion.
    await sql`
      update regb.tenant_modules set enabled = false
      where tenant_id = ${tenant} and module_id = 'invoice-capture'`
    const [r] = await sql<{ status: string; enabled: boolean }[]>`
      select status::text, enabled from regb.tenant_modules
      where tenant_id = ${tenant} and module_id = 'invoice-capture'`
    expect(r).toEqual({ status: 'archived', enabled: false })
  })

  it('la guarda es solo suya: otro modulo advanced se activa normal', async () => {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${tenant}, 'payroll', 'active', true)`
    const [r] = await sql<{ status: string }[]>`
      select status::text from regb.tenant_modules
      where tenant_id = ${tenant} and module_id = 'payroll'`
    expect(r!.status).toBe('active')
  })
})

describe('Solicitudes', () => {
  it('no queda ninguna pendiente que lo traiga de vuelta al activarla', async () => {
    const [r] = await sql<{ n: string }[]>`
      select count(*)::text as n from regb.activation_requests
      where status = 'pending' and 'invoice-capture' = any (modules)`
    expect(Number(r!.n)).toBe(0)
  })
})
