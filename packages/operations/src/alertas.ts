/**
 * De la foto de salud a la lista de lo que hay que atender HOY.
 *
 * ── Por que existe, aparte del panel ──────────────────────────────────
 *
 * `/control/salud` ya mide todo esto y lo pinta bien. Pero es PULL:
 * alguien tiene que acordarse de abrirlo cada mañana. Y el dia que de
 * verdad importa —un cliente sin NCF a las 8 a.m., un respaldo que lleva
 * tres semanas sin correr— es justo el dia en que nadie lo abrio.
 *
 * Esto convierte la misma foto en una decision: ¿hay que avisar, y con
 * que urgencia? Vive en `@regb/operations` y no en la pantalla porque lo
 * usa tambien `pnpm alertas`, que corre sin navegador. La consulta es
 * una sola —`cargarSalud()`—; lo que aqui se decide es que significa.
 *
 * ── El criterio de severidad ──────────────────────────────────────────
 *
 * No es "que tan raro es el numero", es **que le pasa al cliente**:
 *
 *   critico = el cliente NO PUEDE TRABAJAR ahora mismo, o hay riesgo de
 *             perder datos que no se recuperan. Se atiende hoy.
 *   aviso   = algo va a doler pronto si nadie lo toca. Esta semana.
 *
 * Un respaldo viejo es critico aunque hoy no moleste a nadie: el dia que
 * hace falta, duele entero y ya no hay nada que hacer. Esa asimetria
 * —cuesta poco arreglarlo, cuesta todo no haberlo hecho— es la razon de
 * que no sea un simple aviso.
 */

export type Severidad = 'critico' | 'aviso'

export interface Alerta {
  /** Estable, para poder silenciar o agrupar sin depender del texto. */
  clave: string
  severidad: Severidad
  /** Una frase, en el idioma del negocio. Es lo que se lee de reojo. */
  titulo: string
  /** Que hacer. Una alerta sin salida es ruido. */
  accion: string
  /** A quien afecta, cuando aplica a un cliente concreto. */
  cliente?: string
}

/** La parte de `Salud` que esto mira. Se declara aparte para no atar
 *  @regb/operations al tipo de la app web. */
export interface FotoSalud {
  eventos: { pendientes: number; fallidos: number; muertos: number }
  ncfEnRiesgo: {
    slug: string
    tipo: string
    restantes: number
    motivo: 'agotada' | 'vencida' | 'por agotarse'
  }[]
  impersonacionesAbiertas: { tenant: string; desde: string }[]
}

/** Dias que el respaldo de desastre puede tener antes de avisar. */
export const DIAS_RESPALDO = 7

/**
 * Horas que una impersonacion puede quedar abierta antes de avisar.
 *
 * La sesion caduca sola a los 60 minutos (F3), asi que una que lleva mas
 * de dos horas "abierta" no es alguien trabajando: es un registro que no
 * se cerro. Se avisa porque el rastro de quien entro a los datos de un
 * cliente es justo lo que no puede quedar a medias.
 */
export const HORAS_IMPERSONACION = 2

const horas = (desde: string, ahora: Date): number =>
  Math.floor((ahora.getTime() - new Date(desde).getTime()) / 3_600_000)

/**
 * Las alertas de esta foto, de lo mas urgente a lo menos.
 *
 * `ahora` se recibe y no se toma de adentro: una funcion que lee el reloj
 * no se puede probar dos veces con el mismo resultado.
 */
export function evaluarAlertas(salud: FotoSalud, ahora: Date): Alerta[] {
  const out: Alerta[] = []

  // ── Lo que impide facturar HOY ────────────────────────────────────
  //
  // Va primero porque es lo unico de esta lista que para el negocio del
  // cliente en seco: sin comprobante autorizado no se emite una factura,
  // y el mostrador se queda sin poder cobrar.
  for (const n of salud.ncfEnRiesgo) {
    const parado = n.motivo === 'agotada' || n.motivo === 'vencida'
    out.push({
      clave: `ncf:${n.slug}:${n.tipo}`,
      severidad: parado ? 'critico' : 'aviso',
      titulo: parado
        ? `${n.slug} no puede facturar: la secuencia ${n.tipo} esta ${n.motivo}`
        : `A ${n.slug} le quedan ${n.restantes} comprobantes ${n.tipo}`,
      accion: 'Pedir un rango nuevo a la DGII y cargarlo en Configuracion › Fiscal.',
      cliente: n.slug,
    })
  }

  // OJO: `salud.respaldos` NO se mira aqui, y no es un olvido.
  //
  // Esa lista cuenta filas de `public.backups`, que son las EXPORTACIONES
  // que cada cliente se hace desde la app. Que un cliente no se haya
  // exportado nunca no es una emergencia: casi ninguno lo hara.
  //
  // El respaldo que importa —el de desastre, `pnpm db:respaldar`— es un
  // archivo en `respaldos/`, no una fila. Se mira con
  // `evaluarRespaldoLocal()`, que corre donde ese archivo existe.
  //
  // Se separo despues de verlo fallar: con la regla antigua la primera
  // corrida real dio "4 criticas, ningun cliente tiene respaldo" con los
  // respaldos hechos y en disco. Una alerta que esta roja todos los dias
  // se deja de leer en una semana, y con ella se van las de verdad.

  // ── El bus de eventos ─────────────────────────────────────────────
  //
  // Un evento descartado es una consecuencia que NO ocurrio: un correo
  // que no salio, un asiento que no se creo. Nadie lo nota hasta que
  // alguien pregunta por algo que deberia haber pasado.
  if (salud.eventos.muertos > 0) {
    out.push({
      clave: 'eventos:muertos',
      severidad: 'critico',
      titulo: `${salud.eventos.muertos} evento(s) descartados tras agotar reintentos`,
      accion: 'Mirar /control/salud: cada uno es algo que el sistema prometio y no hizo.',
    })
  }
  // Pendientes hay siempre -es una cola-. Lo que preocupa es que se
  // acumulen: eso significa que el despachador no esta corriendo.
  if (salud.eventos.pendientes > 100) {
    out.push({
      clave: 'eventos:atascados',
      severidad: 'aviso',
      titulo: `${salud.eventos.pendientes} eventos esperando en la cola`,
      accion: 'Comprobar que el cron llame a /api/eventos/despachar.',
    })
  }

  // ── Impersonaciones que quedaron abiertas ─────────────────────────
  for (const i of salud.impersonacionesAbiertas) {
    const h = horas(i.desde, ahora)
    if (h >= HORAS_IMPERSONACION) {
      out.push({
        clave: `impersonacion:${i.tenant}`,
        severidad: 'aviso',
        titulo: `Impersonacion de ${i.tenant} abierta hace ${h} h`,
        accion: 'La sesion caduca a los 60 min; este registro quedo sin cerrar. Cerrarlo.',
        cliente: i.tenant,
      })
    }
  }

  const peso = (s: Severidad) => (s === 'critico' ? 0 : 1)
  return out.sort((a, b) => peso(a.severidad) - peso(b.severidad))
}

/**
 * El respaldo de desastre: el unico que importa el dia malo.
 *
 * Va aparte de `evaluarAlertas()` porque no sale de la base: es un
 * archivo en `respaldos/`, y quien lo sabe es la maquina donde corre el
 * ERP. Mezclarlo con lo demas fue el error de la primera version —conto
 * filas de `public.backups`, que son las exportaciones del cliente, y
 * dio cuatro criticas con los respaldos hechos y en disco—.
 *
 * `ultimo` es la fecha del respaldo mas reciente, o null si no hay
 * ninguno. Se recibe ya resuelta para que esto se pueda probar sin tocar
 * el sistema de archivos.
 *
 * Es critico y no aviso aunque hoy no moleste a nadie: cuesta poco
 * arreglarlo y cuesta todo no haberlo hecho. Esa asimetria es la razon.
 */
export function evaluarRespaldoLocal(ultimo: Date | null, ahora: Date): Alerta | null {
  if (ultimo === null) {
    return {
      clave: 'respaldo:local',
      severidad: 'critico',
      titulo: 'No hay NI UN respaldo de la base',
      accion: 'Correr `pnpm db:respaldar` y despues `pnpm db:verificar-respaldo`.',
    }
  }
  const d = Math.floor((ahora.getTime() - ultimo.getTime()) / 86_400_000)
  if (d <= DIAS_RESPALDO) return null
  return {
    clave: 'respaldo:local',
    severidad: 'critico',
    titulo: `El ultimo respaldo de la base tiene ${d} dias`,
    // Que FALLE el respaldo es mas probable que que nadie lo corra: el
    // contenedor apagado, el disco lleno. Por eso la accion no es "hazlo"
    // sino "hazlo y mira por que no se hacia".
    accion: 'Correr `pnpm db:respaldar`. Si falla, eso es lo que hay que arreglar hoy.',
  }
}

/**
 * Lo que se lee en una linea: "2 criticas, 1 aviso".
 *
 * Devuelve null cuando no hay nada. Un "todo bien" diario se vuelve
 * invisible a la semana, y entonces tampoco se ve el dia que cambia.
 */
export function resumenAlertas(alertas: Alerta[]): string | null {
  const c = alertas.filter((a) => a.severidad === 'critico').length
  const v = alertas.length - c
  if (c === 0 && v === 0) return null
  const partes: string[] = []
  if (c > 0) partes.push(c === 1 ? '1 critica' : `${c} criticas`)
  if (v > 0) partes.push(v === 1 ? '1 aviso' : `${v} avisos`)
  return partes.join(' y ')
}
