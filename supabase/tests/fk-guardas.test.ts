import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * El agujero de siempre, cerrado en todo el esquema (0121).
 *
 * Una clave foranea se comprueba SIN pasar por la RLS, y la RLS de
 * escritura solo compara el tenant_id de la fila nueva: un usuario de A
 * podia guardar una fila con SU tenant_id -que pasa la RLS- apuntando al
 * rol, la empresa, el producto o el almacen de B. Aqui se prueba:
 *
 *  1. Reproduccion en el core, como `authenticated` bajo RLS:
 *     `memberships.role_id` y `branches.company_id`, por INSERT y por
 *     UPDATE. Mas los arreglos `branch_ids`/`company_ids` de la membresia,
 *     que viajan en el JWT y no tenian ni FK.
 *  2. Muestras del barrido: una FK que no tenia guarda (`warehouses`,
 *     `products.category_id`) y una que solo la tenia al INSERTAR
 *     (`attendance_geofences.branch_id`: el UPDATE la dejaba pasar).
 *  3. Que un id inexistente reciba el MISMO rechazo que uno ajeno: si no,
 *     la guarda serviria de oraculo para saber que ids existen en otro
 *     cliente.
 *  4. El camino legitimo sigue abierto.
 *  5. Red de seguridad sobre el catalogo: TODA FK de public entre tablas
 *     con tenant_id tiene guarda en INSERT y en UPDATE, y ninguna fila de
 *     la base apunta hoy a otro cliente. La proxima tabla que se olvide
 *     la guarda pone esta prueba en rojo.
 *  6. `public.roles` queda en la bitacora.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
// Un compañero de A: las pruebas de UPDATE apuntan a SU membresia. Sobre
// la propia, desde 0127 manda antes otra regla (nadie toca su acceso).
const companeroA = crypto.randomUUID()

let tenantA: string
let tenantB: string
let ownerA: string
let cajeroA: string
let ownerB: string
let empresaA: string
let empresaB: string
let sucursalA: string
let sucursalB: string
let categoriaA: string
let categoriaB: string
let productoA: string
let geocercaA: string

const AJENO = /no pertenece a ese cliente/

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

async function rol(tenant: string, nombre: string) {
  const [r] = await sql<{ id: string }[]>`
    select id from public.roles where tenant_id = ${tenant} and name = ${nombre}`
  return r!.id
}

async function empresa(tenant: string, nombre: string) {
  const [c] = await sql<{ id: string }[]>`
    insert into public.companies (tenant_id, legal_name, is_default)
    values (${tenant}, ${nombre}, true) returning id`
  return c!.id
}

async function sucursal(tenant: string, company: string, nombre: string) {
  const [b] = await sql<{ id: string }[]>`
    insert into public.branches (tenant_id, company_id, name)
    values (${tenant}, ${company}, ${nombre}) returning id`
  return b!.id
}

async function categoria(tenant: string, nombre: string) {
  const [c] = await sql<{ id: string }[]>`
    insert into public.product_categories (tenant_id, name)
    values (${tenant}, ${nombre}) returning id`
  return c!.id
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`fkg-a-${RUN}`}, 'Colmado Guardas A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`fkg-b-${RUN}`}, 'Distribuidora Guardas B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    for (const m of ['products', 'inventory', 'employees', 'attendance']) {
      await sql`
        insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
        values (${t}, ${m}, 'active', true)
        on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
    }
  }

  // Los roles de sistema los crea el alta del tenant (0006/0011).
  ownerA = await rol(tenantA, 'Owner')
  cajeroA = await rol(tenantA, 'Cajero')
  ownerB = await rol(tenantB, 'Owner')

  await sql`
    insert into public.memberships (tenant_id, user_id, role_id, accepted_at)
    values (${tenantA}, ${userA}, ${ownerA}, now())`
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id, accepted_at)
    values (${tenantB}, ${userB}, ${ownerB}, now())`
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id, accepted_at)
    values (${tenantA}, ${companeroA}, ${cajeroA}, now())`

  empresaA = await empresa(tenantA, 'Guardas A SRL')
  empresaB = await empresa(tenantB, 'Guardas B SRL')
  sucursalA = await sucursal(tenantA, empresaA, 'Sucursal A')
  sucursalB = await sucursal(tenantB, empresaB, 'Sucursal B')
  categoriaA = await categoria(tenantA, 'Bebidas A')
  categoriaB = await categoria(tenantB, 'Bebidas B')

  const [p] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, category_id)
    values (${tenantA}, ${'FKG-' + RUN}, 'Refresco 2L', ${categoriaA}) returning id`
  productoA = p!.id

  const [g] = await sql<{ id: string }[]>`
    insert into public.attendance_geofences (tenant_id, branch_id, latitude, longitude, radius_meters)
    values (${tenantA}, ${sucursalA}, 18.4861, -69.9312, 150) returning id`
  geocercaA = g!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.attendance_geofences where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.product_categories where tenant_id in ${sql(ts)}`
  await sql`delete from public.memberships where tenant_id in ${sql(ts)}`
  await sql`delete from public.branches where tenant_id in ${sql(ts)}`
  await sql`delete from public.companies where tenant_id in ${sql(ts)}`
  await sql`delete from public.roles where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

// ═══════════════════════════════════════════════════════════════════════
describe('Reproduccion: una membresia de A no apunta a un rol de B', () => {
  it('INSERT con el rol de B se rechaza (42501), aunque la fila lleve el tenant de A', async () => {
    const nuevo = crypto.randomUUID()
    await expect(
      as(userA, tenantA, (tx) => tx`
        insert into public.memberships (tenant_id, user_id, role_id)
        values (${tenantA}, ${nuevo}, ${ownerB})`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/Ese rol no pertenece/) })
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.memberships where user_id = ${nuevo}`
    expect(n!.n).toBe(0)
  })

  it('UPDATE de una membresia de A al rol de B se rechaza y el rol no cambia', async () => {
    // Es la escalada: el hook (0008) mete memberships.role_id en el JWT,
    // y rls.has_perm() (0109) devolvia TRUE cuando el rol del token no era
    // del tenant -"sin rol no se decide aqui"-. Un rol ajeno en la
    // membresia apagaba de un golpe todos los permisos de la base.
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.memberships set role_id = ${ownerB} where user_id = ${companeroA}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/Ese rol no pertenece/) })
    const [m] = await sql<{ role_id: string }[]>`
      select role_id from public.memberships where tenant_id = ${tenantA} and user_id = ${companeroA}`
    expect(m!.role_id).toBe(cajeroA)
  })

  it('tampoco sobre la propia membresia', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.memberships set role_id = ${ownerB} where user_id = ${userA}`),
    ).rejects.toMatchObject({ code: '42501' })
    const [m] = await sql<{ role_id: string }[]>`
      select role_id from public.memberships where tenant_id = ${tenantA} and user_id = ${userA}`
    expect(m!.role_id).toBe(ownerA)
  })

  it('las sucursales y empresas de la membresia tampoco pueden ser de B', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.memberships set branch_ids = ${sql.array([sucursalA, sucursalB])}::uuid[]
        where user_id = ${companeroA}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/sucursales/) })
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.memberships set company_ids = ${sql.array([empresaB])}::uuid[]
        where user_id = ${companeroA}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/empresas/) })
  })
})

describe('Reproduccion: una sucursal de A no cuelga de una empresa de B', () => {
  it('INSERT con la empresa de B se rechaza', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        insert into public.branches (tenant_id, company_id, name)
        values (${tenantA}, ${empresaB}, 'Sucursal colada')`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/Esa empresa no pertenece/) })
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.branches where name = 'Sucursal colada'`
    expect(n!.n).toBe(0)
  })

  it('UPDATE de una sucursal propia hacia la empresa de B se rechaza', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.branches set company_id = ${empresaB} where id = ${sucursalA}`),
    ).rejects.toMatchObject({ code: '42501' })
    const [b] = await sql<{ company_id: string }[]>`
      select company_id from public.branches where id = ${sucursalA}`
    expect(b!.company_id).toBe(empresaA)
  })

  it('un id que no existe recibe el MISMO rechazo que uno ajeno: no hay oraculo', async () => {
    // Antes, la FK respondia 23503 para un id inexistente y aceptaba uno
    // real de otro cliente: la diferencia decia que ids existen en B.
    await expect(
      as(userA, tenantA, (tx) => tx`
        insert into public.branches (tenant_id, company_id, name)
        values (${tenantA}, ${crypto.randomUUID()}, 'Sucursal fantasma')`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/Esa empresa no pertenece/) })
  })
})

describe('Muestras del barrido en el resto del esquema', () => {
  it('warehouses.branch_id (no tenia guarda): un almacen de A no cuelga de la sucursal de B', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        insert into public.warehouses (tenant_id, branch_id, name)
        values (${tenantA}, ${sucursalB}, 'Almacen colado')`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(AJENO) })
  })

  it('products.category_id (no tenia guarda): no se re-categoriza en una categoria de B', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.products set category_id = ${categoriaB} where id = ${productoA}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(AJENO) })
    const [p] = await sql<{ category_id: string }[]>`
      select category_id from public.products where id = ${productoA}`
    expect(p!.category_id).toBe(categoriaA)
  })

  it('attendance_geofences.branch_id (guarda solo al insertar): el UPDATE ya no la esquiva', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.attendance_geofences set branch_id = ${sucursalB} where id = ${geocercaA}`),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(AJENO) })
    const [g] = await sql<{ branch_id: string }[]>`
      select branch_id from public.attendance_geofences where id = ${geocercaA}`
    expect(g!.branch_id).toBe(sucursalA)
  })

  it('la guarda vale tambien para el dueño de la base (seeds, funciones security definer)', async () => {
    await expect(
      sql`insert into public.warehouses (tenant_id, branch_id, name)
          values (${tenantA}, ${sucursalB}, 'Almacen colado por SQL')`,
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('El camino legitimo sigue abierto', () => {
  it('A invita y cambia de rol con SUS roles', async () => {
    const nuevo = crypto.randomUUID()
    await as(userA, tenantA, (tx) => tx`
      insert into public.memberships (tenant_id, user_id, role_id, branch_ids, company_ids)
      values (${tenantA}, ${nuevo}, ${cajeroA},
              ${sql.array([sucursalA])}::uuid[], ${sql.array([empresaA])}::uuid[])`)
    const filas = await as(userA, tenantA, (tx) => tx`
      update public.memberships set role_id = ${ownerA} where user_id = ${nuevo} returning id`)
    expect(filas).toHaveLength(1)
  })

  it('A abre una sucursal y un almacen en lo suyo, y edita la sucursal sin tocar la empresa', async () => {
    const [b] = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`
      insert into public.branches (tenant_id, company_id, name)
      values (${tenantA}, ${empresaA}, 'Sucursal Santiago A') returning id`)
    await as(userA, tenantA, (tx) => tx`
      insert into public.warehouses (tenant_id, branch_id, name)
      values (${tenantA}, ${b!.id}, 'Almacen Santiago A')`)
    const filas = await as(userA, tenantA, (tx) => tx`
      update public.branches set is_active = false where id = ${b!.id} returning id`)
    expect(filas).toHaveLength(1)
  })

  it('una referencia nula no se comprueba (almacen sin sucursal, producto sin categoria)', async () => {
    await as(userA, tenantA, (tx) => tx`
      insert into public.warehouses (tenant_id, branch_id, name)
      values (${tenantA}, null, 'Almacen sin sucursal A')`)
    const filas = await as(userA, tenantA, (tx) => tx`
      update public.products set category_id = null where id = ${productoA} returning id`)
    expect(filas).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  Red de seguridad: la regla vale para TODA la familia, no solo para las
//  muestras de arriba.
// ═══════════════════════════════════════════════════════════════════════
interface Fk {
  tabla: string
  col: string
  ref_tabla: string
}

/**
 * Toda FK SIMPLE de public que va de una tabla con tenant_id a otra con
 * tenant_id. Es el hueco: se valida sin RLS y no mira el cliente.
 *
 * Una FK compuesta que empareja tenant_id con tenant_id -(tenant_id, x)
 * references t (tenant_id, id)- queda fuera a proposito: esa ya es la
 * guarda, la base no deja apuntar a otro cliente por construccion.
 */
const FAMILIA = () => sql`
  select c.conrelid, c.conkey[1] as attnum, src.relname as tabla, ref.relname as ref_tabla,
         (select a.attname from pg_attribute a
           where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) as col
  from pg_constraint c
  join pg_class src on src.oid = c.conrelid
  join pg_namespace ns on ns.oid = src.relnamespace
  join pg_class ref on ref.oid = c.confrelid
  join pg_namespace nr on nr.oid = ref.relnamespace
  where c.contype = 'f' and c.conparentid = 0
    and ns.nspname = 'public' and nr.nspname = 'public'
    and exists (select 1 from pg_attribute where attrelid = c.conrelid
                 and attname = 'tenant_id' and not attisdropped)
    and exists (select 1 from pg_attribute where attrelid = c.confrelid
                 and attname = 'tenant_id' and not attisdropped)
    and not exists (
      select 1 from generate_subscripts(c.conkey, 1) i
      where c.conkey[i]  = (select attnum from pg_attribute
                             where attrelid = c.conrelid and attname = 'tenant_id')
        and c.confkey[i] = (select attnum from pg_attribute
                             where attrelid = c.confrelid and attname = 'tenant_id'))`

async function familia(): Promise<Fk[]> {
  return sql<Fk[]>`select tabla, col, ref_tabla from (${FAMILIA()}) f order by 1, 2`
}

describe('Red de seguridad: toda FK entre tablas con tenant_id tiene guarda', () => {
  it('la familia no esta vacia (si lo esta, la consulta se rompio y la red no mira nada)', async () => {
    // 218 al escribir 0121. Si baja de golpe, alguien rompio la consulta.
    expect((await familia()).length).toBeGreaterThan(200)
  })

  it('NINGUNA FK queda sin guarda de cliente al INSERTAR ni al EDITAR', async () => {
    // Cuenta como guarda:
    //  · el trigger generico de 0121, public.impedir_referencia_ajena(),
    //    con el par (columna, tabla) en sus argumentos; o
    //  · un trigger propio (los impedir_*_ajeno de 0040 en adelante) cuyo
    //    cuerpo lee la tabla referida por new.<columna> y compara contra
    //    new.tenant_id.
    // En los dos casos: BEFORE, habilitado, que dispare en ese evento y,
    // si es `update of`, que la columna este en la lista.
    const faltan = await sql<{ fk: string; evento: string }[]>`
      with fam as (${FAMILIA()}),
      trg as (
        select t.tgrelid, t.tgtype, t.tgattr::int2[] as cols, p.proname, p.prosrc,
               array_remove(string_to_array(encode(t.tgargs, 'escape'), '\\000'), '') as args
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
        join pg_namespace n on n.oid = p.pronamespace
        where not t.tgisinternal and t.tgenabled <> 'D'
          and n.nspname = 'public'
          and (t.tgtype & 2) <> 0            -- BEFORE
          and (t.tgtype & 1) <> 0            -- FOR EACH ROW
      ),
      ev as (select 'INSERT' as evento, 4 as bit union all select 'UPDATE', 16)
      select f.tabla || '.' || f.col || ' -> ' || f.ref_tabla as fk, ev.evento
      from fam f cross join ev
      where not exists (
        select 1 from trg
        where trg.tgrelid = f.conrelid
          and (trg.tgtype & ev.bit) <> 0
          and (ev.evento = 'INSERT' or cardinality(trg.cols) = 0 or f.attnum = any(trg.cols))
          and (
            (trg.proname = 'impedir_referencia_ajena'
              and exists (select 1 from generate_subscripts(trg.args, 1) i
                          where i % 2 = 1 and trg.args[i] = f.col and trg.args[i + 1] = f.ref_tabla))
            or
            (trg.proname <> 'impedir_referencia_ajena'
              and trg.prosrc ~* ('public\\.' || f.ref_tabla || '\\M')
              and trg.prosrc ~* ('new\\.' || f.col || '\\M')
              and trg.prosrc ~* 'new\\.tenant_id')
          )
      )
      order by 1, 2`
    expect(
      faltan,
      `FK sin guarda de cliente:\n${faltan.map((f) => `  ${f.fk} (${f.evento})`).join('\n')}\n` +
        'Una FK a una tabla con tenant_id se comprueba sin RLS: agregale ' +
        "public.impedir_referencia_ajena('<columna>', '<tabla>') en insert y update (ver 0121).",
    ).toHaveLength(0)
  })

  it('ninguna fila de la base apunta hoy a una fila de otro cliente', async () => {
    // Las guardas miran lo que se escribe desde ahora. Esto mira lo que YA
    // estaba: una fila cruzada anterior a 0121 seguiria ahi, en silencio.
    // Los nombres salen del catalogo, no de un usuario; se citan igual.
    const ident = (s: string) => `"${s.replace(/"/g, '""')}"`
    const cruzadas: string[] = []
    for (const f of await familia()) {
      const [r] = await sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n
           from public.${ident(f.tabla)} h
           join public.${ident(f.ref_tabla)} p on p.id = h.${ident(f.col)}
          where p.tenant_id <> h.tenant_id`,
      )
      if (r!.n > 0) cruzadas.push(`${f.tabla}.${f.col} -> ${f.ref_tabla}: ${r!.n}`)
    }
    expect(cruzadas, `Filas que apuntan a otro cliente:\n  ${cruzadas.join('\n  ')}`).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Bitacora de roles', () => {
  it('cambiar los permisos de un rol queda en audit.log con el antes y el despues', async () => {
    await as(userA, tenantA, (tx) => tx`
      update public.roles
         set permissions = permissions || '{"pos.discount.apply": true}'::jsonb
       where id = ${cajeroA}`)
    const filas = await sql<
      { module_id: string; action: string; user_id: string; antes: unknown; despues: unknown }[]
    >`
      select module_id, action, user_id,
             before -> 'permissions' -> 'pos.discount.apply' as antes,
             after  -> 'permissions' -> 'pos.discount.apply' as despues
      from audit.log
      where tenant_id = ${tenantA} and entity = 'roles' and entity_id = ${cajeroA}
        and action = 'update' and user_id = ${userA}`
    // El filtro por usuario no es cosmetico: el alta del tenant ya ajusta
    // los roles de sistema (0032), y eso tambien queda escrito, sin usuario.
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ module_id: 'rbac', user_id: userA, despues: true })
    expect(filas[0]!.antes).not.toBe(true)
  })

  it('crear y borrar un rol tambien queda escrito', async () => {
    const [r] = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`
      insert into public.roles (tenant_id, name) values (${tenantA}, 'Temporal FKG') returning id`)
    await as(userA, tenantA, (tx) => tx`delete from public.roles where id = ${r!.id}`)
    const acciones = await sql<{ action: string }[]>`
      select action from audit.log
      where tenant_id = ${tenantA} and entity = 'roles' and entity_id = ${r!.id}
      order by at, id`
    expect(acciones.map((a) => a.action)).toEqual(['create', 'delete'])
  })

  it('B no lee la bitacora de roles de A', async () => {
    const filas = await as(userB, tenantB, (tx) => tx`
      select id from audit.log where tenant_id = ${tenantA} and entity = 'roles'`)
    expect(filas).toHaveLength(0)
  })
})
