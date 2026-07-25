'use server'

import { revalidatePath } from 'next/cache'
import { can, type Role } from '@regb/permissions'
import { asUser, db } from '@/lib/db'
import { authConfigured, currentSession } from '@/lib/supabase'
import { bootstrap } from '@/lib/bootstrap'

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Escritura de roles y permisos (§8.4)
 *
 *  TODA accion de este archivo comprueba el permiso EN SERVIDOR antes de
 *  tocar nada. Que la UI oculte el boton no cuenta: alguien puede invocar
 *  una server action con fetch directo (§8.3).
 *
 *  Ademas escribe a traves de `asUser`, o sea bajo RLS: aunque el permiso
 *  pasara, un admin no puede tocar los roles de otro cliente.
 * ═══════════════════════════════════════════════════════════════════════
 */

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Contexto de la demostracion.
 *
 * `| undefined` explicito y no `?`: con exactOptionalPropertyTypes activo,
 * "la propiedad puede faltar" y "la propiedad puede valer undefined" son
 * cosas distintas, y quien llama pasa lo segundo.
 */
export type DemoCtx = { tenantSlug: string; roleName: string } | undefined

interface Contexto {
  userId: string
  tenantId: string
  role: Role
  activeModules: Set<string>
}

/**
 * Resuelve quien esta pidiendo la accion.
 *
 * En modo demostracion acepta el tenant y el rol por parametro; con
 * Supabase configurado los ignora y usa la sesion. Esa diferencia importa:
 * en produccion nadie puede decir "hazlo como Owner".
 */
async function contexto(demo?: DemoCtx): Promise<Contexto | null> {
  if (authConfigured) {
    const session = await currentSession()
    if (!session?.tenantId) return null
    const data = await bootstrap({ session })
    if (!data) return null
    return {
      userId: data.user.id,
      tenantId: data.tenant.id,
      role: data.role,
      activeModules: data.hydration.licensedModules,
    }
  }

  if (!demo) return null
  const data = await bootstrap({ demo })
  if (!data) return null
  return {
    userId: data.user.id,
    tenantId: data.tenant.id,
    role: data.role,
    activeModules: data.hydration.licensedModules,
  }
}

/** Comprueba un permiso o devuelve el motivo exacto del rechazo. */
function exigir(ctx: Contexto, accion: string): ActionResult {
  const d = can(
    accion,
    { module: 'rbac' },
    { userId: ctx.userId, role: ctx.role, activeModules: ctx.activeModules },
  )
  return d.allowed ? { ok: true } : { ok: false, error: d.detail }
}

// ═══════════════════════════════════════════════════════════════════════
//  Cambiar un permiso concreto
// ═══════════════════════════════════════════════════════════════════════

export async function setPermission(input: {
  roleId: string
  permission: string
  /** `true` concede, `false` deniega explicitamente, `null` deja sin definir. */
  value: boolean | null
  demo?: DemoCtx
}): Promise<ActionResult> {
  const ctx = await contexto(input.demo)
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'rbac.role.edit')
  if (!permiso.ok) return permiso

  // El permiso tiene que pertenecer a un modulo que el cliente TIENE.
  // Sin esto, un admin podria sembrar permisos de modulos ajenos que se
  // activarian solos el dia que comprara ese modulo.
  const moduleId = input.permission.split('.')[0] ?? ''
  if (!ctx.activeModules.has(moduleId)) {
    return { ok: false, error: `El modulo "${moduleId}" no esta activo para este cliente.` }
  }

  const filas = await asUser(ctx.userId, ctx.tenantId, (tx) =>
    input.value === null
      ? tx<{ id: string }[]>`
          update public.roles
          set permissions = permissions - ${input.permission}
          where id = ${input.roleId} and tenant_id = ${ctx.tenantId}
          returning id`
      : // Casts explicitos en AMBOS argumentos: `jsonb_build_object` acepta
        // "any", asi que Postgres no puede inferir el tipo de un parametro
        // suelto y falla con "could not determine data type of parameter".
        tx<{ id: string }[]>`
          update public.roles
          set permissions = permissions
              || jsonb_build_object(${input.permission}::text, ${input.value}::boolean)
          where id = ${input.roleId} and tenant_id = ${ctx.tenantId}
          returning id`,
  )

  if (filas.length === 0) {
    return { ok: false, error: 'El rol no existe o no pertenece a este cliente.' }
  }

  revalidatePath('/roles')
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════
//  Mostrar u ocultar un modulo en el sidebar
// ═══════════════════════════════════════════════════════════════════════

export async function toggleModuleVisibility(input: {
  roleId: string
  moduleId: string
  visible: boolean
  demo?: DemoCtx
}): Promise<ActionResult> {
  const ctx = await contexto(input.demo)
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'rbac.role.edit')
  if (!permiso.ok) return permiso

  const filas = await asUser(ctx.userId, ctx.tenantId, (tx) =>
    input.visible
      ? tx<{ id: string }[]>`
          update public.roles
          set visible_modules = array(
            select distinct unnest(visible_modules || array[${input.moduleId}])
          )
          where id = ${input.roleId} and tenant_id = ${ctx.tenantId}
          returning id`
      : tx<{ id: string }[]>`
          update public.roles
          set visible_modules = array_remove(visible_modules, ${input.moduleId})
          where id = ${input.roleId} and tenant_id = ${ctx.tenantId}
          returning id`,
  )

  if (filas.length === 0) {
    return { ok: false, error: 'El rol no existe o no pertenece a este cliente.' }
  }

  revalidatePath('/roles')
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════
//  Alcance ABAC
// ═══════════════════════════════════════════════════════════════════════

export async function setScope(input: {
  roleId: string
  key: 'own_only' | 'read_only' | 'max_amount' | 'hours'
  value: boolean | number | string | null
  demo?: DemoCtx
}): Promise<ActionResult> {
  const ctx = await contexto(input.demo)
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'rbac.role.edit')
  if (!permiso.ok) return permiso

  if (input.key === 'max_amount' && typeof input.value === 'number' && input.value < 0) {
    return { ok: false, error: 'El tope de monto no puede ser negativo.' }
  }
  if (
    input.key === 'hours' &&
    typeof input.value === 'string' &&
    !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(input.value)
  ) {
    return { ok: false, error: 'El horario va en formato HH:MM-HH:MM, por ejemplo 07:00-19:00.' }
  }

  const filas = await asUser(ctx.userId, ctx.tenantId, (tx) => {
    if (input.value === null) {
      return tx<{ id: string }[]>`
        update public.roles set scope = scope - ${input.key}
        where id = ${input.roleId} and tenant_id = ${ctx.tenantId} returning id`
    }

    // Una rama por tipo: `jsonb_build_object` no infiere, y meter el cast
    // en un fragmento anidado tampoco funciona porque el parametro sigue
    // llegando suelto al planificador.
    if (typeof input.value === 'boolean') {
      return tx<{ id: string }[]>`
        update public.roles
        set scope = scope || jsonb_build_object(${input.key}::text, ${input.value}::boolean)
        where id = ${input.roleId} and tenant_id = ${ctx.tenantId} returning id`
    }
    if (typeof input.value === 'number') {
      return tx<{ id: string }[]>`
        update public.roles
        set scope = scope || jsonb_build_object(${input.key}::text, ${input.value}::numeric)
        where id = ${input.roleId} and tenant_id = ${ctx.tenantId} returning id`
    }
    return tx<{ id: string }[]>`
      update public.roles
      set scope = scope || jsonb_build_object(${input.key}::text, ${input.value}::text)
      where id = ${input.roleId} and tenant_id = ${ctx.tenantId} returning id`
  })

  if (filas.length === 0) {
    return { ok: false, error: 'El rol no existe o no pertenece a este cliente.' }
  }

  revalidatePath('/roles')
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════
//  Crear y borrar roles
// ═══════════════════════════════════════════════════════════════════════

export async function createRole(input: {
  name: string
  description?: string
  /** Copia los permisos de otro rol como punto de partida. */
  copyFrom?: string
  demo?: DemoCtx
}): Promise<ActionResult & { roleId?: string | undefined }> {
  const ctx = await contexto(input.demo)
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'rbac.role.create')
  if (!permiso.ok) return permiso

  const nombre = input.name.trim()
  if (nombre.length < 2) return { ok: false, error: 'El nombre necesita al menos 2 caracteres.' }

  try {
    const filas = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      let base = { permissions: {}, visible_modules: [] as string[], scope: {} }

      if (input.copyFrom) {
        const [origen] = await tx<
          { permissions: object; visible_modules: string[]; scope: object }[]
        >`select permissions, visible_modules, scope from public.roles
            where id = ${input.copyFrom} and tenant_id = ${ctx.tenantId}`
        if (origen) base = origen as typeof base
      }

      // `sql.json()` y no JSON.stringify + ::jsonb: lo segundo manda el
      // objeto como texto ya codificado y Postgres lo guarda como una
      // CADENA jsonb, no como objeto. El sintoma aparece despues, cuando
      // `||` concatena en vez de fusionar.
      return tx<{ id: string }[]>`
        insert into public.roles
          (tenant_id, name, description, is_system, visible_modules, permissions, scope)
        values (${ctx.tenantId}, ${nombre}, ${input.description ?? null}, false,
                ${base.visible_modules}, ${tx.json(base.permissions)},
                ${tx.json(base.scope)})
        returning id`
    })

    revalidatePath('/roles')
    return { ok: true, roleId: filas[0]?.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/duplicate key/i.test(msg)) {
      return { ok: false, error: `Ya existe un rol llamado "${nombre}".` }
    }
    return { ok: false, error: msg }
  }
}

export async function deleteRole(input: { roleId: string; demo?: DemoCtx }): Promise<ActionResult> {
  const ctx = await contexto(input.demo)
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'rbac.role.delete')
  if (!permiso.ok) return permiso

  const [rol] = await db()<{ is_system: boolean; usados: string }[]>`
    select r.is_system, count(m.id) filter (where m.is_active) as usados
    from public.roles r
    left join public.memberships m on m.role_id = r.id
    where r.id = ${input.roleId} and r.tenant_id = ${ctx.tenantId}
    group by r.id`

  if (!rol) return { ok: false, error: 'El rol no existe o no pertenece a este cliente.' }

  // Los 14 roles de §8.2 son el suelo del producto: sin ellos un cliente
  // nuevo arrancaria con una pantalla de permisos en blanco.
  if (rol.is_system) {
    return {
      ok: false,
      error: 'Los roles predefinidos no se borran. Puedes ajustarlos o crear uno propio.',
    }
  }

  if (Number(rol.usados) > 0) {
    return {
      ok: false,
      error: `${rol.usados} persona(s) tienen este rol. Cambialas de rol antes de borrarlo.`,
    }
  }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`delete from public.roles where id = ${input.roleId} and tenant_id = ${ctx.tenantId}`,
  )

  revalidatePath('/roles')
  return { ok: true }
}
