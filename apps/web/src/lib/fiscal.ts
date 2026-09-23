import 'server-only'

import { exigir, type ActionResult, type ModulePageCtx } from './module-page'

/**
 * Por donde se llega a lo fiscal de las VENTAS.
 *
 * Los comprobantes (NCF) y los reportes 607/608 los emiten dos modulos: la
 * factura a credito (`ar`) y el ticket de caja (`pos`). Hasta la 0129 las
 * pantallas colgaban solo de `ar`, y un colmado que vende en mostrador
 * -sin credito- no podia cargar su autorizacion de la DGII ni bajar su
 * 607: todos sus tickets salian sin NCF salvo que comprara dos modulos de
 * credito que no usa.
 *
 * Tablas y no condicionales: ramificar con `if` sobre un id de modulo es lo
 * que `audit:registry` prohibe fuera de los modulos, y con razon. Aqui el
 * acoplamiento queda como DATO: que puerta abre que cosa, y con que permiso.
 * El orden importa: la primera que el rol alcance es la que se enlaza.
 */
export interface Puerta {
  modulo: string
  perm: string
  /** La pantalla de esa puerta, para enlazarla desde otras. */
  ruta: string
}

/** Cargar, corregir y dar de baja secuencias NCF. */
export const PUERTAS_NCF: readonly Puerta[] = [
  { modulo: 'ar', perm: 'ar.invoice.create', ruta: '/cobrar/ncf' },
  { modulo: 'pos', perm: 'pos.ncf.manage', ruta: '/pos/comprobantes' },
]

/** Ver y descargar el 607 y el 608. */
export const PUERTAS_VENTAS_DGII: readonly Puerta[] = [
  { modulo: 'ar', perm: 'ar.export', ruta: '/cobrar/dgii' },
  { modulo: 'pos', perm: 'pos.export', ruta: '/pos/dgii' },
]

/** La primera puerta que el rol alcanza, o null si ninguna. */
export function primeraPuerta(ctx: ModulePageCtx, puertas: readonly Puerta[]): Puerta | null {
  return puertas.find((p) => exigir(ctx, p.modulo, p.perm).ok) ?? null
}

/**
 * Permiso en servidor contra CUALQUIERA de las puertas. Si ninguna abre,
 * devuelve el motivo de la primera: es el que el usuario reconoce.
 */
export function exigirAlguna(ctx: ModulePageCtx, puertas: readonly Puerta[]): ActionResult {
  let primero: ActionResult | null = null
  for (const p of puertas) {
    const r = exigir(ctx, p.modulo, p.perm)
    if (r.ok) return r
    primero ??= r
  }
  return primero ?? { ok: false, error: 'Sin permiso.' }
}
