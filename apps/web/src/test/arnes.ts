import { db } from '@/lib/db'

/**
 * Arnes para llamar SERVER ACTIONS REALES desde una prueba.
 *
 * La accion corre tal cual: actionCtx() -> exigir() -> asUser() -> RLS ->
 * funciones de la base. Lo unico que se pone por fuera es lo que Next
 * pondria (cookies, cache), en preparar.ts.
 *
 * El contexto sale del MODO DEMOSTRACION: sin Supabase configurado,
 * actionCtx() busca el tenant por slug y el rol por nombre en el
 * FormData. Asi que cada prueba siembra su propio cliente con un slug
 * aleatorio y le da a su rol exactamente los permisos que quiere probar.
 *
 * El slug sigue el patron que `scripts/limpiar-tenants-de-prueba.mjs`
 * reconoce: si una prueba se cae antes del afterAll, el residuo se barre.
 */

// ── Cookies de mentira, compartidas con el mock de next/headers ─────────

interface Galleta {
  name: string
  value: string
}

const galletas = new Map<string, Galleta>()

export const tarro = {
  get: (name: string): Galleta | undefined => galletas.get(name),
  getAll: (): Galleta[] => [...galletas.values()],
  has: (name: string): boolean => galletas.has(name),
  set: (a: string | { name: string; value: string }, b?: string): void => {
    const g = typeof a === 'string' ? { name: a, value: b ?? '' } : { name: a.name, value: a.value }
    galletas.set(g.name, g)
  },
  delete: (name: string): void => {
    galletas.delete(name)
  },
}

// ── Cliente sembrado ────────────────────────────────────────────────────

export interface ClientePrueba {
  tenantId: string
  slug: string
  /**
   * FormData listo para la accion, con tenant y rol ya puestos.
   * `rol` por defecto es el primero que se sembro.
   */
  fd: (campos?: Record<string, string>, rol?: string) => FormData
  /** Enciende o apaga un modulo, para probar la guarda de modulo apagado. */
  modulo: (id: string, encendido: boolean) => Promise<void>
  /**
   * Borra el cliente. `antes` son tablas a vaciar primero, en orden, por
   * si alguna no cae en cascada con el tenant.
   */
  limpiar: (antes?: string[]) => Promise<void>
}

export async function sembrarCliente(opciones: {
  prefijo?: string
  nombre?: string
  modulos: string[]
  /** Nombre del rol -> permisos. La primera entrada es el rol por defecto. */
  roles: Record<string, Record<string, boolean>>
}): Promise<ClientePrueba> {
  const sql = db()
  const slug = `${opciones.prefijo ?? 'accion'}-${crypto.randomUUID().slice(0, 8)}`

  const [t] = await sql<{ id: string }[]>`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${slug}, ${opciones.nombre ?? 'Comercial de Prueba SRL'}, 'pyme', 'active')
    returning id`
  const tenantId = t!.id

  try {
    await sembrarDentro(tenantId, opciones.modulos, opciones.roles)
  } catch (e) {
    // Un tenant a medio sembrar no le sirve a nadie y ensucia el selector
    // de la demo: se borra aqui mismo, antes de propagar el error.
    await sql`delete from audit.log where tenant_id = ${tenantId}`
    await sql`delete from regb.tenants where id = ${tenantId}`
    throw e
  }
  const nombres = Object.keys(opciones.roles)

  return {
    tenantId,
    slug,
    fd: (campos = {}, rol = nombres[0]!) => {
      const f = new FormData()
      f.set('tenant', slug)
      f.set('rol', rol)
      for (const [k, v] of Object.entries(campos)) f.set(k, v)
      return f
    },
    modulo: async (id, encendido) => {
      await sql`
        update regb.tenant_modules set enabled = ${encendido}
        where tenant_id = ${tenantId} and module_id = ${id}`
    },
    limpiar: async (antes = []) => {
      for (const tabla of antes) {
        await sql.unsafe(`delete from ${tabla} where tenant_id = $1`, [tenantId])
      }
      await sql`delete from public.event_outbox where tenant_id = ${tenantId}`
      await sql`delete from audit.log where tenant_id = ${tenantId}`
      await sql`delete from regb.tenants where id = ${tenantId}`
    },
  }
}

async function sembrarDentro(
  tenantId: string,
  modulos: string[],
  roles: Record<string, Record<string, boolean>>,
): Promise<void> {
  const sql = db()
  for (const m of modulos) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${tenantId}, ${m}, 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const nombres = Object.keys(roles)
  if (nombres.length === 0) throw new Error('sembrarCliente: hace falta al menos un rol')
  for (const nombre of nombres) {
    // `on conflict`: crear el tenant ya provisiona los roles de sistema
    // (Owner, Contador...). Si la prueba usa uno de esos nombres, manda lo
    // que la prueba dice, no lo que traiga la plantilla ese dia.
    // TRAMPA JSONB: `${cadena}::jsonb` guarda un STRING json, no un objeto,
    // y el rol queda sin ningun permiso sin que nada falle.
    await sql`
      insert into public.roles (tenant_id, name, visible_modules, permissions)
      values (${tenantId}, ${nombre}, ${modulos},
              ${JSON.stringify(roles[nombre])}::text::jsonb)
      on conflict (tenant_id, name) do update
        set visible_modules = excluded.visible_modules,
            permissions = excluded.permissions,
            scope = '{}'::jsonb`
  }
}

/** Cierra el pool de lib/db: sin esto vitest espera a que expire. */
export async function cerrarBase(): Promise<void> {
  await globalThis.__regbDb?.end()
  globalThis.__regbDb = undefined
}
