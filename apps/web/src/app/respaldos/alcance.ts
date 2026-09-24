import 'server-only'

import { nombreDeModulo } from '@/lib/nombre-modulo'
import { exigir, type ModulePageCtx } from '@/lib/module-page'

/**
 * Que puede llevarse ESTE rol en un respaldo.
 *
 * ── Por que hace falta, si ya hay RLS ─────────────────────────────────
 *
 * La RLS del camino web separa CLIENTES, no ROLES: `asUser()` no pone
 * `role_id` en los claims, asi que `rls.has_perm()` devuelve true y cada
 * tabla solo pide tenant y modulo activo. Mientras el respaldo traia seis
 * tablas maestras daba igual. Ahora trae el negocio entero, y sin esta
 * guarda cualquiera con `backup.create` se llevaba la nomina, los costos
 * y los asientos aunque su rol no pudiera abrir ninguna de esas pantallas.
 *
 * Asi que el respaldo entra por modulo, y solo los modulos que el rol ve
 * COMPLETOS:
 *
 *  - tiene `<modulo>.view` (el permiso de abrir el modulo, que todos los
 *    manifiestos declaran), y
 *  - no tiene negada ninguna vista dentro de el (`inventory.cost.view:
 *    false` = no ve los costos; el respaldo los traeria).
 *
 * Y un rol con ALCANCE acotado -solo lo suyo, solo unas sucursales, solo
 * unas empresas- no saca respaldos: el alcance lo aplica cada pantalla,
 * no la base, y un respaldo es la empresa entera.
 *
 * Lo mismo vale para BAJARLO: quien no ve un modulo que el archivo trae no
 * se lo lleva, aunque otro lo haya creado.
 */

export interface AlcanceRespaldo {
  /** Por que este rol no puede sacar ni bajar un respaldo completo. Null si puede. */
  bloqueo: string | null
  /** Modulos que el rol ve completos: los unicos cuyas tablas entran. */
  modulos: string[]
  /** Modulos activos que se quedan fuera por el rol, con el motivo en palabras. */
  fuera: { modulo: string; nombre: string; motivo: string }[]
}

export { nombreDeModulo }

/** `inventory.cost.view` o `*.cost.view` niegan una VISTA dentro de `inventory`. */
function esVistaDe(permiso: string, modulo: string): boolean {
  const [dueno, ...resto] = permiso.split('.')
  return (dueno === modulo || dueno === '*') && resto.includes('view')
}

export function alcanceDelRespaldo(ctx: ModulePageCtx): AlcanceRespaldo {
  const scope = ctx.role.scope
  const acotado =
    scope.own_only === true ||
    (scope.branches?.length ?? 0) > 0 ||
    (scope.companies?.length ?? 0) > 0

  const modulos: string[] = []
  const fuera: AlcanceRespaldo['fuera'] = []
  for (const m of [...ctx.licensedModules].sort()) {
    const nombre = nombreDeModulo(m)
    if (!exigir(ctx, m, `${m}.view`).ok) {
      fuera.push({ modulo: m, nombre, motivo: 'tu rol no abre este modulo' })
      continue
    }
    const negada = Object.entries(ctx.role.permissions).find(
      ([permiso, vale]) => vale === false && esVistaDe(permiso, m),
    )
    if (negada) {
      fuera.push({ modulo: m, nombre, motivo: `tu rol tiene negada una parte (${negada[0]})` })
      continue
    }
    modulos.push(m)
  }

  return {
    bloqueo: acotado
      ? 'Tu rol solo ve una parte de los datos (lo suyo, o algunas sucursales o empresas). Un respaldo es la empresa entera: lo tiene que sacar alguien que la vea completa.'
      : null,
    modulos,
    fuera,
  }
}
