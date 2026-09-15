import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * `public.contar()` y `public.contar_ciclico()` (0115), contra Postgres
 * real.
 *
 * ── Que vigila esto ───────────────────────────────────────────────────
 *
 * Que contar tenga UNA sola puerta y que esa puerta mire el estado del
 * conteo.
 *
 * Antes de 0115 no lo miraba nadie. La RLS acota el tenant y exige el
 * modulo activo -no el estado del padre-, y el permiso de columna de
 * 0106 corta QUE columna se toca, no CUANDO. O sea que un PATCH a
 * `counted_qty` entraba igual en un conteo ya cerrado.
 *
 * Y cerrar un conteo es lo que convierte la diferencia en movimientos de
 * ajuste del kardex. Despues de eso, cambiar lo contado deja el conteo
 * diciendo una cosa y los ajustes que salieron de el diciendo otra —y el
 * kardex es inmutable (0107), asi que no hay forma de realinearlos—.
 * Quedan dos verdades y ninguna manera de saber cual valia.
 *
 * Quien tiene el telefono es justo quien tiene motivo para que un
 * faltante desaparezca despues de cerrado. Por eso las dos pruebas que
 * mas importan aqui son las del UPDATE directo revocado y la del conteo
 * cerrado.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let rolA: string
let rolSinPermiso: string
let rolB: string
let almacenA: string
let almacenB: string
let productoA: string
let productoB: string

const claims = (userId: string, tenantId: string, roleId: string | null) =>
  JSON.stringify({
    sub: userId,
    app_metadata: { tenant_id: tenantId, role_id: roleId, is_provider: false },
  })

async function as<T>(
  userId: string,
  tenantId: string,
  roleId: string | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenantId, roleId)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

/** Abre un conteo simple con una linea y devuelve el id de la linea. */
async function conteoConLinea(
  tenant: string,
  almacen: string,
  producto: string,
  estado: 'open' | 'closed' = 'open',
): Promise<{ conteo: string; linea: string }> {
  const [c] = await sql`
    insert into public.stock_counts (tenant_id, warehouse_id, status, started_by)
    values (${tenant}, ${almacen}, ${estado}, ${userA}) returning id`
  const [l] = await sql`
    insert into public.stock_count_lines (count_id, tenant_id, product_id, system_qty)
    values (${c!.id}, ${tenant}, ${producto}, 40) returning id`
  return { conteo: c!.id as string, linea: l!.id as string }
}

const contado = async (linea: string) => {
  const [r] = await sql<{ q: string | null }[]>`
    select counted_qty::text as q from public.stock_count_lines where id = ${linea}`
  return r?.q === null || r?.q === undefined ? null : Number(r.q)
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`cnt-a-${RUN}`}, 'Conteos A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`cnt-b-${RUN}`}, 'Conteos B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    for (const m of ['inventory', 'stock-counts']) {
      await sql`
        insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
        values (${t}, ${m}, 'active', true)
        on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
    }
  }

  // Ojo con el cast doble de `permisos`: `::text::jsonb` y no `::jsonb` a
  // secas. Con `::jsonb` Postgres infiere que el parametro ya es jsonb,
  // postgres.js lo serializa otra vez y la columna acaba guardando un
  // jsonb de tipo *string*. Entonces `permissions -> 'inventory.count'`
  // no encuentra nada y el rol parece no tener ningun permiso — o sea,
  // la prueba pasaria por la razon equivocada. Es la trampa que fija
  // jsonb-params.test.ts.
  const rol = async (t: string, nombre: string, permisos: string) => {
    const [r] = await sql`
      insert into public.roles (tenant_id, name, visible_modules, permissions, scope)
      values (${t}, ${nombre}, '{*}', ${permisos}::text::jsonb, '{}'::jsonb)
      returning id`
    return r!.id as string
  }
  rolA = await rol(
    tenantA,
    `Cuenta ${RUN}`,
    '{"inventory.count": true, "stock-counts.count": true}',
  )
  rolSinPermiso = await rol(tenantA, `Mira ${RUN}`, '{"inventory.view": true}')
  rolB = await rol(tenantB, `Cuenta B ${RUN}`, '{"inventory.count": true}')

  const almacen = async (t: string, nombre: string) => {
    const [x] = await sql`
      insert into public.warehouses (tenant_id, name, is_active)
      values (${t}, ${nombre}, true) returning id`
    return x!.id as string
  }
  almacenA = await almacen(tenantA, `A ${RUN}`)
  almacenB = await almacen(tenantB, `B ${RUN}`)

  const producto = async (t: string, sku: string) => {
    const [x] = await sql`
      insert into public.products (tenant_id, sku, name, unit, price, active)
      values (${t}, ${sku}, ${`Producto ${sku}`}, 'und', 100, true) returning id`
    return x!.id as string
  }
  productoA = await producto(tenantA, `CNA-${RUN}`)
  productoB = await producto(tenantB, `CNB-${RUN}`)
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  // Los triggers de 0068 impiden borrar lineas de un conteo que ya no
  // esta en `counting`, y el conteo mismo si fue resuelto. Eso es
  // correcto en produccion y estorba solo aqui, asi que se apagan para
  // la limpieza -como dueño, no como `authenticated`-.
  await sql.unsafe('alter table public.cycle_count_lines disable trigger no_editar_linea_conteo_no_editable')
  await sql.unsafe('alter table public.cycle_counts disable trigger no_editar_conteo_resuelto')
  await sql`delete from public.cycle_count_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.cycle_counts where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.cycle_count_lines enable trigger no_editar_linea_conteo_no_editable')
  await sql.unsafe('alter table public.cycle_counts enable trigger no_editar_conteo_resuelto')
  await sql`delete from public.stock_count_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.stock_counts where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from public.roles where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenant_modules where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Contar, por la puerta', () => {
  it('guarda lo contado', async () => {
    const { linea } = await conteoConLinea(tenantA, almacenA, productoA)
    await as(userA, tenantA, rolA, (tx) => tx`select public.contar(${linea}, 37)`)
    expect(await contado(linea)).toBe(37)
  })

  it('cero es un resultado, no es "sin contar"', async () => {
    // "No hay ninguno" es el hallazgo mas valioso de un conteo.
    // Rechazarlo por parecerse a un campo vacio es como se pierden los
    // faltantes.
    const { linea } = await conteoConLinea(tenantA, almacenA, productoA)
    await as(userA, tenantA, rolA, (tx) => tx`select public.contar(${linea}, 0)`)
    expect(await contado(linea)).toBe(0)
  })

  it('volver a contar la misma linea deja el ultimo numero', async () => {
    // Es una asignacion, no un hecho: por eso la cola del movil puede
    // reintentarla sin `p_ref` y sin miedo.
    const { linea } = await conteoConLinea(tenantA, almacenA, productoA)
    await as(userA, tenantA, rolA, (tx) => tx`select public.contar(${linea}, 40)`)
    await as(userA, tenantA, rolA, (tx) => tx`select public.contar(${linea}, 43)`)
    expect(await contado(linea)).toBe(43)
  })

  it('una cantidad negativa se rechaza', async () => {
    const { linea } = await conteoConLinea(tenantA, almacenA, productoA)
    await expect(
      as(userA, tenantA, rolA, (tx) => tx`select public.contar(${linea}, -1)`),
    ).rejects.toThrow()
    expect(await contado(linea)).toBeNull()
  })
})

describe('Un conteo cerrado ya no se toca', () => {
  it('contar en un conteo cerrado se rechaza', async () => {
    // Cerrar es lo que convierte la diferencia en movimientos de ajuste
    // del kardex. Cambiar lo contado despues deja el conteo diciendo una
    // cosa y los ajustes diciendo otra, y el kardex es inmutable: no hay
    // forma de realinearlos.
    const { linea } = await conteoConLinea(tenantA, almacenA, productoA, 'closed')
    await expect(
      as(userA, tenantA, rolA, (tx) => tx`select public.contar(${linea}, 99)`),
    ).rejects.toThrow(/cerr/i)
    expect(await contado(linea)).toBeNull()
  })

  it('y el UPDATE directo ya no existe como puerta de atras', async () => {
    // Esta es la prueba que sostiene a la anterior. Sin ella, la funcion
    // seria una recomendacion: `authenticated` tenia `grant update
    // (counted_qty)` desde 0106 y podia mandar el PATCH igual.
    const { linea } = await conteoConLinea(tenantA, almacenA, productoA, 'closed')
    await expect(
      as(
        userA,
        tenantA,
        rolA,
        (tx) => tx`update public.stock_count_lines set counted_qty = 99 where id = ${linea}`,
      ),
    ).rejects.toThrow()
    expect(await contado(linea)).toBeNull()
  })

  it('tampoco en uno abierto: la unica via es la funcion', async () => {
    const { linea } = await conteoConLinea(tenantA, almacenA, productoA)
    await expect(
      as(
        userA,
        tenantA,
        rolA,
        (tx) => tx`update public.stock_count_lines set counted_qty = 5 where id = ${linea}`,
      ),
    ).rejects.toThrow()
  })
})

describe('Permiso y cuenta', () => {
  it('sin el permiso de contar, no cuenta', async () => {
    const { linea } = await conteoConLinea(tenantA, almacenA, productoA)
    await expect(
      as(userA, tenantA, rolSinPermiso, (tx) => tx`select public.contar(${linea}, 10)`),
    ).rejects.toThrow(/permite/i)
    expect(await contado(linea)).toBeNull()
  })

  it('una linea de otra cuenta no se puede contar', async () => {
    // La funcion corre como dueño: la RLS no la frena. Lo unico que
    // separa a un cliente de otro aqui son los `where tenant_id` de la
    // consulta que busca la linea.
    const { linea } = await conteoConLinea(tenantA, almacenA, productoA)
    await expect(
      as(userB, tenantB, rolB, (tx) => tx`select public.contar(${linea}, 10)`),
    ).rejects.toThrow(/no es de esta cuenta/i)
    expect(await contado(linea)).toBeNull()
  })

  it('y B si puede contar lo suyo: aislar no rompe lo propio', async () => {
    const { linea } = await conteoConLinea(tenantB, almacenB, productoB)
    await as(userB, tenantB, rolB, (tx) => tx`select public.contar(${linea}, 8)`)
    expect(await contado(linea)).toBe(8)
  })
})

describe('Conteo ciclico: el vocabulario es otro', () => {
  const ciclicoConLinea = async (
    estado: 'counting' | 'pending_approval' | 'approved',
  ): Promise<string> => {
    const [c] = await sql`
      insert into public.cycle_counts (tenant_id, warehouse_id, status, started_by)
      values (${tenantA}, ${almacenA}, ${estado}, ${userA}) returning id`
    const [l] = await sql`
      insert into public.cycle_count_lines (count_id, tenant_id, product_id, system_qty)
      values (${c!.id}, ${tenantA}, ${productoA}, 40) returning id`
    return l!.id as string
  }

  const contadoCiclico = async (linea: string) => {
    const [r] = await sql<{ q: string | null }[]>`
      select counted_qty::text as q from public.cycle_count_lines where id = ${linea}`
    return r?.q === null || r?.q === undefined ? null : Number(r.q)
  }

  it('se cuenta mientras esta en `counting`', async () => {
    const linea = await ciclicoConLinea('counting')
    await as(userA, tenantA, rolA, (tx) => tx`select public.contar_ciclico(${linea}, 12)`)
    expect(await contadoCiclico(linea)).toBe(12)
  })

  it('ya enviado a aprobacion, no', async () => {
    // Esta delante de un supervisor. Cambiarle el numero es cambiarle la
    // respuesta a alguien que ya esta decidiendo sobre ella.
    const linea = await ciclicoConLinea('pending_approval')
    await expect(
      as(userA, tenantA, rolA, (tx) => tx`select public.contar_ciclico(${linea}, 99)`),
    ).rejects.toThrow(/aprobacion/i)
    expect(await contadoCiclico(linea)).toBeNull()
  })

  it('ya aprobado, tampoco: eso ya movio inventario', async () => {
    const linea = await ciclicoConLinea('approved')
    await expect(
      as(userA, tenantA, rolA, (tx) => tx`select public.contar_ciclico(${linea}, 99)`),
    ).rejects.toThrow()
    expect(await contadoCiclico(linea)).toBeNull()
  })

  it('y el UPDATE directo tampoco existe aqui', async () => {
    const linea = await ciclicoConLinea('counting')
    await expect(
      as(
        userA,
        tenantA,
        rolA,
        (tx) => tx`update public.cycle_count_lines set counted_qty = 99 where id = ${linea}`,
      ),
    ).rejects.toThrow()
  })

  it('lo que 0115 agrega de nuevo al ciclico es el PERMISO', async () => {
    // El estado ya lo cuidaba el trigger de 0068. Lo que no miraba nadie
    // es QUIEN: la politica de RLS de `cycle_count_lines` solo acota
    // tenant y modulo, asi que un cajero con su token podia mandar el
    // PATCH y escribir lo contado de un conteo en curso.
    const linea = await ciclicoConLinea('counting')
    await expect(
      as(userA, tenantA, rolSinPermiso, (tx) => tx`select public.contar_ciclico(${linea}, 10)`),
    ).rejects.toThrow(/permite/i)
    expect(await contadoCiclico(linea)).toBeNull()
  })
})
