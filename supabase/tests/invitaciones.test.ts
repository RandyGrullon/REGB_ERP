/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Invitaciones de usuarios (0123)
 *
 *  Antes: invitar insertaba una membresia con un `user_id` INVENTADO
 *  (`crypto.randomUUID()`), no mandaba nada y nadie podia aceptarla. Y
 *  `public.invite_member()` (0008) hacia lo mismo desde PostgREST.
 *
 *  Ahora: invitar crea una fila en `user_invitations` con el token
 *  guardado como HASH. La membresia nace SOLO cuando alguien con sesion
 *  real acepta, y nace con SU `user_id` -el `sub` del token-, nunca con
 *  uno fabricado. Aqui se comprueba eso y que ningun cliente ve, toca ni
 *  acepta las invitaciones de otro.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)

let tenantA: string
let tenantB: string
let ownerA: string
let cajeroA: string
let ownerB: string

const adminA = crypto.randomUUID()
const adminB = crypto.randomUUID()
const cajeroUsuario = crypto.randomUUID()

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

interface Claims {
  sub?: string
  email?: string
  app_metadata: { tenant_id?: string | null; role_id?: string; is_provider: boolean }
}

/** Corre `fn` como `authenticated` con esos claims: la RLS decide. */
function como<T>(claims: Claims, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

const admin = (tenant: string, rol: string, sub = adminA): Claims => ({
  sub,
  app_metadata: { tenant_id: tenant, role_id: rol, is_provider: false },
})

/** Alguien que acaba de iniciar sesion y todavia no pertenece a ningun cliente. */
const recienLlegado = (sub: string, email: string): Claims => ({
  sub,
  email,
  app_metadata: { tenant_id: null, is_provider: false },
})

interface Creada {
  invitacion: string
  token: string
  vence: Date
}

async function invitar(
  claims: Claims,
  email: string,
  roleId: string,
  nombre = 'Juana Perez',
): Promise<Creada> {
  const rows = await como(
    claims,
    (tx) => tx<Creada[]>`
      select * from public.crear_invitacion(${email}, ${nombre}, ${roleId}::uuid)`,
  )
  return rows[0]!
}

interface Aceptacion {
  resultado: string
  cliente: string | null
  membresia: string | null
}

async function aceptar(claims: Claims, token: string): Promise<Aceptacion> {
  const rows = await como(
    claims,
    (tx) => tx<Aceptacion[]>`select * from public.aceptar_invitacion(${token})`,
  )
  return rows[0]!
}

async function estado(id: string) {
  const [r] = await sql<{ status: string; accepted_by: string | null }[]>`
    select status, accepted_by from public.user_invitations where id = ${id}`
  return r!
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`inv-a-${RUN}`}, 'Ferreteria Moca SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`inv-b-${RUN}`}, 'Colmado El Cibao SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  const rol = async (t: string, n: string) =>
    (await sql`select id from public.roles where tenant_id = ${t} and name = ${n}`)[0]!.id as string
  ownerA = await rol(tenantA, 'Owner')
  cajeroA = await rol(tenantA, 'Cajero')
  ownerB = await rol(tenantB, 'Owner')

  await sql`
    insert into public.memberships (tenant_id, user_id, role_id, is_active, invited_at, accepted_at)
    values (${tenantA}, ${adminA}, ${ownerA}, true, now(), now()),
           (${tenantA}, ${cajeroUsuario}, ${cajeroA}, true, now(), now()),
           (${tenantB}, ${adminB}, ${ownerB}, true, now(), now())`
})

afterAll(async () => {
  for (const t of [
    'public.user_invitations',
    'public.memberships',
    'public.user_profiles',
    'public.event_outbox',
    'audit.log',
  ]) {
    await sql.unsafe(`delete from ${t} where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]])
  }
  await sql`delete from regb.tenants where id in (${tenantA}, ${tenantB})`
  await sql.end()
})

// ═══════════════════════════════════════════════════════════════════════
describe('Invitar no inventa a nadie', () => {
  it('crea una invitacion pendiente y NINGUNA membresia ni perfil', async () => {
    const antes =
      await sql`select count(*)::int as n from public.memberships where tenant_id = ${tenantA}`
    const inv = await invitar(admin(tenantA, ownerA), 'juana@ferreteria.do', cajeroA)

    expect(inv.token).toMatch(/^[0-9a-f]{64}$/)
    const dias = (inv.vence.getTime() - Date.now()) / 86_400_000
    expect(dias).toBeGreaterThan(6.9)
    expect(dias).toBeLessThan(7.1)

    const despues =
      await sql`select count(*)::int as n from public.memberships where tenant_id = ${tenantA}`
    expect(despues[0]!.n).toBe(antes[0]!.n)
    const perfiles = await sql`
      select count(*)::int as n from public.user_profiles
      where tenant_id = ${tenantA} and email = 'juana@ferreteria.do'`
    expect(perfiles[0]!.n).toBe(0)
    expect((await estado(inv.invitacion)).status).toBe('pending')
  })

  it('la funcion vieja que inventaba user_id ya no existe', async () => {
    const [r] = await sql`
      select to_regprocedure('public.invite_member(text,uuid,uuid[],uuid[])') as f`
    expect(r!.f).toBeNull()
  })

  it('el correo se normaliza: mayusculas y espacios son la misma persona', async () => {
    await expect(
      invitar(admin(tenantA, ownerA), '  JUANA@Ferreteria.DO ', cajeroA),
    ).rejects.toThrow(/Ya hay una invitacion pendiente/)
  })

  it('un correo invalido se rechaza', async () => {
    await expect(invitar(admin(tenantA, ownerA), 'juana-sin-arroba', cajeroA)).rejects.toThrow(
      /correo/i,
    )
  })

  it('emite users.member.invited SOLO con ids: ni correo ni token', async () => {
    // Un evento puede salir a un webhook de terceros (api-webhooks).
    const eventos = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from public.event_outbox
      where tenant_id = ${tenantA} and type = 'users.member.invited'`
    expect(eventos.length).toBeGreaterThanOrEqual(1)
    for (const e of eventos) {
      expect(Object.keys(e.payload).sort()).toEqual(['invitation_id', 'role_id'])
      expect(JSON.stringify(e.payload)).not.toMatch(/@|[0-9a-f]{64}/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('El token se guarda como hash', () => {
  let inv: Creada

  beforeAll(async () => {
    inv = await invitar(admin(tenantA, ownerA), 'hash@ferreteria.do', cajeroA, 'Pedro Almonte')
  })

  it('en la fila esta sha256(token), nunca el token', async () => {
    const [r] = await sql<{ token_hash: string }[]>`
      select token_hash from public.user_invitations where id = ${inv.invitacion}`
    expect(r!.token_hash).toBe(sha256(inv.token))
    expect(r!.token_hash).not.toBe(inv.token)
    const [enClaro] = await sql`
      select count(*)::int as n from public.user_invitations where token_hash = ${inv.token}`
    expect(enClaro!.n).toBe(0)
  })

  it('un usuario del cliente ni siquiera puede leer la columna del hash', async () => {
    await expect(
      como(admin(tenantA, ownerA), (tx) => tx`select token_hash from public.user_invitations`),
    ).rejects.toThrow(/permission denied/i)
  })

  it('la bitacora guarda el hash oculto, no en claro', async () => {
    const [r] = await sql<{ after: { token_hash: string } }[]>`
      select after from audit.log
      where tenant_id = ${tenantA} and entity = 'user_invitations' and entity_id = ${inv.invitacion}
      order by at limit 1`
    expect(r!.after.token_hash).toMatch(/^oculto:/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Aislamiento: una invitacion no cruza de cliente', () => {
  let inv: Creada

  beforeAll(async () => {
    inv = await invitar(admin(tenantA, ownerA), 'aislada@ferreteria.do', cajeroA)
  })

  it('A ve su invitacion; B no la ve', async () => {
    const deA = await como(
      admin(tenantA, ownerA),
      (tx) => tx`select id from public.user_invitations where id = ${inv.invitacion}`,
    )
    expect(deA).toHaveLength(1)
    const deB = await como(
      admin(tenantB, ownerB, adminB),
      (tx) => tx`select id from public.user_invitations where id = ${inv.invitacion}`,
    )
    expect(deB).toHaveLength(0)
  })

  it('B no puede revocarla ni reenviarla', async () => {
    await expect(
      como(
        admin(tenantB, ownerB, adminB),
        (tx) => tx`select public.revocar_invitacion(${inv.invitacion}::uuid)`,
      ),
    ).rejects.toThrow(/no es de esta cuenta/)
    await expect(
      como(
        admin(tenantB, ownerB, adminB),
        (tx) => tx`select * from public.reenviar_invitacion(${inv.invitacion}::uuid)`,
      ),
    ).rejects.toThrow(/no es de esta cuenta/)
    expect((await estado(inv.invitacion)).status).toBe('pending')
  })

  it('B no puede pedir el correo de la invitacion de A para enviarlo', async () => {
    await expect(
      como(
        admin(tenantB, ownerB, adminB),
        (tx) =>
          tx`select * from public.invitacion_para_enviar(${inv.invitacion}::uuid, ${inv.token})`,
      ),
    ).rejects.toThrow(/no es de esta cuenta/)
  })

  it('nadie escribe la tabla directo: ni insert, ni update, ni delete', async () => {
    const intento = (q: (tx: postgres.TransactionSql) => Promise<unknown>) =>
      expect(como(admin(tenantA, ownerA), q)).rejects.toThrow(/permission denied/i)
    await intento(
      (tx) => tx`insert into public.user_invitations
        (tenant_id, email, display_name, role_id, token_hash, expires_at)
        values (${tenantA}, 'colado@x.do', 'Colado', ${ownerA}, ${sha256('x')}, now() + interval '1 day')`,
    )
    await intento(
      (tx) =>
        tx`update public.user_invitations set status = 'accepted' where id = ${inv.invitacion}`,
    )
    await intento((tx) => tx`delete from public.user_invitations where id = ${inv.invitacion}`)
  })

  it('invitar con un rol de OTRO cliente se rechaza en la funcion', async () => {
    await expect(invitar(admin(tenantA, ownerA), 'colado@otro.do', ownerB)).rejects.toThrow(
      /rol no pertenece/,
    )
  })

  it('y la guarda de la tabla lo frena aunque se salte la funcion', async () => {
    await expect(
      sql`insert into public.user_invitations
            (tenant_id, email, display_name, role_id, token_hash, expires_at)
          values (${tenantA}, 'guarda@x.do', 'Guarda', ${ownerB}, ${sha256(RUN)},
                  now() + interval '1 day')`,
    ).rejects.toThrow(/rol no pertenece/)
  })

  it('sin tenant en el JWT no se invita a nadie', async () => {
    await expect(
      invitar(recienLlegado(crypto.randomUUID(), 'x@y.do'), 'x@y.do', cajeroA),
    ).rejects.toThrow(/Sesion sin cliente/)
  })

  it('con el modulo users apagado no se ve ni se invita', async () => {
    await sql`update regb.tenant_modules set enabled = false
              where tenant_id = ${tenantA} and module_id = 'users'`
    try {
      const filas = await como(
        admin(tenantA, ownerA),
        (tx) => tx`select id from public.user_invitations`,
      )
      expect(filas).toHaveLength(0)
      await expect(invitar(admin(tenantA, ownerA), 'apagado@x.do', cajeroA)).rejects.toThrow(
        /modulo de usuarios no esta activo/,
      )
    } finally {
      await sql`update regb.tenant_modules set enabled = true
                where tenant_id = ${tenantA} and module_id = 'users'`
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('El permiso tambien lo mira la base (PostgREST no pasa por la app)', () => {
  const cajero = () => admin(tenantA, cajeroA, cajeroUsuario)

  it('un Cajero no puede invitar', async () => {
    await expect(invitar(cajero(), 'amigo@x.do', ownerA)).rejects.toThrow(/Tu rol no permite/)
  })

  it('ni ver las invitaciones', async () => {
    const filas = await como(cajero(), (tx) => tx`select id from public.user_invitations`)
    expect(filas).toHaveLength(0)
  })

  it('ni revocar una', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'perm@ferreteria.do', cajeroA)
    await expect(
      como(cajero(), (tx) => tx`select public.revocar_invitacion(${inv.invitacion}::uuid)`),
    ).rejects.toThrow(/Tu rol no permite/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Aceptar: la membresia nace con la persona real', () => {
  it('crea la membresia con el sub del token, y no con otro', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'rosa@ferreteria.do', cajeroA, 'Rosa Tavarez')
    const rosa = crypto.randomUUID()
    const antes = await sql<{ user_id: string }[]>`
      select user_id from public.memberships where tenant_id = ${tenantA}`

    const r = await aceptar(recienLlegado(rosa, 'Rosa@Ferreteria.do'), inv.token)
    expect(r.resultado).toBe('aceptada')
    expect(r.cliente).toBe(tenantA)

    const despues = await sql<
      { id: string; user_id: string; role_id: string; accepted_at: Date }[]
    >`
      select id, user_id, role_id, accepted_at from public.memberships where tenant_id = ${tenantA}`
    const nuevas = despues.filter((m) => !antes.some((a) => a.user_id === m.user_id))
    expect(nuevas).toHaveLength(1)
    expect(nuevas[0]!.user_id).toBe(rosa)
    expect(nuevas[0]!.id).toBe(r.membresia)
    expect(nuevas[0]!.role_id).toBe(cajeroA)
    expect(nuevas[0]!.accepted_at).not.toBeNull()

    const [p] = await sql`
      select display_name, email from public.user_profiles
      where tenant_id = ${tenantA} and user_id = ${rosa}`
    expect(p).toEqual({ display_name: 'Rosa Tavarez', email: 'rosa@ferreteria.do' })

    const e = await estado(inv.invitacion)
    expect(e).toEqual({ status: 'accepted', accepted_by: rosa })

    // Y con eso el hook ya le pone su cliente en el siguiente token.
    const [t] = await sql<
      { r: { claims: { app_metadata: { tenant_id: string; role_id: string } } } }[]
    >`
      select rls.custom_access_token_hook(jsonb_build_object(
        'user_id', ${rosa}::uuid, 'claims', jsonb_build_object('app_metadata', '{}'::jsonb))) as r`
    expect(t!.r.claims.app_metadata.tenant_id).toBe(tenantA)
    expect(t!.r.claims.app_metadata.role_id).toBe(cajeroA)

    const [ev] = await sql`
      select count(*)::int as n from public.event_outbox
      where tenant_id = ${tenantA} and type = 'users.member.joined'
        and payload ->> 'user_id' = ${rosa}`
    expect(ev!.n).toBe(1)
  })

  it('no se puede aceptar la invitacion de OTRO correo', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'luis@ferreteria.do', cajeroA)
    const intruso = crypto.randomUUID()
    const r = await aceptar(recienLlegado(intruso, 'intruso@gmail.com'), inv.token)
    expect(r.resultado).toBe('otro_correo')
    expect(r.cliente).toBeNull()
    const [m] = await sql`
      select count(*)::int as n from public.memberships where user_id = ${intruso}`
    expect(m!.n).toBe(0)
    expect((await estado(inv.invitacion)).status).toBe('pending')
  })

  it('un token que no existe no revela nada', async () => {
    const r = await aceptar(recienLlegado(crypto.randomUUID(), 'x@y.do'), sha256('inventado'))
    expect(r).toEqual({ resultado: 'invalida', cliente: null, membresia: null })
  })

  it('sin sesion no se acepta', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'anonimo@ferreteria.do', cajeroA)
    const r = await aceptar({ app_metadata: { is_provider: false } }, inv.token)
    expect(r.resultado).toBe('sin_sesion')
    expect((await estado(inv.invitacion)).status).toBe('pending')
  })

  it('una vencida no crea membresia y queda marcada como vencida', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'tarde@ferreteria.do', cajeroA)
    await sql`update public.user_invitations set expires_at = now() - interval '1 minute'
              where id = ${inv.invitacion}`
    const tarde = crypto.randomUUID()
    const r = await aceptar(recienLlegado(tarde, 'tarde@ferreteria.do'), inv.token)
    expect(r.resultado).toBe('vencida')
    expect((await estado(inv.invitacion)).status).toBe('expired')
    const [m] =
      await sql`select count(*)::int as n from public.memberships where user_id = ${tarde}`
    expect(m!.n).toBe(0)
  })

  it('una revocada no se acepta', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'revocada@ferreteria.do', cajeroA)
    await como(
      admin(tenantA, ownerA),
      (tx) => tx`select public.revocar_invitacion(${inv.invitacion}::uuid)`,
    )
    const r = await aceptar(recienLlegado(crypto.randomUUID(), 'revocada@ferreteria.do'), inv.token)
    expect(r.resultado).toBe('revocada')
    expect((await estado(inv.invitacion)).status).toBe('revoked')
  })

  it('aceptar dos veces no duplica nada', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'doble@ferreteria.do', cajeroA)
    const u = crypto.randomUUID()
    expect((await aceptar(recienLlegado(u, 'doble@ferreteria.do'), inv.token)).resultado).toBe(
      'aceptada',
    )
    expect((await aceptar(recienLlegado(u, 'doble@ferreteria.do'), inv.token)).resultado).toBe(
      'ya_aceptada',
    )
    const [m] = await sql`select count(*)::int as n from public.memberships where user_id = ${u}`
    expect(m!.n).toBe(1)
  })

  it('quien ya trabaja en otro cliente no se muda solo al aceptar', async () => {
    // El hook toma UNA membresia con `limit 1`: con dos, a que cliente
    // entra no esta definido. Se rechaza en vez de dejarlo al azar.
    const inv = await invitar(admin(tenantB, ownerB, adminB), 'doble-empleo@cibao.do', ownerB)
    const r = await aceptar(recienLlegado(adminA, 'doble-empleo@cibao.do'), inv.token)
    expect(r.resultado).toBe('otro_cliente')
    const [m] = await sql`
      select count(*)::int as n from public.memberships where user_id = ${adminA} and tenant_id = ${tenantB}`
    expect(m!.n).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Reenviar cambia el token; revocar cierra la puerta', () => {
  it('el enlace viejo deja de servir y el nuevo si', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'reenvio@ferreteria.do', cajeroA)
    const [nuevo] = await como(
      admin(tenantA, ownerA),
      (tx) => tx<Creada[]>`select * from public.reenviar_invitacion(${inv.invitacion}::uuid)`,
    )
    expect(nuevo!.token).not.toBe(inv.token)
    expect(nuevo!.invitacion).toBe(inv.invitacion)

    const u = crypto.randomUUID()
    expect((await aceptar(recienLlegado(u, 'reenvio@ferreteria.do'), inv.token)).resultado).toBe(
      'invalida',
    )
    expect((await aceptar(recienLlegado(u, 'reenvio@ferreteria.do'), nuevo!.token)).resultado).toBe(
      'aceptada',
    )
  })

  it('una invitacion ya aceptada no se reenvia ni se revoca', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'cerrada@ferreteria.do', cajeroA)
    await aceptar(recienLlegado(crypto.randomUUID(), 'cerrada@ferreteria.do'), inv.token)
    await expect(
      como(
        admin(tenantA, ownerA),
        (tx) => tx`select * from public.reenviar_invitacion(${inv.invitacion}::uuid)`,
      ),
    ).rejects.toThrow(/ya no esta pendiente/)
    await expect(
      como(
        admin(tenantA, ownerA),
        (tx) => tx`select public.revocar_invitacion(${inv.invitacion}::uuid)`,
      ),
    ).rejects.toThrow(/ya no esta pendiente/)
  })

  it('reenviar una vencida por fecha la renueva', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'renovar@ferreteria.do', cajeroA)
    await sql`update public.user_invitations set expires_at = now() - interval '1 day'
              where id = ${inv.invitacion}`
    const [nuevo] = await como(
      admin(tenantA, ownerA),
      (tx) => tx<Creada[]>`select * from public.reenviar_invitacion(${inv.invitacion}::uuid)`,
    )
    expect(nuevo!.vence.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000)
  })

  it('invitar de nuevo a quien tenia una vencida la cierra y abre otra', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'otra-vez@ferreteria.do', cajeroA)
    await sql`update public.user_invitations set expires_at = now() - interval '1 day'
              where id = ${inv.invitacion}`
    const otra = await invitar(admin(tenantA, ownerA), 'otra-vez@ferreteria.do', cajeroA)
    expect(otra.invitacion).not.toBe(inv.invitacion)
    expect((await estado(inv.invitacion)).status).toBe('expired')
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Envio por correo (lo que usa la Edge Function)', () => {
  it('con el token correcto devuelve a quien escribirle', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'envio@ferreteria.do', cajeroA, 'Ana Reyes')
    const [r] = await como(
      admin(tenantA, ownerA),
      (tx) =>
        tx`select * from public.invitacion_para_enviar(${inv.invitacion}::uuid, ${inv.token})`,
    )
    expect(r).toEqual({ email: 'envio@ferreteria.do', nombre: 'Ana Reyes' })
  })

  it('con otro token se niega: la funcion no es un relevo de correos', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'relevo@ferreteria.do', cajeroA)
    await expect(
      como(
        admin(tenantA, ownerA),
        (tx) =>
          tx`select * from public.invitacion_para_enviar(${inv.invitacion}::uuid, ${sha256('otro')})`,
      ),
    ).rejects.toThrow(/no corresponde/)
  })

  it('marcar como enviada deja constancia de cuando salio el correo', async () => {
    const inv = await invitar(admin(tenantA, ownerA), 'marca@ferreteria.do', cajeroA)
    await como(
      admin(tenantA, ownerA),
      (tx) => tx`select public.marcar_invitacion_enviada(${inv.invitacion}::uuid)`,
    )
    const [r] = await sql`
      select sent_at is not null as enviada, send_count from public.user_invitations
      where id = ${inv.invitacion}`
    expect(r).toEqual({ enviada: true, send_count: 1 })
  })
})
