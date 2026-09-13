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

export type NivelRespaldo = 'sin-respaldo' | 'nunca-salio' | 'viejo' | 'muy-viejo' | 'al-dia'

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
  /** Cuando se hizo el ultimo respaldo, haya salido o no. */
  ultimo: Date | null
  /** Cuando salio el ultimo que alguien se llevo fuera. */
  ultimoFuera: Date | null
}

export function estadoDeRespaldos(d: DatosRespaldo, ahora: Date): EstadoRespaldo {
  const diasUltimo = d.ultimo === null ? null : diasEntre(d.ultimo, ahora)
  const diasFuera = d.ultimoFuera === null ? null : diasEntre(d.ultimoFuera, ahora)

  if (d.ultimo === null) {
    return {
      nivel: 'sin-respaldo',
      diasFuera: null,
      diasUltimo: null,
      titulo: 'No tienes ningun respaldo',
      detalle:
        'Si pierdes la base hoy, pierdes todo. Crea uno ahora: toma unos segundos y se descarga.',
    }
  }

  if (d.ultimoFuera === null) {
    return {
      nivel: 'nunca-salio',
      diasFuera: null,
      diasUltimo,
      titulo: 'Tus respaldos no han salido de aqui',
      detalle:
        'Viven en la misma base que respaldan: un incendio, un robo o un ransomware se lleva las dos cosas. Descarga el ultimo y guardalo en otro sitio.',
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
