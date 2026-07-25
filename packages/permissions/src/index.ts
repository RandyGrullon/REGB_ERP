/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Evaluador de permisos de Nexus ERP — RBAC + ABAC
 *
 *  Documento maestro §8.1:
 *
 *    puede(usuario, accion, recurso) =
 *          modulo_activo_en_tenant(recurso.modulo)
 *      AND rol_tiene_permiso(usuario.rol, accion)
 *      AND dentro_del_alcance(usuario.scope, recurso)
 *      AND NOT denegacion_explicita(usuario, accion)
 *
 *  LA DENEGACION SIEMPRE GANA. Ninguna concesion, por especifica que sea,
 *  puede vencer a una denegacion explicita.
 *
 *  Este codigo corre en las tres plataformas Y en el servidor. La UI lo usa
 *  para ocultar botones; el servidor, para devolver 403. Ocultar el boton
 *  nunca es suficiente (§8.3).
 * ═══════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod'

// ── Contratos ──────────────────────────────────────────────────────────

/** Alcance ABAC: acota QUE FILAS ve el usuario, no que acciones puede. */
export const scopeSchema = z.object({
  /** Solo estas sucursales. Vacio = todas las del tenant. */
  branches: z.array(z.string().uuid()).optional(),
  /** Solo estas empresas. Vacio = todas. */
  companies: z.array(z.string().uuid()).optional(),
  /** Tope de monto que puede aprobar o crear. */
  max_amount: z.number().nonnegative().optional(),
  /** Solo ve lo que creo el mismo (vendedor, tecnico, empleado). */
  own_only: z.boolean().optional(),
  /** Rol de auditoria: lee todo, no escribe nada. */
  read_only: z.boolean().optional(),
  /** Ventana horaria "HH:MM-HH:MM" en la zona del tenant. */
  hours: z
    .string()
    .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)
    .optional(),
})
export type Scope = z.infer<typeof scopeSchema>

export interface Role {
  id: string
  name: string
  /** Modulos visibles en el sidebar. `['*']` = todos. Ergonomia, no seguridad. */
  visibleModules: string[]
  /** `{ "quotes.create": true, "quotes.approve": false }`. Admite comodines. */
  permissions: Record<string, boolean>
  scope: Scope
}

/** Lo que se esta intentando tocar. */
export interface Resource {
  /** Id del modulo al que pertenece, ej. 'inventory'. */
  module: string
  /** Sucursal de la fila, si aplica. */
  branchId?: string
  /** Empresa de la fila, si aplica. */
  companyId?: string
  /** Quien creo la fila — para `own_only`. */
  ownerId?: string
  /** Monto involucrado — para `max_amount`. */
  amount?: number
}

export interface EvaluationContext {
  role: Role
  /** Modulos licenciados Y encendidos para el tenant. Sale del bootstrap. */
  activeModules: ReadonlySet<string>
  userId: string
  /** Minutos desde medianoche en la zona del tenant. Para `hours`. */
  minutesOfDay?: number
}

/** Resultado explicito: siempre se sabe POR QUE se denego. */
export type Decision =
  | { allowed: true }
  | {
      allowed: false
      reason:
        | 'module-not-licensed'
        | 'no-permission'
        | 'explicitly-denied'
        | 'out-of-branch'
        | 'out-of-company'
        | 'not-owner'
        | 'amount-exceeded'
        | 'read-only'
        | 'outside-hours'
      detail: string
    }

// ── Acciones y comodines ───────────────────────────────────────────────

/** Acciones que escriben. Un rol `read_only` no puede ejecutarlas. */
const WRITE_ACTIONS = new Set([
  'create',
  'edit',
  'update',
  'delete',
  'approve',
  'reject',
  'adjust',
  'transfer',
  'post',
  'void',
  'sell',
  'pay',
  'consume',
  'execute',
  'request',
])

/**
 * Patrones que cubren una accion, del mas especifico al mas general.
 *
 * Para `inventory.cost.view` devuelve:
 *   inventory.cost.view · inventory.cost.* · inventory.* · *.view · *
 */
export function matchingPatterns(action: string): string[] {
  const parts = action.split('.')
  const patterns: string[] = [action]

  for (let i = parts.length - 1; i > 0; i--) {
    patterns.push(`${parts.slice(0, i).join('.')}.*`)
  }

  const last = parts.at(-1)
  if (last && parts.length > 1) patterns.push(`*.${last}`)

  patterns.push('*')
  return patterns
}

/** El verbo final de la accion: `inventory.cost.view` → `view`. */
const verbOf = (action: string): string => action.split('.').at(-1) ?? action

// ═══════════════════════════════════════════════════════════════════════
//  El evaluador
// ═══════════════════════════════════════════════════════════════════════

export function can(action: string, resource: Resource, ctx: EvaluationContext): Decision {
  const { role, activeModules } = ctx

  // ── 1. ¿El tenant tiene el modulo? ───────────────────────────────────
  // Se comprueba PRIMERO: un modulo no licenciado no existe, y no queremos
  // filtrar por el mensaje de error que si existe pero falta permiso.
  if (!activeModules.has(resource.module)) {
    return {
      allowed: false,
      reason: 'module-not-licensed',
      detail: `El modulo "${resource.module}" no esta activo para este cliente.`,
    }
  }

  // ── 2. Permisos del rol, con la denegacion ganando siempre ───────────
  const patterns = matchingPatterns(action)

  // Una sola denegacion explicita, en cualquier nivel de especificidad,
  // cierra la puerta. No hay concesion que la venza.
  for (const p of patterns) {
    if (role.permissions[p] === false) {
      return {
        allowed: false,
        reason: 'explicitly-denied',
        detail: `El rol "${role.name}" tiene denegado "${p}".`,
      }
    }
  }

  const granted = patterns.some((p) => role.permissions[p] === true)
  if (!granted) {
    return {
      allowed: false,
      reason: 'no-permission',
      detail: `El rol "${role.name}" no concede "${action}".`,
    }
  }

  // ── 3. Alcance ABAC ──────────────────────────────────────────────────
  const { scope } = role
  const isWrite = WRITE_ACTIONS.has(verbOf(action))

  if (scope.read_only && isWrite) {
    return {
      allowed: false,
      reason: 'read-only',
      detail: `El rol "${role.name}" es de solo lectura.`,
    }
  }

  if (scope.branches?.length && resource.branchId && !scope.branches.includes(resource.branchId)) {
    return {
      allowed: false,
      reason: 'out-of-branch',
      detail: 'El registro pertenece a una sucursal fuera de tu alcance.',
    }
  }

  if (
    scope.companies?.length &&
    resource.companyId &&
    !scope.companies.includes(resource.companyId)
  ) {
    return {
      allowed: false,
      reason: 'out-of-company',
      detail: 'El registro pertenece a una empresa fuera de tu alcance.',
    }
  }

  if (scope.own_only && resource.ownerId && resource.ownerId !== ctx.userId) {
    return {
      allowed: false,
      reason: 'not-owner',
      detail: 'Solo puedes operar sobre los registros que creaste.',
    }
  }

  if (scope.max_amount !== undefined && resource.amount !== undefined) {
    if (resource.amount > scope.max_amount) {
      return {
        allowed: false,
        reason: 'amount-exceeded',
        detail: `El monto supera tu limite de ${scope.max_amount.toLocaleString('es-DO')}.`,
      }
    }
  }

  if (
    scope.hours &&
    ctx.minutesOfDay !== undefined &&
    !withinHours(scope.hours, ctx.minutesOfDay)
  ) {
    return {
      allowed: false,
      reason: 'outside-hours',
      detail: `Tu rol solo opera en el horario ${scope.hours}.`,
    }
  }

  return { allowed: true }
}

/** Azucar para la UI, donde solo interesa mostrar u ocultar. */
export const allowed = (action: string, resource: Resource, ctx: EvaluationContext): boolean =>
  can(action, resource, ctx).allowed

/**
 * ¿Se muestra el modulo en el sidebar?
 *
 * OJO: esto es ergonomia. La seguridad real vive en RLS y en la validacion
 * de servidor. Un usuario que adivine la URL recibe 403, no datos (§8.3).
 */
export function moduleVisible(moduleId: string, ctx: EvaluationContext): boolean {
  if (!ctx.activeModules.has(moduleId)) return false
  const list = ctx.role.visibleModules
  return list.includes('*') || list.includes(moduleId)
}

// ── Utilidades ─────────────────────────────────────────────────────────

function withinHours(range: string, minutes: number): boolean {
  const [from, to] = range.split('-')
  if (!from || !to) return true

  const parse = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }

  const start = parse(from)
  const end = parse(to)

  // Turno nocturno (22:00-06:00) cruza la medianoche.
  return start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end
}

export { scopeSchema as ScopeSchema }
