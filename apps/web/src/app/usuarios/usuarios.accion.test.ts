import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import type { EnvioCorreo } from './invitacion'
import { mensajeDeEnvio } from './invitacion'
import type { enviarInvitacionPorCorreo } from './correo'
import {
  alternarActivo,
  invitarMiembro,
  reenviarInvitacion,
  revocarInvitacion,
  revocarInvitacionForm,
} from './actions'

/**
 * Las acciones de /usuarios llamadas DE VERDAD, contra la base de pruebas.
 *
 * Lo que fija este archivo es la deuda que se cerro con 0123:
 *  - invitar ya no inventa un `user_id` ni toca `memberships`;
 *  - la pantalla nunca dice "enviada" si el correo no salio;
 *  - el enlace que se enseña es el unico que existe (la base guarda el hash)
 *    y sirve para que la persona REAL acepte.
 *
 * El envio se deja tal cual (modo demostracion: no hay Supabase) salvo en
 * las pruebas que fuerzan una respuesta de la Edge Function, para ver que
 * `sent_at` solo se marca cuando el correo salio.
 */
const correo = vi.hoisted(() => ({ forzar: null as EnvioCorreo | null }))
vi.mock('./correo', async (importOriginal) => {
  const real = await importOriginal<{
    enviarInvitacionPorCorreo: typeof enviarInvitacionPorCorreo
  }>()
  return {
    enviarInvitacionPorCorreo: async (p: { invitationId: string; token: string }) =>
      correo.forzar ?? real.enviarInvitacionPorCorreo(p),
  }
})

let c: ClientePrueba
let otro: ClientePrueba
let rolCajero: string
let rolAjeno: string
const colega = crypto.randomUUID()

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const tokenDe = (enlace: string) => enlace.split('/auth/invitacion/')[1] ?? ''

async function invitaciones(email: string) {
  return db()<
    { id: string; status: string; token_hash: string; sent_at: Date | null; send_count: number }[]
  >`
    select id, status, token_hash, sent_at, send_count from public.user_invitations
    where tenant_id = ${c.tenantId} and email = ${email} order by created_at`
}

async function membresias() {
  const [r] = await db()<{ n: number }[]>`
    select count(*)::int as n from public.memberships where tenant_id = ${c.tenantId}`
  return r!.n
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-usr',
    nombre: 'Ferreteria La Vega SRL',
    modulos: ['users'],
    roles: {
      Administrador: { 'users.*': true },
      Cajero: { 'pos.sell': true },
    },
  })
  otro = await sembrarCliente({
    prefijo: 'accion-usr',
    nombre: 'Colmado Ajeno SRL',
    modulos: ['users'],
    roles: { Administrador: { 'users.*': true } },
  })
  const sql = db()
  rolCajero = (
    await sql`select id from public.roles where tenant_id = ${c.tenantId} and name = 'Cajero'`
  )[0]!.id
  rolAjeno = (
    await sql`select id from public.roles where tenant_id = ${otro.tenantId} and name = 'Administrador'`
  )[0]!.id

  // Una colega ya dentro del equipo, para probar desactivar.
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id, is_active, invited_at, accepted_at)
    values (${c.tenantId}, ${colega}, ${rolCajero}, true, now(), now())`
  await sql`
    insert into public.user_profiles (tenant_id, user_id, display_name, email)
    values (${c.tenantId}, ${colega}, 'Carmen Liriano', 'carmen@lavega.do')`
})

beforeEach(() => {
  correo.forzar = null
})

afterAll(async () => {
  const antes = ['public.user_invitations', 'public.memberships', 'public.user_profiles']
  await c.limpiar(antes)
  await otro.limpiar(antes)
  await cerrarBase()
})

// ═══════════════════════════════════════════════════════════════════════
describe('invitarMiembro en modo demostracion', () => {
  it('crea la invitacion, NO una membresia, y devuelve el enlace porque no salio correo', async () => {
    const antes = await membresias()
    const r = await invitarMiembro(
      null,
      c.fd({ nombre: 'Juana Perez', email: '  Juana@LaVega.do ', roleId: rolCajero }),
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.email).toBe('juana@lavega.do')
    expect(r.envio).toEqual({ enviado: false, motivo: 'demo', detalle: null })
    expect(r.enlace).toMatch(/^http:\/\/localhost:3000\/auth\/invitacion\/[0-9a-f]{64}$/)

    expect(await membresias()).toBe(antes)
    const [perfil] = await db()`
      select count(*)::int as n from public.user_profiles
      where tenant_id = ${c.tenantId} and email = 'juana@lavega.do'`
    expect(perfil!.n).toBe(0)

    const [inv] = await invitaciones('juana@lavega.do')
    expect(inv!.status).toBe('pending')
    // Nunca "enviada": no salio ningun correo.
    expect(inv!.sent_at).toBeNull()
    // Lo guardado es el hash del token del enlace, no el token.
    expect(inv!.token_hash).toBe(sha256(tokenDe(r.enlace!)))
  })

  it('el mensaje dice que NO se envio, sin rodeos', () => {
    const texto = mensajeDeEnvio('juana@lavega.do', {
      enviado: false,
      motivo: 'demo',
      detalle: null,
    })
    expect(texto).toMatch(/No se envio ningun correo/)
    expect(texto).not.toMatch(/enviamos/i)
  })

  it('emite users.member.invited con ids y sin el correo', async () => {
    const [inv] = await invitaciones('juana@lavega.do')
    const eventos = await db()<{ payload: Record<string, string> }[]>`
      select payload from public.event_outbox
      where tenant_id = ${c.tenantId} and type = 'users.member.invited'
        and payload ->> 'invitation_id' = ${inv!.id}`
    expect(eventos).toHaveLength(1)
    expect(eventos[0]!.payload).toEqual({ invitation_id: inv!.id, role_id: rolCajero })
  })

  it('la persona real acepta con ESE enlace y la membresia nace con su id', async () => {
    const r = await invitarMiembro(
      null,
      c.fd({ nombre: 'Rafael Nunez', email: 'rafael@lavega.do', roleId: rolCajero }),
    )
    if (!r.ok) throw new Error(r.error)
    const rafael = crypto.randomUUID()
    const claims = JSON.stringify({
      sub: rafael,
      email: 'rafael@lavega.do',
      app_metadata: { tenant_id: null, is_provider: false },
    })
    const [a] = await db().begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`
      await tx.unsafe('set local role authenticated')
      return tx<{ resultado: string; cliente: string }[]>`
        select * from public.aceptar_invitacion(${tokenDe(r.enlace!)})`
    })
    expect(a).toMatchObject({ resultado: 'aceptada', cliente: c.tenantId })
    const [m] = await db()`
      select role_id, accepted_at is not null as aceptada from public.memberships
      where tenant_id = ${c.tenantId} and user_id = ${rafael}`
    expect(m).toEqual({ role_id: rolCajero, aceptada: true })
  })

  it('invitar dos veces al mismo correo lo dice y no duplica', async () => {
    const r = await invitarMiembro(
      null,
      c.fd({ nombre: 'Juana Perez', email: 'juana@lavega.do', roleId: rolCajero }),
    )
    expect(r).toEqual({
      ok: false,
      error: 'Ya hay una invitacion pendiente para ese correo. Reenviala o revocala.',
    })
    expect(await invitaciones('juana@lavega.do')).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Las puertas', () => {
  it('sin users.create no se invita', async () => {
    const r = await invitarMiembro(
      null,
      c.fd({ nombre: 'Colado Uno', email: 'colado1@lavega.do', roleId: rolCajero }, 'Cajero'),
    )
    expect(r.ok).toBe(false)
    expect(await invitaciones('colado1@lavega.do')).toHaveLength(0)
  })

  it('un rol de OTRO cliente se rechaza', async () => {
    const r = await invitarMiembro(
      null,
      c.fd({ nombre: 'Colado Dos', email: 'colado2@lavega.do', roleId: rolAjeno }),
    )
    expect(r).toEqual({ ok: false, error: 'El rol no pertenece a este cliente.' })
    expect(await invitaciones('colado2@lavega.do')).toHaveLength(0)
  })

  it('otro cliente no revoca ni reenvia mis invitaciones', async () => {
    const [inv] = await invitaciones('juana@lavega.do')
    expect(await revocarInvitacion(otro.fd({ invitationId: inv!.id }))).toEqual({
      ok: false,
      error: 'Esa invitacion no es de esta cuenta.',
    })
    const r = await reenviarInvitacion(null, otro.fd({ invitationId: inv!.id }))
    expect(r.ok).toBe(false)
    const [despues] = await invitaciones('juana@lavega.do')
    expect(despues!.status).toBe('pending')
    expect(despues!.token_hash).toBe(inv!.token_hash)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Enviado solo si salio', () => {
  it('con la Edge Function respondiendo que salio: sent_at y sin enlace en pantalla', async () => {
    correo.forzar = { enviado: true }
    const r = await invitarMiembro(
      null,
      c.fd({ nombre: 'Ana Reyes', email: 'ana@lavega.do', roleId: rolCajero }),
    )
    expect(r).toMatchObject({ ok: true, envio: { enviado: true }, enlace: null })
    const [inv] = await invitaciones('ana@lavega.do')
    expect(inv!.sent_at).not.toBeNull()
    expect(inv!.send_count).toBe(1)
  })

  it('si el envio falla: NO se marca enviada y se da el enlace', async () => {
    correo.forzar = { enviado: false, motivo: 'fallo', detalle: 'SMTP no configurado' }
    const r = await invitarMiembro(
      null,
      c.fd({ nombre: 'Luis Batista', email: 'luis@lavega.do', roleId: rolCajero }),
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.enlace).toMatch(/\/auth\/invitacion\/[0-9a-f]{64}$/)
    expect(mensajeDeEnvio(r.email, r.envio)).toMatch(/NO salio \(SMTP no configurado\)/)
    const [inv] = await invitaciones('luis@lavega.do')
    expect(inv!.sent_at).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Reenviar y revocar', () => {
  it('reenviar da un enlace NUEVO y el viejo deja de corresponder', async () => {
    const [antes] = await invitaciones('juana@lavega.do')
    const r = await reenviarInvitacion(null, c.fd({ invitationId: antes!.id }))
    if (!r.ok) throw new Error(r.error)
    expect(r.email).toBe('juana@lavega.do')
    const [despues] = await invitaciones('juana@lavega.do')
    expect(despues!.token_hash).not.toBe(antes!.token_hash)
    expect(despues!.token_hash).toBe(sha256(tokenDe(r.enlace!)))
  })

  it('revocar la cierra y lo avisa con su propio texto', async () => {
    const [inv] = await invitaciones('juana@lavega.do')
    await revocarInvitacionForm(c.fd({ invitationId: inv!.id }))
    expect(JSON.parse(tarro.get('regb_aviso')!.value)).toEqual({
      tipo: 'ok',
      texto: 'Listo, revocamos la invitacion. Su enlace ya no sirve.',
    })
    const [despues] = await invitaciones('juana@lavega.do')
    expect(despues!.status).toBe('revoked')
  })

  it('una revocada ya no se revoca otra vez', async () => {
    const [inv] = await invitaciones('juana@lavega.do')
    const r = await revocarInvitacion(c.fd({ invitationId: inv!.id }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ya no esta pendiente/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Desactivar emite users.member.deactivated', () => {
  const eventos = async () => {
    const [e] = await db()`
      select count(*)::int as n from public.event_outbox
      where tenant_id = ${c.tenantId} and type = 'users.member.deactivated'
        and payload ->> 'user_id' = ${colega}`
    return e!.n as number
  }

  it('al desactivar, uno; al reactivar, ninguno mas', async () => {
    expect(await alternarActivo(c.fd({ userId: colega }))).toEqual({ ok: true })
    expect(await eventos()).toBe(1)
    expect(await alternarActivo(c.fd({ userId: colega }))).toEqual({ ok: true })
    expect(await eventos()).toBe(1)
  })

  it('a alguien de otro cliente no lo encuentra', async () => {
    expect(await alternarActivo(otro.fd({ userId: colega }))).toEqual({
      ok: false,
      error: 'Esa persona no esta en tu equipo.',
    })
  })
})
