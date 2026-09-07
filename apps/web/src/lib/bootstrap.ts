import 'server-only'

import { asUser, db } from './db'
import { hydrate, type ModuleManifest, type TenantModule } from '@regb/module-registry'
import type { Role } from '@regb/permissions'
import type { RegbSession } from '@regb/sdk'

import productsManifest from '@regb/mod-products'
import inventoryManifest from '@regb/mod-inventory'
import posManifest from '@regb/mod-pos'
import salesOrdersManifest from '@regb/mod-sales-orders'
import purchaseOrdersManifest from '@regb/mod-purchase-orders'
import arManifest from '@regb/mod-ar'
import apManifest from '@regb/mod-ap'
import accountingManifest from '@regb/mod-accounting'
import treasuryManifest from '@regb/mod-treasury'
import bankRecManifest from '@regb/mod-bank-rec'
import fixedAssetsManifest from '@regb/mod-fixed-assets'
import budgetsManifest from '@regb/mod-budgets'
import costCentersManifest from '@regb/mod-cost-centers'
import multicurrencyManifest from '@regb/mod-multicurrency'
import paymentsManifest from '@regb/mod-payments'
import employeesManifest from '@regb/mod-employees'
import attendanceManifest from '@regb/mod-attendance'
import timeOffManifest from '@regb/mod-time-off'
import expensesManifest from '@regb/mod-expenses'
import hrPortalManifest from '@regb/mod-hr-portal'
import benefitsManifest from '@regb/mod-benefits'
import recruitingManifest from '@regb/mod-recruiting'
import performanceManifest from '@regb/mod-performance'
import trainingManifest from '@regb/mod-training'
import suppliersManifest from '@regb/mod-suppliers'
import priceListsManifest from '@regb/mod-price-lists'
import requisitionsManifest from '@regb/mod-requisitions'
import rfqManifest from '@regb/mod-rfq'
import receiptsManifest from '@regb/mod-receipts'
import lotsSerialsManifest from '@regb/mod-lots-serials'
import transfersManifest from '@regb/mod-transfers'
import payrollManifest from '@regb/mod-payroll'
import invoiceCaptureManifest from '@regb/mod-invoice-capture'
import authManifest from '@regb/mod-auth'
import usersManifest from '@regb/mod-users'
import orgsManifest from '@regb/mod-orgs'
import branchesManifest from '@regb/mod-branches'
import settingsManifest from '@regb/mod-settings'
import dashboardManifest from '@regb/mod-dashboard'
import searchManifest from '@regb/mod-search'
import notificationsManifest from '@regb/mod-notifications'
import auditManifest from '@regb/mod-audit'
import filesManifest from '@regb/mod-files'
import importsManifest from '@regb/mod-imports'
import backupManifest from '@regb/mod-backup'
import tourManifest from '@regb/mod-tour'

/**
 * Bootstrap del shell.
 *
 * Documento maestro §2.3: la app arranca preguntando al servidor QUE modulos
 * tiene el cliente y QUE puede hacer este usuario. El sidebar se construye
 * con esa respuesta, no con una lista cableada.
 *
 * Ninguna regla de negocio vive aqui: solo lee y delega en el registry.
 */

/**
 * Manifests disponibles en este bundle.
 *
 * Es lo unico que el shell "conoce" de los modulos, y aun asi no decide
 * nada: si el tenant no los tiene licenciados, no se cargan.
 */
export const MANIFESTS = new Map<string, ModuleManifest>(
  [
    // Plataforma (core)
    authManifest,
    usersManifest,
    orgsManifest,
    branchesManifest,
    settingsManifest,
    dashboardManifest,
    searchManifest,
    notificationsManifest,
    auditManifest,
    filesManifest,
    importsManifest,
    backupManifest,
    tourManifest,
    productsManifest,
    // Negocio
    inventoryManifest,
    posManifest,
    salesOrdersManifest,
    purchaseOrdersManifest,
    arManifest,
    apManifest,
    accountingManifest,
    treasuryManifest,
    bankRecManifest,
    fixedAssetsManifest,
    budgetsManifest,
    costCentersManifest,
    multicurrencyManifest,
    paymentsManifest,
    employeesManifest,
    attendanceManifest,
    timeOffManifest,
    expensesManifest,
    hrPortalManifest,
    benefitsManifest,
    recruitingManifest,
    performanceManifest,
    trainingManifest,
    suppliersManifest,
    priceListsManifest,
    requisitionsManifest,
    rfqManifest,
    receiptsManifest,
    lotsSerialsManifest,
    transfersManifest,
    payrollManifest,
    invoiceCaptureManifest,
  ].map((m) => [m.id, m]),
)

export interface BootstrapResult {
  tenant: { id: string; name: string; tier: string; status: string }
  role: Role
  user: { id: string; name: string; initials: string; email: string }
  hydration: ReturnType<typeof hydrate>
}

interface BootstrapInput {
  /** Sesion real. Si viene, manda ella: el tenant sale del JWT. */
  session?: RegbSession | null
  /** Modo demostracion: tenant y rol por URL. Ignorado si hay sesion. */
  demo?: { tenantSlug: string; roleName: string }
  platform?: 'web' | 'desktop' | 'mobile'
}

export async function bootstrap({
  session,
  demo,
  platform = 'web',
}: BootstrapInput): Promise<BootstrapResult | null> {
  const sql = db()

  let tenantId: string
  let roleId: string
  let userId: string
  let email: string

  if (session?.tenantId && session.roleId) {
    // Camino real: todo sale del JWT que emitio el hook.
    tenantId = session.tenantId
    roleId = session.roleId
    userId = session.userId
    email = session.email
  } else if (demo) {
    const [t] = await sql<{ id: string }[]>`
      select id from regb.tenants where slug = ${demo.tenantSlug}`
    if (!t) return null
    const [r] = await sql<{ id: string }[]>`
      select id from public.roles where tenant_id = ${t.id} and name = ${demo.roleName}`
    if (!r) return null
    tenantId = t.id
    roleId = r.id
    userId = '00000000-0000-0000-0000-000000000001'
    email = 'maria.rosario@demo.do'
  } else {
    return null
  }

  const [tenant] = await sql<{ id: string; legal_name: string; tier: string; status: string }[]>`
    select id, legal_name, tier, status from regb.tenants where id = ${tenantId}`
  if (!tenant) return null

  const [role] = await sql<
    {
      id: string
      name: string
      visible_modules: string[]
      permissions: Record<string, boolean>
      scope: Record<string, unknown>
    }[]
  >`select id, name, visible_modules, permissions, scope
      from public.roles where id = ${roleId}`
  if (!role) return null

  // ── A partir de aqui, TODO pasa por RLS ──────────────────────────────
  const tenantModules = await asUser(
    userId,
    tenant.id,
    (tx) => tx<
      { module_id: string; status: string; enabled: boolean; trial_ends_at: string | null }[]
    >`
      select module_id, status, enabled, trial_ends_at
      from regb.tenant_modules
      where tenant_id = ${tenant.id}`,
  )

  const roleObj: Role = {
    id: role.id,
    name: role.name,
    visibleModules: role.visible_modules,
    permissions: role.permissions,
    scope: role.scope,
  }

  const hydration = hydrate({
    tenantModules: tenantModules.map((r): TenantModule => ({
      moduleId: r.module_id,
      status: r.status as TenantModule['status'],
      enabled: r.enabled,
      trialEndsAt: r.trial_ends_at,
    })),
    manifests: MANIFESTS,
    ctx: { userId, role: roleObj },
    platform,
  })

  const nombre = (email.split('@')[0] ?? 'usuario').replace(/[._-]/g, ' ')
  const display = nombre.replace(/\b\w/g, (c) => c.toUpperCase())

  return {
    tenant: { id: tenant.id, name: tenant.legal_name, tier: tenant.tier, status: tenant.status },
    role: roleObj,
    user: {
      id: userId,
      email,
      name: display,
      initials: display
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join(''),
    },
    hydration,
  }
}

/** Empresas disponibles, para el selector. Solo en modo demostracion. */
export async function listTenants(): Promise<
  { id: string; slug: string; name: string; initials: string; tier: string }[]
> {
  const rows = await db()<{ id: string; slug: string; legal_name: string; tier: string }[]>`
    select id, slug, legal_name, tier from regb.tenants order by legal_name`
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.legal_name,
    tier: r.tier,
    initials: r.legal_name
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join(''),
  }))
}

/** Roles del tenant, para cambiar de perspectiva en la demostracion. */
export async function listRoles(tenantId: string): Promise<string[]> {
  const rows = await db()<{ name: string }[]>`
    select name from public.roles where tenant_id = ${tenantId} order by name`
  return rows.map((r) => r.name)
}
