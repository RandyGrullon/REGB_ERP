import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * `public.mis_modulos()` (0105) contra Postgres real.
 *
 * Existe para que la app movil sepa que modulos tiene el cliente:
 * `regb.tenant_modules` vive en un esquema que PostgREST no expone.
 *
 * Lo que se prueba aqui NO es que devuelva la lista -eso es lo facil-
 * sino que la lista sea LA DEL QUE LLAMA. Es una funcion
 * `security definer`: corre con los permisos de su dueño y la RLS no la
 * frena. Si el filtro por tenant se equivoca, un cliente ve el catalogo
 * contratado de otro, que es informacion comercial de la competencia.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string

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

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`mods-a-${RUN}`}, 'Modulos A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`mods-b-${RUN}`}, 'Modulos B SRL', 'mediano', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  const poner = (t: string, m: string, estado: string, encendido: boolean) => sql`
    insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
    values (${t}, ${m}, ${estado}, ${encendido})
    on conflict (tenant_id, module_id) do update
      set status = ${estado}, enabled = ${encendido}`

  await poner(tenantA, 'inventory', 'active', true)
  await poner(tenantA, 'chat', 'trial', true)
  await poner(tenantA, 'payroll', 'active', false) // contratado pero apagado
  await poner(tenantA, 'crm', 'suspended', true) // suspendido por falta de pago

  await poner(tenantB, 'manufacturing', 'active', true)
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from regb.tenant_modules where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

const modulosDe = (u: string, t: string) =>
  as(u, t, async (tx) => {
    const filas = await tx<{ module_id: string }[]>`select module_id from public.mis_modulos()`
    return filas.map((f) => f.module_id).sort()
  })

describe('Cada quien ve lo suyo', () => {
  /**
   * No se afirma la lista EXACTA: al crear un tenant, un trigger le
   * provisiona los modulos core -settings, users, tour...-. Fijar aqui
   * esa lista obligaria a tocar esta prueba cada vez que el catalogo
   * core cambie, y una prueba que hay que editar para que siga pasando
   * deja de vigilar nada.
   *
   * Lo que si se afirma sin margen es lo unico que puede hacer daño: que
   * no se cuele un modulo del OTRO cliente.
   */
  it('A ve lo que contrato A', async () => {
    const m = await modulosDe(userA, tenantA)
    expect(m).toContain('inventory')
    expect(m).toContain('chat')
  })

  it('B ve lo que contrato B', async () => {
    expect(await modulosDe(userB, tenantB)).toContain('manufacturing')
  })

  it('y lo de A no aparece en B', async () => {
    expect(await modulosDe(userB, tenantB)).not.toContain('inventory')
  })

  it('lo de B NUNCA sale en la lista de A', async () => {
    // Es el punto entero de la prueba. `security definer` desactiva la
    // RLS: lo unico que separa a los dos clientes es el `where` de la
    // funcion. Que modulos paga un negocio es informacion comercial.
    expect(await modulosDe(userA, tenantA)).not.toContain('manufacturing')
  })
})

describe('Estar contratado no es lo mismo que estar encendido', () => {
  it('un modulo apagado no sale', async () => {
    // Contratado pero `enabled = false`: el cliente lo pago y lo apago.
    // Enseñarlo en el menu del telefono lleva a una pantalla que no va.
    expect(await modulosDe(userA, tenantA)).not.toContain('payroll')
  })

  it('uno suspendido tampoco, aunque siga encendido', async () => {
    // Suspendido es lo que pasa cuando alguien deja de pagar. Que la
    // bandera `enabled` siga en true no le devuelve el acceso.
    expect(await modulosDe(userA, tenantA)).not.toContain('crm')
  })

  it('uno en prueba SI sale: para eso es la prueba', async () => {
    expect(await modulosDe(userA, tenantA)).toContain('chat')
  })
})

describe('El tenant sale del token, no de quien llama', () => {
  it('no acepta un tenant por argumento', async () => {
    // Si algun dia alguien le agrega un parametro, esta prueba se cae.
    // Recibir el tenant por argumento es justo lo que prohibe la puerta
    // F0: un id que viaja desde el cliente y decide que datos salen.
    const [f] = await sql<{ n: number }[]>`
      select count(*)::int as n
      from information_schema.parameters
      where specific_schema = 'public'
        and specific_name like 'mis_modulos%'
        and parameter_mode = 'IN'`
    expect(f!.n).toBe(0)
  })

  it('sin sesion no devuelve nada de nadie', async () => {
    const filas = await sql.begin(async (tx) => {
      await tx.unsafe('set local role authenticated')
      return tx<{ module_id: string }[]>`select module_id from public.mis_modulos()`
    })
    expect(filas).toEqual([])
  })
})
