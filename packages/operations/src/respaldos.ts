/**
 * Cuan protegido esta de verdad un cliente.
 *
 * ── La pregunta que responde ──────────────────────────────────────────
 *
 * No "cuantos respaldos tienes" -esa la contesta la lista y no sirve de
 * nada- sino "si manana pierdes la base, cuanto trabajo pierdes".
 *
 * Y esas son dos preguntas distintas, porque un respaldo que vive DENTRO
 * de la misma base que respalda se pierde junto con ella. Un cliente con
 * cuarenta respaldos en pantalla y ninguno descargado esta a cero, pero
 * se siente cubierto. Esa creencia es peor que no tener respaldos: le
 * quita las ganas de buscar una solucion de verdad.
 *
 * Por eso el estado se calcula sobre el ultimo respaldo que SALIO, no
 * sobre el ultimo que se hizo.
 *
 * Y solo cuentan los COMPLETOS. Hasta la migracion 0122 el respaldo
 * traia seis tablas maestras -empresas, sucursales, roles, equipo,
 * productos, configuracion- y ni una venta. Esos archivos siguen en la
 * lista; uno descargado ayer ponia el aviso en verde y le decia al
 * cliente "eso es lo que perderias", cuando perderia todas sus ventas.
 *
 * ── Los umbrales ──────────────────────────────────────────────────────
 *
 * Un dia esta bien. A los tres ya se pierde media semana de facturacion
 * de una pyme. A los siete la conversacion deja de ser tecnica.
 *
 * Son deliberadamente pocos y fijos: un umbral configurable acaba
 * puesto en el valor que hace desaparecer el aviso.
 */

export const DIAS_AVISO = 3
export const DIAS_ALARMA = 7

export type NivelRespaldo =
  | 'sin-respaldo'
  | 'solo-parciales'
  | 'nunca-salio'
  | 'viejo'
  | 'muy-viejo'
  | 'al-dia'

export interface EstadoRespaldo {
  nivel: NivelRespaldo
  /** Dias desde el ultimo respaldo que salio del sistema. Null si ninguno. */
  diasFuera: number | null
  /** Dias desde el ultimo respaldo, haya salido o no. Null si no hay ninguno. */
  diasUltimo: number | null
  titulo: string
  detalle: string
}

function diasEntre(desde: Date, hasta: Date): number {
  return Math.floor((hasta.getTime() - desde.getTime()) / 86_400_000)
}

export interface DatosRespaldo {
  /** Cuando se hizo el ultimo respaldo COMPLETO, haya salido o no. */
  ultimo: Date | null
  /** Cuando salio el ultimo respaldo COMPLETO que alguien se llevo fuera. */
  ultimoFuera: Date | null
  /** Hay respaldos del formato viejo (sin ventas). Solo cambia el aviso si no hay ningun completo. */
  parciales?: boolean
}

/** Un respaldo de la lista, como lo ve la pantalla. */
export interface RespaldoListado {
  creado: Date
  /** Cuando salio de aqui la primera vez. Null = sigue solo aqui. */
  salio: Date | null
  /** Formato 2 (0122): trae el negocio. False = el viejo, seis tablas maestras. */
  completo: boolean
}

/** Resume la lista para el aviso: los parciales no cuentan como proteccion. */
export function datosDeRespaldos(lista: readonly RespaldoListado[]): DatosRespaldo {
  const max = (fechas: Date[]): Date | null =>
    fechas.length === 0 ? null : new Date(Math.max(...fechas.map((f) => f.getTime())))
  const completos = lista.filter((r) => r.completo)
  return {
    ultimo: max(completos.map((r) => r.creado)),
    ultimoFuera: max(completos.flatMap((r) => (r.salio ? [r.salio] : []))),
    parciales: lista.some((r) => !r.completo),
  }
}

export function estadoDeRespaldos(d: DatosRespaldo, ahora: Date): EstadoRespaldo {
  const diasUltimo = d.ultimo === null ? null : diasEntre(d.ultimo, ahora)
  const diasFuera = d.ultimoFuera === null ? null : diasEntre(d.ultimoFuera, ahora)

  if (d.ultimo === null && d.parciales) {
    return {
      nivel: 'solo-parciales',
      diasFuera: null,
      diasUltimo: null,
      titulo: 'Tus respaldos no traen tus ventas',
      detalle:
        'Los de la lista son del formato anterior: solo traen empresas, sucursales, roles, equipo, productos y configuracion. Ni ventas, ni facturas, ni inventario, ni contabilidad. Crea uno nuevo y descargalo.',
    }
  }

  if (d.ultimo === null) {
    return {
      nivel: 'sin-respaldo',
      diasFuera: null,
      diasUltimo: null,
      titulo: 'Todavía no tienes una copia de tus datos',
      detalle:
        'Crea una y guárdala fuera del sistema (tu computadora, tu correo): si algo le pasa, con ella no pierdes tus ventas ni tu inventario. Toma unos segundos.',
    }
  }

  if (d.ultimoFuera === null) {
    return {
      nivel: 'nunca-salio',
      diasFuera: null,
      diasUltimo,
      titulo: 'Tu copia todavía no ha salido del sistema',
      detalle:
        'Una copia guardada en el mismo lugar que tus datos no te protege si a ese lugar le pasa algo. Descarga la última y guárdala en tu computadora o tu correo.',
    }
  }

  // A partir de aqui `diasFuera` es un numero: `ultimoFuera` no es nulo.
  const dias = diasFuera as number

  if (dias >= DIAS_ALARMA) {
    return {
      nivel: 'muy-viejo',
      diasFuera: dias,
      diasUltimo,
      titulo: `Tu ultimo respaldo fuera de aqui tiene ${dias} dias`,
      detalle:
        'Eso es lo que perderias hoy mismo: mas de una semana de ventas, compras y cobros. Descarga uno nuevo.',
    }
  }

  if (dias >= DIAS_AVISO) {
    return {
      nivel: 'viejo',
      diasFuera: dias,
      diasUltimo,
      titulo: `Hace ${dias} dias que no te llevas un respaldo`,
      detalle: 'Descarga el mas reciente y guardalo fuera. Toma menos de un minuto.',
    }
  }

  return {
    nivel: 'al-dia',
    diasFuera: dias,
    diasUltimo,
    titulo:
      dias === 0
        ? 'Tienes un respaldo de hoy guardado fuera'
        : `Tu ultimo respaldo fuera de aqui es de hace ${dias} ${dias === 1 ? 'dia' : 'dias'}`,
    detalle: 'Eso es lo que perderias si la base desaparece ahora mismo.',
  }
}
