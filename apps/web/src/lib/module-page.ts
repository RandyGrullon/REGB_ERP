import 'server-only'

import { notFound, redirect } from 'next/navigation'
import { can, type Role } from '@regb/permissions'
import { TOURS } from '@regb/core'
import { checkAccess } from '@regb/sdk'
import { bootstrap, listRoles, listTenants, type BootstrapResult } from './bootstrap'
import { authConfigured, currentSession } from './supabase'
import { leerAviso } from './aviso'
import { asUser } from './db'
import type { ShellProps } from '@/components/Shell'
import type { SearchEntry } from '@/components/GlobalSearch'
import type { PasoGuia } from '@/components/GuiaFlotante'

/**
 * Contexto comun de las paginas y acciones de modulo.
 *
 * Toda pagina de modulo hace lo mismo: resolver quien mira (sesion real o
 * demo por URL), verificar el permiso EN SERVIDOR (que la UI oculte el
 * enlace no cuenta, §8.3) y trabajar bajo RLS via asUser. Esto centraliza
 * los dos primeros; el tercero es responsabilidad de cada query.
 */

export interface ModulePageCtx {
  userId: string
  tenantId: string
  tenantSlug: string
  tenantName: string
  role: Role
  roleName: string
  licensedModules: Set<string>
  /** Query string para propagar tenant/rol en modo demostracion. */
  demoQs: string
  /**
   * Estado de cuenta del cliente, leido de la base en cada peticion (no
   * del JWT, que puede tener una hora). En `readonly` o peor, `exigir()`
   * solo deja ver y exportar (0128).
   */
  tenantStatus?: string
}

/**
 * `| undefined` explicito: con exactOptionalPropertyTypes, "puede faltar"
 * y "puede valer undefined" son cosas distintas, y quien llama pasa lo
 * segundo (formData.get devuelve string | undefined).
 */
export type DemoParams = {
  tenant?: string | undefined
  rol?: string | undefined
  plataforma?: string | undefined
  /** Tour en curso, para que la guia siga dentro de la pantalla. */
  tour?: string | undefined
  /** Paso del tour, en base 1 -lo que ve el usuario-. */
  paso?: string | undefined
}

export type ActionResult = { ok: true } | { ok: false; error: string }

interface Resolved {
  data: BootstrapResult
  ctx: ModulePageCtx
  demo: boolean
}

async function resolve(params: DemoParams): Promise<Resolved | null> {
  if (authConfigured) {
    const session = await currentSession()
    if (!session?.tenantId) return null
    if (checkAccess(session).blocked) return null
    const data = await bootstrap({ session })
    if (!data) return null
    return {
      data,
      demo: false,
      ctx: {
        userId: data.user.id,
        tenantId: data.tenant.id,
        tenantSlug: data.tenant.id,
        tenantName: data.tenant.name,
        role: data.role,
        roleName: data.role.name,
        licensedModules: data.hydration.licensedModules,
        demoQs: '',
        tenantStatus: data.tenant.status,
      },
    }
  }

  const tenants = await listTenants()
  if (tenants.length === 0) return null
  const slug = params.tenant ?? tenants[0]!.slug
  const roleName = params.rol ?? 'Owner'
  const data = await bootstrap({ demo: { tenantSlug: slug, roleName } })
  if (!data) return null
  return {
    data,
    demo: true,
    ctx: {
      userId: data.user.id,
      tenantId: data.tenant.id,
      tenantSlug: slug,
      tenantName: data.tenant.name,
      role: data.role,
      roleName,
      licensedModules: data.hydration.licensedModules,
      demoQs: `?tenant=${slug}&rol=${encodeURIComponent(roleName)}`,
      tenantStatus: data.tenant.status,
    },
  }
}

/**
 * A donde mandar a alguien que no puede abrir `moduleId`.
 *
 * Devuelve la primera ruta que su rol SI puede abrir, respetando el orden
 * del sidebar —que es el orden por uso, no alfabetico— o `null` si el
 * modulo pedido esta a su alcance y no hay que redirigir a ningun lado.
 *
 * Existe por el cajero: no tiene `dashboard.view` ni lo necesita, y sin
 * esto su primera pantalla al entrar era un 404.
 */
export async function primeraRutaVisible(
  params: DemoParams,
  moduleId: string,
  perm?: string,
): Promise<string | null> {
  const r = await resolve(params)
  if (!r) return null
  if (permisoDelRol(r.ctx, moduleId, perm ?? `${moduleId}.view`).ok) return null

  for (const entrada of r.data.hydration.sidebar) {
    const ruta = entrada.routes.find((x) => !x.hidden && !x.path.includes(':'))
    if (ruta) return ruta.path
  }
  return null
}

/**
 * El paso del tour que toca pintar sobre ESTA pantalla, si lo hay.
 *
 * Vive aqui -en el embudo por donde pasan las 152 pantallas de modulo-
 * y no en cada pagina, por la misma razon que el aviso de la ultima
 * accion: repetirlo 152 veces es garantizar que en alguna se olvide.
 *
 * Se valida contra TOURS, no contra lo que venga en la URL. Un `tour`
 * inventado o un `paso` fuera de rango devuelven undefined y la pantalla
 * sale normal: el peor caso de manipular la URL es no ver la guia.
 *
 * Se exporta porque hay pantallas que NO pasan por `modulePage` -las que
 * ocupan el ancho entero y no pintan el Shell, como /roles y
 * /marketplace-, y a esas tambien llega un tour. Sin esto, el tour
 * moria justo ahi: la prueba de `tours.test.ts` lo comprueba archivo a
 * archivo para que no vuelva a pasar en silencio.
 */
export function guiaDelPaso(params: DemoParams, qs: string): PasoGuia | undefined {
  if (params.tour === undefined || params.paso === undefined) return undefined

  const tour = TOURS.find((t) => t.id === params.tour)
  if (tour === undefined) return undefined

  const n = Number(params.paso)
  if (!Number.isInteger(n) || n < 1 || n > tour.steps.length) return undefined

  const paso = tour.steps[n - 1]!
  const sep = qs === '' ? '?' : `${qs}&`

  // "Siguiente" solo lleva a algun sitio si el paso que viene tiene su
  // propia pantalla. Si no la tiene, se vuelve al tutorial a leerlo:
  // inventarle una ruta seria mandar al usuario a una pantalla que ese
  // paso no menciona.
  const queViene = tour.steps[n]
  const siguiente =
    queViene?.action !== undefined
      ? `${queViene.action.path}${sep}tour=${encodeURIComponent(tour.id)}&paso=${n + 1}`
      : null

  return {
    tourId: tour.id,
    titulo: paso.title,
    cuerpo: paso.body,
    tip: paso.tip,
    target: paso.target,
    paso: n,
    total: tour.steps.length,
    siguiente,
    tutorial: `/tutorial${qs}`,
  }
}

/**
 * Pagina de modulo completa: contexto + props del Shell.
 * Sin sesion redirige; sin permiso de ver, la ruta "no existe" (404).
 */
export async function modulePage(
  params: DemoParams,
  moduleId: string,
  /**
   * Permiso que exige ESTA ruta. Por defecto `<modulo>.view`, que es lo que
   * declara la mayoria de las rutas en su manifest.
   *
   * Hay que pasarlo cuando la ruta pide otro: `/pos` declara `pos.sell` en
   * el manifest, y el rol Cajero tiene `pos.sell` pero no `pos.view`. Con
   * el valor por defecto, el cajero recibia 404 en su propia caja.
   */
  perm?: string,
): Promise<{ ctx: ModulePageCtx; shell: Omit<ShellProps, 'children' | 'activePath'> }> {
  const r = await resolve(params)
  if (!r) redirect(authConfigured ? '/login' : '/')

  // Abrir la pantalla mira solo el rol: en solo lectura la caja se ve; lo
  // que no se puede es cobrar, y eso lo niega `exigir()` en la accion.
  if (!permisoDelRol(r.ctx, moduleId, perm ?? `${moduleId}.view`).ok) notFound()

  const platform = (params.plataforma ?? 'web') as 'web' | 'desktop' | 'mobile'
  const tenants = r.demo
    ? await listTenants()
    : [
        {
          id: r.data.tenant.id,
          slug: r.data.tenant.id,
          name: r.data.tenant.name,
          initials: r.data.user.initials,
          tier: r.data.tenant.tier,
        },
      ]
  const roles = r.demo ? await listRoles(r.ctx.tenantId) : [r.ctx.roleName]
  const [unread, search] = await Promise.all([unreadCount(r.ctx), buildSearchIndex(r)])
  const session = r.demo ? null : await currentSession()
  // El resultado de la ultima accion. Se lee aqui -por donde pasan TODAS
  // las pantallas de modulo- para no repetirlo en 141 archivos.
  const aviso = await leerAviso()

  return {
    ctx: r.ctx,
    shell: {
      tenants,
      activeSlug: r.ctx.tenantSlug,
      roles,
      activeRole: r.ctx.roleName,
      activePlatform: platform,
      demoMode: r.demo,
      isProvider: session?.isProvider ?? false,
      // Los enlaces del pie del menu, solo a quien le sirven: un cajero no
      // pide modulos -le cuestan al dueño- ni administra permisos.
      puedeMarketplace:
        permisoDelRol(r.ctx, 'marketplace', 'subscription.manage').ok ||
        permisoDelRol(r.ctx, 'marketplace', 'marketplace.view').ok,
      puedeRoles: permisoDelRol(r.ctx, 'rbac', 'rbac.role.view').ok,
      aviso,
      guia: guiaDelPaso(params, r.ctx.demoQs),
      data: {
        tenant: r.data.tenant,
        user: r.data.user,
        roleName: r.ctx.roleName,
        sidebar: r.data.hydration.sidebar,
        activeModules: [...r.data.hydration.activeModules],
        widgets: r.data.hydration.widgets,
        unavailable: r.data.hydration.unavailable,
        routeCount: r.data.hydration.routePermissions.size,
        unread,
        search,
      },
    },
  }
}

/**
 * El numero de la campana: lo que ESTE usuario no ha leido. Un aviso de
 * equipo se lee por persona (0125); la cuenta la hace la misma funcion
 * que usa /notificaciones, para que los dos numeros no discrepen.
 */
async function unreadCount(ctx: ModulePageCtx): Promise<number> {
  if (!ctx.licensedModules.has('notifications')) return 0
  const [row] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<{ c: number }[]>`select public.avisos_sin_leer() as c`,
  )
  return Number(row?.c ?? 0)
}

/**
 * Indice de Ctrl+K (puerta F2): modulos, registros, acciones y ayuda.
 * Se construye del sidebar YA RESUELTO por rol — la busqueda no puede
 * encontrar lo que el rol no ve.
 */
async function buildSearchIndex(r: Resolved): Promise<SearchEntry[]> {
  const entries: SearchEntry[] = []

  for (const mod of r.data.hydration.sidebar) {
    for (const route of mod.routes) {
      entries.push({
        type: 'modulo',
        label: route.label,
        detail: mod.label,
        path: route.path,
        keywords: mod.moduleId,
      })
    }
  }

  const ACCIONES: (SearchEntry & { need: string })[] = [
    { type: 'accion', label: 'Invitar a alguien al equipo', path: '/usuarios', need: 'users' },
    { type: 'accion', label: 'Crear un rol o cambiar permisos', path: '/roles', need: 'rbac' },
    { type: 'accion', label: 'Agregar una empresa (RNC)', path: '/empresas', need: 'orgs' },
    { type: 'accion', label: 'Abrir una sucursal', path: '/sucursales', need: 'branches' },
    { type: 'accion', label: 'Activar un modulo nuevo', path: '/marketplace', need: 'marketplace' },
    { type: 'accion', label: 'Importar productos desde CSV', path: '/importar', need: 'imports' },
    { type: 'accion', label: 'Crear un respaldo de mis datos', path: '/respaldos', need: 'backup' },
  ]
  for (const a of ACCIONES) {
    if (r.ctx.licensedModules.has(a.need)) {
      entries.push({ type: a.type, label: a.label, path: a.path })
    }
  }

  const AYUDA: SearchEntry[] = [
    { type: 'ayuda', label: 'Primeros pasos en REGB', path: '/tutorial', keywords: 'tour ayuda' },
    {
      type: 'ayuda',
      label: 'Como ocultar modulos a un rol',
      path: '/tutorial',
      keywords: 'permisos',
    },
    {
      type: 'ayuda',
      label: 'Como funciona el marketplace',
      path: '/tutorial',
      keywords: 'precios',
    },
  ]
  if (r.ctx.licensedModules.has('tour')) entries.push(...AYUDA)

  // Registros: nombres reales del tenant, bajo RLS.
  const rows = await asUser(r.ctx.userId, r.ctx.tenantId, async (tx) => {
    const productos = r.ctx.licensedModules.has('products')
      ? // 200 y no 50: un colmado tiene cientos de productos y con 50 la
        // busqueda no encontraba casi nada pasada la "C".
        await tx<{ id: string; name: string; sku: string }[]>`
          select id::text, name, sku from public.products
          where tenant_id = ${r.ctx.tenantId} and active
          order by name limit 200`
      : []
    const gente = r.ctx.licensedModules.has('users')
      ? await tx<{ display_name: string }[]>`
          select display_name from public.user_profiles
          where tenant_id = ${r.ctx.tenantId} order by display_name limit 50`
      : []
    return { productos, gente }
  })
  for (const p of rows.productos) {
    entries.push({
      type: 'registro',
      label: p.name,
      detail: `Producto · ${p.sku}`,
      // A la ficha del producto, no a la lista: encontrarlo y tener que
      // buscarlo otra vez en la tabla era buscar dos veces.
      path: `/products/${p.id}`,
    })
  }
  for (const g of rows.gente) {
    entries.push({ type: 'registro', label: g.display_name, detail: 'Usuario', path: '/usuarios' })
  }

  return entries
}

/**
 * Estados de cuenta en los que no se escribe. `suspended` y `archived` ni
 * siquiera entran con sesion real (`checkAccess`); se listan para que el
 * modo demostracion -que no pasa por ahi- tampoco escriba.
 */
const SIN_ESCRITURA = new Set(['readonly', 'suspended', 'archived'])

/**
 * Acciones que solo leen: las que terminan en `view` o `export`, o tienen
 * `view` en medio (`payroll.view.own`, `inventory.cost.view`). Todo lo
 * demas escribe algo.
 */
const esLectura = (accion: string): boolean => /(^|\.)(view|export)(\.|$)/.test(accion)

export const MENSAJE_SOLO_LECTURA =
  'Tu cuenta esta en solo lectura por un pago pendiente con REGB. Puedes consultar y exportar todo; para volver a registrar, ponte al dia y se reactiva sola al pagar.'

/** Para server actions: devuelve null en vez de redirigir. */
export async function actionCtx(demo?: DemoParams): Promise<ModulePageCtx | null> {
  const r = await resolve(demo ?? {})
  return r?.ctx ?? null
}

/** Permiso en servidor, con el motivo exacto si se niega. */
/**
 * `amount` es opcional: solo lo usan las acciones cuyo rol puede traer un
 * `max_amount` en su alcance (por ejemplo, un ajuste de inventario que
 * necesita aprobacion del gerente por encima de cierto monto).
 */
export function exigir(
  ctx: ModulePageCtx,
  moduleId: string,
  accion: string,
  amount?: number,
): ActionResult {
  // Mora en solo lectura (§6.6, dia 15): se ve y se exporta, no se escribe.
  // Antes `readonly` era solo el banner rojo y el cliente seguia operando.
  if (ctx.tenantStatus !== undefined && SIN_ESCRITURA.has(ctx.tenantStatus) && !esLectura(accion)) {
    return { ok: false, error: MENSAJE_SOLO_LECTURA }
  }
  return permisoDelRol(ctx, moduleId, accion, amount)
}

/**
 * Quien entra al marketplace y quien pide. Pedir le sube la factura al
 * dueño: es `subscription.manage` (el Owner; el Admin de fabrica lo tiene
 * negado, 0006), el mismo permiso que exige `solicitarActivacion`. Ver el
 * catalogo es eso o `marketplace.view`. Un cajero no entra: antes veia la
 * mensualidad del dueño y el boton de pedir con solo escribir la ruta.
 */
export function accesoMarketplace(userId: string, role: Role): { ver: boolean; pedir: boolean } {
  const ctx = { userId, role, activeModules: new Set(['marketplace']) }
  const pedir = can('subscription.manage', { module: 'marketplace' }, ctx).allowed
  const ver = pedir || can('marketplace.view', { module: 'marketplace' }, ctx).allowed
  return { ver, pedir }
}

/** Solo el rol y los modulos, sin mirar el estado de cuenta. */
function permisoDelRol(
  ctx: ModulePageCtx,
  moduleId: string,
  accion: string,
  amount?: number,
): ActionResult {
  const d = can(
    accion,
    { module: moduleId, ...(amount !== undefined ? { amount } : {}) },
    { userId: ctx.userId, role: ctx.role, activeModules: ctx.licensedModules },
  )
  return d.allowed ? { ok: true } : { ok: false, error: d.detail }
}
