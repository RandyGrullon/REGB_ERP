/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Lectura de la sesion — logica pura
 *
 *  Traduce los claims que puso `auth.custom_access_token_hook` a algo que
 *  la app pueda usar. No habla con la red: recibe claims, devuelve sesion.
 *
 *  REGLA QUE NO SE NEGOCIA: el `tenantId` sale de aqui y de ningun otro
 *  sitio. Si alguna vez lees un tenant de un formulario, una ruta o una
 *  query string, has abierto el producto entero (§10).
 * ═══════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod'

/** Lo que el hook inyecta en `app_metadata`. */
export const appMetadataSchema = z.object({
  tenant_id: z.string().uuid().nullable().default(null),
  role_id: z.string().uuid().nullable().default(null),
  is_provider: z.boolean().default(false),
  provider_role: z.string().nullable().default(null),
  tenant_status: z.string().nullable().default(null),
  branches: z.array(z.string().uuid()).default([]),
  companies: z.array(z.string().uuid()).default([]),
})
export type AppMetadata = z.infer<typeof appMetadataSchema>

export interface RegbSession {
  userId: string
  email: string
  tenantId: string | null
  roleId: string | null
  isProvider: boolean
  providerRole: string | null
  tenantStatus: string | null
  branchIds: string[]
  companyIds: string[]
}

/** Por que un usuario autenticado todavia no puede operar. */
export type SessionBlock =
  | { blocked: false }
  | { blocked: true; reason: 'no-membership'; message: string }
  | { blocked: true; reason: 'tenant-suspended'; message: string }
  | { blocked: true; reason: 'tenant-archived'; message: string }

/**
 * Interpreta un usuario de Supabase como sesion de REGB.
 *
 * Tolerante a claims incompletos a proposito: si el hook fallo o el token
 * es viejo, `tenantId` queda en null y RLS no devuelve nada. Fallar cerrado.
 */
export function readSession(user: {
  id: string
  email?: string | undefined
  app_metadata?: unknown
}): RegbSession {
  const parsed = appMetadataSchema.safeParse(user.app_metadata ?? {})
  const meta: AppMetadata = parsed.success
    ? parsed.data
    : {
        tenant_id: null,
        role_id: null,
        is_provider: false,
        provider_role: null,
        tenant_status: null,
        branches: [],
        companies: [],
      }

  return {
    userId: user.id,
    email: user.email ?? '',
    tenantId: meta.tenant_id,
    roleId: meta.role_id,
    isProvider: meta.is_provider,
    providerRole: meta.provider_role,
    tenantStatus: meta.tenant_status,
    branchIds: meta.branches,
    companyIds: meta.companies,
  }
}

/**
 * ¿Puede este usuario entrar al ERP?
 *
 * Distingue los tres motivos por los que un login correcto no basta, para
 * poder decirle a la persona QUE pasa en vez de un 403 mudo (§11.7).
 */
export function checkAccess(session: RegbSession): SessionBlock {
  if (session.isProvider) return { blocked: false }

  if (session.tenantStatus === 'archived') {
    return {
      blocked: true,
      reason: 'tenant-archived',
      message:
        'La cuenta de tu empresa esta archivada. Tus datos siguen intactos; escribe a soporte para reactivarla.',
    }
  }

  if (session.tenantStatus === 'suspended') {
    return {
      blocked: true,
      reason: 'tenant-suspended',
      message:
        'El acceso de tu empresa esta suspendido por falta de pago. Nada se ha borrado: al regularizar vuelve todo.',
    }
  }

  if (!session.tenantId) {
    return {
      blocked: true,
      reason: 'no-membership',
      message:
        'Tu cuenta existe pero todavia no perteneces a ninguna empresa. Pidele a tu administrador que te invite.',
    }
  }

  return { blocked: false }
}

/** El cliente esta en mora: se opera, pero con aviso (§6.6, dia 10). */
export const isPastDue = (session: RegbSession): boolean => session.tenantStatus === 'past_due'
