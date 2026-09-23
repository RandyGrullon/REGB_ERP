import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { asUser, db } from '@/lib/db'
import { cerrarBase } from '@/test/arnes'
import { darDeAltaCliente, enlaceNuevoParaDueno } from './actions'

/**
 * El alta de un cliente real desde REGB Control, llamada DE VERDAD.
 *
 * Antes no habia pantalla: un cliente nacia con un `insert` a mano, sin
 * empresa principal (el ticket sin RNC del emisor), sin almacen (la caja
 * sin turno) y sin dueño (la invitacion inventaba un user_id). Aqui se
 * fija que una sola llamada deja al cliente listo para que su dueño entre
 * y venda, y que repetirla no duplica nada.
 */

// El proveedor de la demo: sin Supabase, requireProvider() deja pasar.
const PROVEEDOR = '00000000-0000-0000-0000-00000000f00d'

const creados = new Set<string>()

/** Un RNC de 9 digitos con su digito verificador bien puesto. */
function rncAleatorio(): string {
  const pesos = [7, 9, 8, 6, 5, 4, 3, 2]
  for (;;) {
    const base = Array.from({ length: 8 }, (_, i) =>
      i === 0 ? (1 + Math.random() * 4) | 0 : (Math.random() * 10) | 0,
    )
    const suma = base.reduce((a, d, i) => a + d * pesos[i]!, 0)
    const resto = suma % 11
    const v = resto === 0 ? 2 : resto === 1 ? 1 : 11 - resto
    if (v <= 9) return [...base, v].join('')
  }
}

const hex8 = () => crypto.randomUUID().slice(0, 8)
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

function formulario(c: {
  slug: string
  rnc: string
  tier?: string
  modulos?: string[]
  correo?: string
  nombre?: string
}): FormData {
  const f = new FormData()
  f.set('slug', c.slug)
  f.set('razonSocial', 'Electronica del Cibao SRL')
  f.set('nombreComercial', 'ElectroCibao')
  f.set('rnc', c.rnc)
  f.set('tier', c.tier ?? 'pyme')
  for (const m of c.modulos ?? []) f.append('modulos', m)
  f.set('sucursal', 'Santiago Centro')
  f.set('almacen', 'Almacen Santiago')
  f.set('duenoNombre', c.nombre ?? 'Ramon Almonte')
  f.set('duenoCorreo', c.correo ?? 'ramon@electrocibao.do')
  return f
}

async function clientePorSlug(slug: string) {
  const [t] = await db()<
    { id: string; legal_name: string; tax_id: string; tier: string; status: string }[]
  >`select id, legal_name, tax_id, tier::text, status::text from regb.tenants where slug = ${slug}`
  if (t) creados.add(t.id)
  return t
}

afterAll(async () => {
  for (const id of creados) {
    await db()`delete from public.event_outbox where tenant_id = ${id}`
    await db()`delete from audit.log where tenant_id = ${id}`
    await db()`delete from regb.tenants where id = ${id}`
  }
  await cerrarBase()
})

describe('dar de alta un cliente real en una sola llamada', () => {
  const slug = `alta-${hex8()}`
  const rnc = rncAleatorio()

  it('crea cliente, modulos con dependencias, empresa, sucursal, almacen e invitacion Owner', async () => {
    const r = await darDeAltaCliente(
      null,
      formulario({
        slug,
        rnc: `${rnc.slice(0, 3)}-${rnc.slice(3, 8)}-${rnc.slice(8)}`,
        modulos: ['pos', 'stock-counts'],
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.resultado).toBe('creado')
    expect(r.slug).toBe(slug)
    // stock-counts requiere inventory; pos requiere products, que es core y
    // ya lo puso el trigger: no cuenta como "activado ahora".
    expect(r.modulosActivados).toEqual(['inventory', 'pos', 'stock-counts'])
    expect(r.piezas).toEqual(['cliente', 'empresa', 'sucursal', 'almacen', 'invitacion'])
    expect(r.dueno.estado).toBe('invitado')
    expect(r.dueno.enlace).toMatch(/\/auth\/invitacion\/[0-9a-f]{64}$/)

    const t = await clientePorSlug(slug)
    expect(t).toMatchObject({
      legal_name: 'Electronica del Cibao SRL',
      tax_id: `${rnc.slice(0, 3)}-${rnc.slice(3, 8)}-${rnc.slice(8)}`,
      tier: 'pyme',
      status: 'active',
    })
    const id = t!.id

    const mods = await db()<{ module_id: string; status: string; enabled: boolean }[]>`
      select module_id, status::text, enabled from regb.tenant_modules
      where tenant_id = ${id} and module_id in ('pos', 'inventory', 'stock-counts', 'products')
      order by module_id`
    expect(mods).toEqual([
      { module_id: 'inventory', status: 'active', enabled: true },
      { module_id: 'pos', status: 'active', enabled: true },
      { module_id: 'products', status: 'active', enabled: true },
      { module_id: 'stock-counts', status: 'active', enabled: true },
    ])

    const [roles] = await db()<{ n: number; owner: number }[]>`
      select count(*)::int as n, count(*) filter (where name = 'Owner')::int as owner
      from public.roles where tenant_id = ${id} and is_system`
    expect(roles).toEqual({ n: 14, owner: 1 })

    const empresas = await db()<{ id: string; tax_id: string; is_default: boolean }[]>`
      select id, tax_id, is_default from public.companies where tenant_id = ${id}`
    expect(empresas).toHaveLength(1)
    expect(empresas[0]).toMatchObject({ tax_id: t!.tax_id, is_default: true })

    const [sucursal] = await db()<{ id: string; name: string; company_id: string }[]>`
      select id, name, company_id from public.branches where tenant_id = ${id}`
    expect(sucursal).toMatchObject({ name: 'Santiago Centro', company_id: empresas[0]!.id })

    const almacenes = await db()<{ name: string; is_default: boolean; branch_id: string }[]>`
      select name, is_default, branch_id from public.warehouses where tenant_id = ${id}`
    expect(almacenes).toEqual([
      { name: 'Almacen Santiago', is_default: true, branch_id: sucursal!.id },
    ])

    const invs = await db()<
      {
        email: string
        display_name: string
        role: string
        status: string
        invited_by: string
        token_hash: string
      }[]
    >`
      select i.email, i.display_name, r.name as role, i.status, i.invited_by::text, i.token_hash
      from public.user_invitations i join public.roles r on r.id = i.role_id
      where i.tenant_id = ${id}`
    expect(invs).toHaveLength(1)
    expect(invs[0]).toMatchObject({
      email: 'ramon@electrocibao.do',
      display_name: 'Ramon Almonte',
      role: 'Owner',
      status: 'pending',
      invited_by: PROVEEDOR,
    })
    // El enlace que ve el proveedor es el de ESA invitacion (0123 guarda solo el hash).
    const token = r.dueno.enlace!.split('/').pop()!
    expect(invs[0]!.token_hash).toBe(sha256(token))
  })

  it('nace en "Vendido" del tablero, con bitacora y el evento de la invitacion', async () => {
    const t = await clientePorSlug(slug)
    const [o] = await db()<{ stage: string; owner_user_id: string }[]>`
      select stage, owner_user_id::text from regb.onboarding where tenant_id = ${t!.id}`
    expect(o).toEqual({ stage: 'sold', owner_user_id: PROVEEDOR })

    const log = await db()<
      { entity: string; action: string; user_id: string; after: Record<string, unknown> }[]
    >`
      select entity, action, user_id::text, after from audit.log
      where tenant_id = ${t!.id} and entity = 'tenants'`
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ action: 'create', user_id: PROVEEDOR })
    expect(log[0]!.after).toMatchObject({ alta_de_cliente: true, slug })

    // Los triggers de cada tabla tambien anotan, con el proveedor como autor.
    const [porTabla] = await db()<{ n: number }[]>`
      select count(*)::int as n from audit.log
      where tenant_id = ${t!.id} and entity in ('companies', 'branches', 'warehouses', 'user_invitations')
        and user_id = ${PROVEEDOR}`
    expect(porTabla!.n).toBe(4)

    const [ev] = await db()<{ n: number }[]>`
      select count(*)::int as n from public.event_outbox
      where tenant_id = ${t!.id} and type = 'users.member.invited'`
    expect(ev!.n).toBe(1)
  })

  it('su almacen se ve bajo RLS: la caja ya tiene donde abrir turno', async () => {
    const t = await clientePorSlug(slug)
    const w = await asUser(
      PROVEEDOR,
      t!.id,
      (tx) => tx`
      select name from public.warehouses where tenant_id = ${t!.id} and is_active`,
    )
    expect(w.map((x) => x.name)).toEqual(['Almacen Santiago'])
  })

  it('repetir el alta no duplica nada ni gasta otra invitacion', async () => {
    const t = await clientePorSlug(slug)
    const r = await darDeAltaCliente(
      null,
      formulario({ slug, rnc, modulos: ['pos', 'stock-counts'] }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.resultado).toBe('ya_existia')
    expect(r.clienteId).toBe(t!.id)
    expect(r.piezas).toEqual([])
    expect(r.modulosActivados).toEqual([])
    expect(r.dueno.estado).toBe('pendiente')
    expect(r.dueno.enlace).toBeNull()

    const [n] = await db()<
      { t: number; c: number; b: number; w: number; i: number; log: number }[]
    >`
      select (select count(*)::int from regb.tenants where regexp_replace(tax_id, '[^0-9]', '', 'g') = ${rnc}) as t,
             (select count(*)::int from public.companies where tenant_id = ${t!.id}) as c,
             (select count(*)::int from public.branches where tenant_id = ${t!.id}) as b,
             (select count(*)::int from public.warehouses where tenant_id = ${t!.id}) as w,
             (select count(*)::int from public.user_invitations where tenant_id = ${t!.id}) as i,
             (select count(*)::int from audit.log where tenant_id = ${t!.id} and entity = 'tenants') as log`
    expect(n).toEqual({ t: 1, c: 1, b: 1, w: 1, i: 1, log: 1 })
  })

  it('repetirla con un modulo mas completa: activa solo ese y lo anota', async () => {
    const r = await darDeAltaCliente(
      null,
      formulario({ slug, rnc, modulos: ['pos', 'stock-counts', 'barcode'] }),
    )
    expect(r.ok && r.resultado).toBe('completado')
    expect(r.ok && r.modulosActivados).toEqual(['barcode'])
  })

  it('un enlace nuevo para el dueño rota el token: el anterior deja de servir', async () => {
    const t = await clientePorSlug(slug)
    const [antes] = await db()<{ token_hash: string }[]>`
      select token_hash from public.user_invitations where tenant_id = ${t!.id}`
    const f = new FormData()
    f.set('clienteId', t!.id)
    const r = await enlaceNuevoParaDueno(null, f)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.correo).toBe('ramon@electrocibao.do')
    const token = r.enlace.split('/').pop()!
    const [despues] = await db()<{ token_hash: string; status: string }[]>`
      select token_hash, status from public.user_invitations where tenant_id = ${t!.id}`
    expect(despues!.status).toBe('pending')
    expect(despues!.token_hash).toBe(sha256(token))
    expect(despues!.token_hash).not.toBe(antes!.token_hash)
  })
})

describe('lo que el alta niega, sin dejar nada a medias', () => {
  it('un RNC con el digito verificador mal no crea nada', async () => {
    const slug = `alta-${hex8()}`
    const rnc = rncAleatorio()
    const malo = rnc.slice(0, 8) + String((Number(rnc[8]) + 1) % 10)
    const r = await darDeAltaCliente(null, formulario({ slug, rnc: malo }))
    expect(r).toEqual({ ok: false, error: expect.stringContaining('no es valido') })
    expect(await clientePorSlug(slug)).toBeUndefined()
  })

  it('el mismo RNC con otro identificador se niega y dice cual es el cliente', async () => {
    const slug = `alta-${hex8()}`
    const rnc = rncAleatorio()
    expect((await darDeAltaCliente(null, formulario({ slug, rnc }))).ok).toBe(true)
    await clientePorSlug(slug)

    const otro = `alta-${hex8()}`
    const r = await darDeAltaCliente(null, formulario({ slug: otro, rnc }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(`(${slug})`)
    expect(await clientePorSlug(otro)).toBeUndefined()
  })

  it('el identificador de otro cliente se niega', async () => {
    const r = await darDeAltaCliente(
      null,
      formulario({ slug: 'colmado-esperanza', rnc: rncAleatorio() }),
    )
    expect(r).toEqual({ ok: false, error: expect.stringContaining('ya es de otro cliente') })
  })

  it('un identificador que choca con una pantalla de REGB Control se niega', async () => {
    // /control/<slug> es la ficha del cliente: "salud" abriria el panel de salud.
    for (const slug of ['salud', 'onboarding', 'facturacion']) {
      const r = await darDeAltaCliente(null, formulario({ slug, rnc: rncAleatorio() }))
      expect(r).toEqual({ ok: false, error: expect.stringContaining('reservado') })
      expect(await clientePorSlug(slug)).toBeUndefined()
    }
  })

  it('un modulo enterprise en plan pyme se niega', async () => {
    const slug = `alta-${hex8()}`
    const r = await darDeAltaCliente(
      null,
      formulario({ slug, rnc: rncAleatorio(), modulos: ['consolidation'] }),
    )
    expect(r).toEqual({
      ok: false,
      error: expect.stringContaining('solo se venden en el plan grande'),
    })
    expect(await clientePorSlug(slug)).toBeUndefined()
  })

  it('un modulo que no existe o no se vende se niega', async () => {
    const slug = `alta-${hex8()}`
    const r = await darDeAltaCliente(
      null,
      formulario({ slug, rnc: rncAleatorio(), modulos: ['pos', 'teletransporte'] }),
    )
    expect(r).toEqual({ ok: false, error: expect.stringContaining('teletransporte') })
    expect(await clientePorSlug(slug)).toBeUndefined()
  })

  it('si falla al final (la invitacion), no queda ni el cliente: todo o nada', async () => {
    const slug = `alta-${hex8()}`
    // 0123 exige un nombre de 3 a 120 letras: la invitacion revienta DESPUES
    // de crear cliente, empresa, sucursal y almacen.
    const r = await darDeAltaCliente(
      null,
      formulario({ slug, rnc: rncAleatorio(), nombre: 'R'.repeat(130) }),
    )
    expect(r.ok).toBe(false)
    expect(await clientePorSlug(slug)).toBeUndefined()
  })

  it('en la base, solo el proveedor puede llamar al alta', async () => {
    const claims = JSON.stringify({ sub: PROVEEDOR, app_metadata: { is_provider: false } })
    const intento = db().begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`
      await tx.unsafe('set local role authenticated')
      return tx`select * from regb.alta_de_cliente(
        ${`alta-${hex8()}`}, 'Colado SRL', null, ${rncAleatorio()}, 'pyme', '{}'::text[],
        null, null, 'Nadie Nadie', 'nadie@x.do')`
    })
    await expect(intento).rejects.toMatchObject({ code: '42501' })
  })
})
