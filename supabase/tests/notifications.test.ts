import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Avisos leidos por persona (0125) contra Postgres real.
 *
 * Hasta 0125 un aviso de equipo tenia UN `read_at` para todo el tenant:
 * el primero que lo leia se lo apagaba a los demas. Aqui se fija:
 *
 *  1. Dos personas del mismo cliente: una lee, la otra lo sigue viendo
 *     sin leer, en la lista y en la campana.
 *  2. Los avisos personales siguen funcionando, y ahora son privados:
 *     un companero no los ve ni los puede marcar.
 *  3. Nadie marca lecturas a nombre de otro.
 *  4. Aislamiento entre clientes: ni ver, ni marcar, ni colar una
 *     lectura apuntando al aviso de otro tenant.
 *  5. El evento que el manifiesto declara, `notifications.notice.sent`,
 *     se emite con y sin sesion, y no en bucle desde automatizaciones.
 *
 * Se llama a las MISMAS funciones que usan la pantalla, la campana y las
 * acciones (`mis_avisos`, `avisos_sin_leer`, `marcar_aviso_leido`,
 * `marcar_avisos_leidos`): lo que se prueba es lo que corre.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const ana = crypto.randomUUID() // gerente, tenant A
const luis = crypto.randomUUID() // cajero, tenant A
const pedro = crypto.randomUUID() // tenant B

let tenantA: string
let tenantB: string
let equipoA: string // aviso de equipo de A
let otroEquipoA: string
let personalAna: string
let equipoB: string

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

interface Aviso {
  id: string
  user_id: string | null
  read_at: Date | null
}

const misAvisos = (u: string, t: string) =>
  as(u, t, (tx) => tx<Aviso[]>`select id, user_id, read_at from public.mis_avisos(100)`)

const sinLeer = async (u: string, t: string) => {
  const [r] = await as(u, t, (tx) => tx<{ n: number }[]>`select public.avisos_sin_leer() as n`)
  return r!.n
}

const leida = (avisos: Aviso[], id: string) => avisos.find((a) => a.id === id)?.read_at ?? null

async function aviso(tenant: string, titulo: string, para: string | null = null) {
  // Como el despachador y REGB Control: dueno de las tablas, sin sesion.
  const [n] = await sql<{ id: string }[]>`
    insert into public.notifications (tenant_id, user_id, module_id, title, body, link)
    values (${tenant}, ${para}, 'pos', ${titulo}, 'La diferencia fue de 350.00.', '/pos/shifts')
    returning id`
  return n!.id
}

beforeAll(async () => {
  const [a] = await sql<{ id: string }[]>`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`avisos-a-${RUN}`}, 'Ferreteria Ochoa SRL', 'pyme', 'active') returning id`
  const [b] = await sql<{ id: string }[]>`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`avisos-b-${RUN}`}, 'Farmacia Los Mina SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  // `notifications` es core: nace provisionado. Se asegura por si acaso.
  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'notifications', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  equipoA = await aviso(tenantA, 'Falto efectivo en el cierre de caja')
  otroEquipoA = await aviso(tenantA, 'Hay un pedido entregado sin facturar')
  personalAna = await aviso(tenantA, 'Tu solicitud de vacaciones fue aprobada', ana)
  equipoB = await aviso(tenantB, 'Productos bajo el punto de reorden')
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.event_outbox where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Un aviso de equipo se lee por persona', () => {
  it('la fila ya no tiene un read_at compartido', async () => {
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'notifications' and column_name = 'read_at'`
    expect(cols).toEqual([])
  })

  it('al empezar, los dos lo ven sin leer', async () => {
    expect(leida(await misAvisos(ana, tenantA), equipoA)).toBeNull()
    expect(leida(await misAvisos(luis, tenantA), equipoA)).toBeNull()
    expect(await sinLeer(ana, tenantA)).toBe(3) // dos de equipo + su personal
    expect(await sinLeer(luis, tenantA)).toBe(2) // solo los de equipo
  })

  it('Ana lo lee: para ella queda leido y baja su campana', async () => {
    const [r] = await as(
      ana,
      tenantA,
      (tx) => tx<{ ok: boolean }[]>`
      select public.marcar_aviso_leido(${equipoA}) as ok`,
    )
    expect(r!.ok).toBe(true)

    expect(leida(await misAvisos(ana, tenantA), equipoA)).not.toBeNull()
    expect(await sinLeer(ana, tenantA)).toBe(2)
  })

  it('...y Luis lo sigue viendo sin leer, en la lista y en la campana', async () => {
    expect(leida(await misAvisos(luis, tenantA), equipoA)).toBeNull()
    expect(await sinLeer(luis, tenantA)).toBe(2)
  })

  it('la lista pone lo no leido primero, para cada quien', async () => {
    const deAna = await misAvisos(ana, tenantA)
    expect(deAna.at(-1)!.id).toBe(equipoA)
    const deLuis = await misAvisos(luis, tenantA)
    expect(
      deLuis
        .slice(0, 2)
        .map((a) => a.id)
        .sort(),
    ).toEqual([equipoA, otroEquipoA].sort())
  })

  it('marcarlo otra vez es un doble clic, no un error', async () => {
    const [r] = await as(
      ana,
      tenantA,
      (tx) => tx<{ ok: boolean }[]>`
      select public.marcar_aviso_leido(${equipoA}) as ok`,
    )
    expect(r!.ok).toBe(false)
    expect(await sinLeer(ana, tenantA)).toBe(2)
  })

  it('"marcar todas" de Luis solo cuenta para Luis', async () => {
    const [r] = await as(
      luis,
      tenantA,
      (tx) => tx<{ n: number }[]>`
      select public.marcar_avisos_leidos() as n`,
    )
    expect(r!.n).toBe(2)
    expect(await sinLeer(luis, tenantA)).toBe(0)

    // Ana leyo uno solo; el otro de equipo y su personal siguen ahi.
    expect(await sinLeer(ana, tenantA)).toBe(2)
    expect(leida(await misAvisos(ana, tenantA), otroEquipoA)).toBeNull()
  })

  it('un aviso nuevo de equipo llega sin leer a los dos', async () => {
    const nuevo = await aviso(tenantA, 'Sobro efectivo en el cierre de caja')
    expect(leida(await misAvisos(ana, tenantA), nuevo)).toBeNull()
    expect(leida(await misAvisos(luis, tenantA), nuevo)).toBeNull()
    expect(await sinLeer(luis, tenantA)).toBe(1)
  })
})

describe('Avisos personales', () => {
  it('siguen funcionando: Ana ve el suyo y lo marca', async () => {
    expect(leida(await misAvisos(ana, tenantA), personalAna)).toBeNull()
    const [r] = await as(
      ana,
      tenantA,
      (tx) => tx<{ ok: boolean }[]>`
      select public.marcar_aviso_leido(${personalAna}) as ok`,
    )
    expect(r!.ok).toBe(true)
    expect(leida(await misAvisos(ana, tenantA), personalAna)).not.toBeNull()
  })

  it('son privados: Luis no lo ve, ni pidiendo la tabla por su id', async () => {
    expect((await misAvisos(luis, tenantA)).map((a) => a.id)).not.toContain(personalAna)
    const filas = await as(
      luis,
      tenantA,
      (tx) => tx`
      select id from public.notifications where id = ${personalAna}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('Luis no puede marcarlo: por la funcion no lo encuentra', async () => {
    const [r] = await as(
      luis,
      tenantA,
      (tx) => tx<{ ok: boolean }[]>`
      select public.marcar_aviso_leido(${personalAna}) as ok`,
    )
    expect(r!.ok).toBe(false)
  })

  it('...y por SQL directo lo rechaza la base', async () => {
    await expect(
      as(
        luis,
        tenantA,
        (tx) => tx`
        insert into public.notification_reads (tenant_id, notification_id, user_id)
        values (${tenantA}, ${personalAna}, ${luis})`,
      ),
    ).rejects.toThrow(/personal de otra persona/)
  })

  it('escribirle un aviso a un companero sigue permitido', async () => {
    // Sin `returning`: Ana puede escribirlo, pero no leerlo de vuelta.
    await as(
      ana,
      tenantA,
      (tx) => tx`
      insert into public.notifications (tenant_id, user_id, module_id, title)
      values (${tenantA}, ${luis}, 'pos', 'Cuenta la caja 2 antes de cerrar')`,
    )
    const deLuis = await misAvisos(luis, tenantA)
    expect(deLuis.some((a) => a.user_id === luis && a.read_at === null)).toBe(true)
    expect((await misAvisos(ana, tenantA)).some((a) => a.user_id === luis)).toBe(false)
  })
})

describe('Nadie marca por otro', () => {
  it('Ana no puede registrar una lectura a nombre de Luis', async () => {
    await expect(
      as(
        ana,
        tenantA,
        (tx) => tx`
        insert into public.notification_reads (tenant_id, notification_id, user_id)
        values (${tenantA}, ${otroEquipoA}, ${luis})`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('cada quien ve solo sus lecturas', async () => {
    const deAna = await as(
      ana,
      tenantA,
      (tx) => tx<{ user_id: string }[]>`
      select user_id from public.notification_reads`,
    )
    expect(deAna.length).toBeGreaterThan(0)
    expect(new Set(deAna.map((r) => r.user_id))).toEqual(new Set([ana]))
  })
})

describe('Aislamiento entre clientes', () => {
  it('B no ve los avisos de A, ni A los de B', async () => {
    const deB = (await misAvisos(pedro, tenantB)).map((a) => a.id)
    expect(deB).toEqual([equipoB])
    expect((await misAvisos(ana, tenantA)).map((a) => a.id)).not.toContain(equipoB)
    expect(await sinLeer(pedro, tenantB)).toBe(1)
  })

  it('B no puede marcar un aviso de A: la funcion no lo encuentra', async () => {
    const [r] = await as(
      pedro,
      tenantB,
      (tx) => tx<{ ok: boolean }[]>`
      select public.marcar_aviso_leido(${otroEquipoA}) as ok`,
    )
    expect(r!.ok).toBe(false)
    expect(leida(await misAvisos(ana, tenantA), otroEquipoA)).toBeNull()
  })

  it('B no puede colar una lectura con su tenant apuntando al aviso de A', async () => {
    // La clave foranea es (tenant, aviso): (B, aviso de A) no existe.
    await expect(
      as(
        pedro,
        tenantB,
        (tx) => tx`
        insert into public.notification_reads (tenant_id, notification_id, user_id)
        values (${tenantB}, ${otroEquipoA}, ${pedro})`,
      ),
    ).rejects.toThrow(/notification_reads_aviso_del_mismo_tenant/)
  })

  it('ni con el tenant de A en la fila', async () => {
    await expect(
      as(
        pedro,
        tenantB,
        (tx) => tx`
        insert into public.notification_reads (tenant_id, notification_id, user_id)
        values (${tenantA}, ${otroEquipoA}, ${pedro})`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('B no ve las lecturas de A', async () => {
    const filas = await as(
      pedro,
      tenantB,
      (tx) => tx`
      select 1 from public.notification_reads where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('con el modulo apagado no hay bandeja ni campana', async () => {
    await sql`update regb.tenant_modules set enabled = false
              where tenant_id = ${tenantB} and module_id = 'notifications'`
    try {
      expect(await misAvisos(pedro, tenantB)).toEqual([])
      expect(await sinLeer(pedro, tenantB)).toBe(0)
    } finally {
      await sql`update regb.tenant_modules set enabled = true
                where tenant_id = ${tenantB} and module_id = 'notifications'`
    }
  })
})

describe('Borrar un aviso', () => {
  it('se lleva sus lecturas, de todos', async () => {
    const id = await aviso(tenantA, 'Aviso que se va a borrar')
    await as(ana, tenantA, (tx) => tx`select public.marcar_aviso_leido(${id})`)
    await as(luis, tenantA, (tx) => tx`select public.marcar_aviso_leido(${id})`)
    await sql`delete from public.notifications where id = ${id}`
    const [r] = await sql<{ n: string }[]>`
      select count(*)::text as n from public.notification_reads where notification_id = ${id}`
    expect(Number(r!.n)).toBe(0)
  })
})

describe('Evento notifications.notice.sent', () => {
  const eventosDe = (id: string) =>
    sql<{ tenant_id: string; emitted_by: string; payload: Record<string, unknown> }[]>`
      select tenant_id::text, emitted_by, payload from public.event_outbox
      where type = 'notifications.notice.sent' and payload ->> 'notificationId' = ${id}`

  it('se emite cuando escribe el sistema, sin sesion', async () => {
    const eventos = await eventosDe(equipoA)
    expect(eventos).toHaveLength(1)
    expect(eventos[0]!.tenant_id).toBe(tenantA)
    expect(eventos[0]!.emitted_by).toBe('notifications')
    expect(eventos[0]!.payload).toMatchObject({
      moduleId: 'pos',
      userId: null,
      title: 'Falto efectivo en el cierre de caja',
      link: '/pos/shifts',
    })
    // El cuerpo no viaja: es lo que mas facil lleva un monto.
    expect(eventos[0]!.payload).not.toHaveProperty('body')
  })

  it('se emite tambien cuando escribe un usuario, por emit_event()', async () => {
    const [n] = await as(
      ana,
      tenantA,
      (tx) => tx<{ id: string }[]>`
      insert into public.notifications (tenant_id, module_id, title)
      values (${tenantA}, 'pos', 'Recuerda el arqueo del sabado')
      returning id`,
    )
    const eventos = await eventosDe(n!.id)
    expect(eventos).toHaveLength(1)
    expect(eventos[0]!.tenant_id).toBe(tenantA)
  })

  it('un aviso de automatizaciones no emite: una regla no se alimenta a si misma', async () => {
    const [n] = await sql<{ id: string }[]>`
      insert into public.notifications (tenant_id, module_id, title)
      values (${tenantA}, 'automations', 'Regla: pedido grande') returning id`
    expect(await eventosDe(n!.id)).toHaveLength(0)
  })

  it('B no ve los eventos de avisos de A', async () => {
    const filas = await as(
      pedro,
      tenantB,
      (tx) => tx`
      select 1 from public.event_outbox
      where type = 'notifications.notice.sent' and tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })
})
