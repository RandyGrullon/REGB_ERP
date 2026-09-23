/**
 * Por que /pos no ofrece "Abrir turno", con la causa verdadera.
 *
 * Antes habia un solo mensaje para todo: "Tu rol no puede abrir la caja.
 * Pidele a un encargado". Sin almacen se lo decia tambien al Owner, que
 * tiene todos los permisos y no tenia a quien pedirselo. Un turno siempre
 * descuenta de un almacen; si no hay ninguno -o el modulo donde viven los
 * almacenes esta apagado-, eso es lo que hay que decir, con el remedio.
 */

export interface SinTurnoEntrada {
  puedeAbrir: boolean
  hayAlmacenes: boolean
  /** El modulo de existencias esta activo: sin el, la RLS esconde los almacenes. */
  tieneExistencias: boolean
  puedeCrearAlmacen: boolean
  /** Query de la demo (?tenant=&rol=), o vacia. */
  qs: string
}

export interface SinTurno {
  icono: string
  titulo: string
  descripcion: string
  enlace: { href: string; texto: string } | null
}

export function motivoSinTurno(e: SinTurnoEntrada): SinTurno | null {
  if (!e.puedeAbrir) {
    return {
      icono: 'lock',
      titulo: 'No hay turno abierto',
      descripcion: 'Tu rol no puede abrir la caja. Pidele a un encargado que abra el turno.',
      enlace: null,
    }
  }
  if (e.hayAlmacenes) return null

  if (!e.tieneExistencias) {
    return {
      icono: 'warehouse',
      titulo: 'La caja necesita un almacen',
      descripcion:
        'Cada turno descuenta la mercancia de un almacen, y los almacenes viven en el modulo Existencias, que este negocio no tiene activo. Activalo y vuelve para abrir la caja.',
      enlace: { href: `/marketplace${e.qs}`, texto: 'Ver Existencias en el Marketplace' },
    }
  }

  return {
    icono: 'warehouse',
    titulo: 'Falta crear un almacen',
    descripcion: e.puedeCrearAlmacen
      ? 'La caja descuenta la mercancia de un almacen y todavia no hay ninguno. Crealo y vuelve para abrir el turno.'
      : 'La caja descuenta la mercancia de un almacen y todavia no hay ninguno. Pidele a quien administra el inventario que cree uno en Existencias > Almacenes.',
    enlace: e.puedeCrearAlmacen
      ? { href: `/inventory/warehouses${e.qs}`, texto: 'Crear un almacen' }
      : null,
  }
}
