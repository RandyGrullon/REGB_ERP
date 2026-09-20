import { roundBankers } from '@regb/core'

/**
 * Impuestos — §5, modulo 24 (advanced).
 *
 * Aqui vive lo que cambia por decreto y no por codigo: las tasas de ITBIS,
 * la base sobre la que se retiene y los dias de vencimiento. Es el mismo
 * argumento que gano `dgii.ts` con la validacion de RNC y NCF -aislar la
 * norma en un archivo con pruebas, para que un cambio de ley se atienda en
 * un sitio y no en cinco pantallas-.
 *
 * Todo el redondeo usa `roundBankers` de @regb/core, el mismo de
 * splitAmount() y del resto del dinero del repo. `round()` de Postgres
 * redondea half-up: una retencion cuyo residuo cae en .005 saldria un
 * centavo distinta en la base y en la pantalla, y ese centavo es justo el
 * que no cuadra contra el 606.
 *
 * Lo que NO esta aqui: sumar el ITBIS del periodo. Eso es un `sum()` sobre
 * dgii_606 y dgii_607, y vive donde estan las filas, bajo la RLS que ya las
 * protege. Traerse las facturas del mes a JavaScript para sumarlas seria
 * peor en todo.
 */

// ── Tasas ──────────────────────────────────────────────────────────────

export interface TasaSembrada {
  code: string
  name: string
  /** En FRACCION (0.18), no en puntos (18). */
  rate: number
  isDefault: boolean
}

/**
 * Punto de partida para sembrar `public.tax_rates`, no verdad inmutable:
 * el cliente las edita en la tabla y ese es el objetivo del modulo entero
 * -hoy el 0.18 esta cableado como default en cinco tablas distintas-.
 *
 * La tasa va en FRACCION porque asi la dejo fijada la 0021 en
 * products.tax_rate y sales_order_lines.tax_rate. Tener dos convenciones
 * de tasa en el mismo esquema es exactamente como se cobra 1800% de ITBIS.
 */
export const TASAS_ITBIS_RD: TasaSembrada[] = [
  { code: 'ITBIS-18', name: 'ITBIS general 18%', rate: 0.18, isDefault: true },
  { code: 'ITBIS-16', name: 'ITBIS reducido 16%', rate: 0.16, isDefault: false },
  { code: 'EXENTO', name: 'Exento 0%', rate: 0, isDefault: false },
]

/**
 * Lee un PORCENTAJE tecleado por una persona y lo deja en fraccion.
 *
 * Siempre entre 100, sin adivinar. La version anterior hacia
 * `n > 1 ? n / 100 : n` para aceptar "18" y "0.18" como lo mismo, y esa
 * comodidad tiene un precio en el rango 0-1, que es justo donde la
 * heuristica no puede acertar: quien escribia "1" queriendo 1% guardaba
 * 100%, y quien escribia "0.5" queriendo medio por ciento guardaba 50%.
 * La validacion posterior solo rechazaba > 1, asi que los dos pasaban
 * limpios y se descubrian cuando el proveedor reclamaba su pago.
 *
 * Una tasa cien veces mas alta se nota en la primera factura; una regla
 * de retencion cien veces mas alta se nota tarde. Por eso el campo dice
 * "%" y aqui no hay caso especial: quien escriba 0.18 va a leer "0.18%"
 * en la fila y lo corrige.
 *
 * Devuelve null si no es un numero, si es negativo o si pasa de 100.
 */
export function porcentajeAFraccion(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '').replace(/%\s*$/, '').trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  // 4 decimales es lo que aguanta numeric(5,4): 18 -> 0.18, 2.5 -> 0.025.
  return roundBankers(n / 100, 4)
}

// ── Calendario ─────────────────────────────────────────────────────────

export type Formulario = 'IT-1' | '606' | '607' | '608' | 'IR-17'

/**
 * Dia limite de cada formulario, en el mes SIGUIENTE al periodo declarado.
 *
 * Sin verificar contra una norma publicada este año: es el riesgo
 * declarado del modulo y por eso la pantalla dice de donde salio el numero
 * en vez de presentarlo como dato del sistema.
 */
export const VENCIMIENTOS_RD: Record<Formulario, number> = {
  'IR-17': 10,
  '606': 15,
  '607': 15,
  '608': 15,
  'IT-1': 20,
}

/**
 * Corre sabado y domingo al lunes.
 *
 * Los feriados dominicanos que se trasladan por ley quedan fuera a
 * proposito: un calendario de feriados hay que mantenerlo cada año, y un
 * feriado mal cargado produce un vencimiento inventado. Un vencimiento un
 * dia antes de tiempo no le cuesta nada a nadie; uno un dia tarde, si.
 */
export function proximoDiaHabil(fecha: Date): Date {
  const d = new Date(fecha.getTime())
  const dia = d.getDay()
  if (dia === 6) d.setDate(d.getDate() + 2)
  else if (dia === 0) d.setDate(d.getDate() + 1)
  return d
}

export interface ObligacionFiscal {
  form: Formulario
  /** Periodo declarado, `YYYYMM`. */
  periodo: string
  /** Fecha limite ya corrida al lunes si caia fin de semana. */
  vence: Date
  /** Negativo si ya paso. */
  diasRestantes: number
  vencida: boolean
}

const DIA_MS = 86_400_000

/** Compara por dia calendario, no por instante: faltan dias, no horas. */
function soloFecha(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Las obligaciones de un periodo `YYYYMM`, ordenadas por fecha limite.
 *
 * Se declara el mes siguiente al que se cierra: el periodo 202609 vence en
 * octubre. `new Date(anio, mes, dia)` con `mes` en base 1 apunta ya al mes
 * siguiente, y diciembre rueda solo a enero del año que viene.
 */
export function calendarioFiscal(periodo: string, hoy: Date): ObligacionFiscal[] {
  const anio = Number(periodo.slice(0, 4))
  const mes = Number(periodo.slice(4, 6))

  const formularios = Object.keys(VENCIMIENTOS_RD) as Formulario[]
  return formularios
    .map((form) => {
      const bruta = new Date(anio, mes, VENCIMIENTOS_RD[form], 12, 0, 0, 0)
      const vence = proximoDiaHabil(bruta)
      const diasRestantes = Math.round((soloFecha(vence) - soloFecha(hoy)) / DIA_MS)
      return { form, periodo, vence, diasRestantes, vencida: diasRestantes < 0 }
    })
    .sort((a, b) => a.vence.getTime() - b.vence.getTime() || a.form.localeCompare(b.form))
}

// ── Desglose ───────────────────────────────────────────────────────────

export interface DesgloseItbis {
  base: number
  itbis: number
}

/**
 * Separa un total que YA trae ITBIS en base + impuesto, cuadrando exacto.
 *
 * Se redondea la base y el ITBIS sale por resta, nunca al reves: si se
 * redondean los dos por separado, base + itbis puede dar un centavo mas o
 * menos que el total, y ese centavo aparece despues como diferencia contra
 * el 607.
 */
export function desglosarItbis(totalConItbis: number, rate: number): DesgloseItbis {
  if (rate <= 0) return { base: roundBankers(totalConItbis, 2), itbis: 0 }
  const base = roundBankers(totalConItbis / (1 + rate), 2)
  return { base, itbis: roundBankers(totalConItbis - base, 2) }
}

// ── Retenciones ────────────────────────────────────────────────────────

export type TipoParte = 'fisica' | 'juridica'

export interface ReglaRetencion {
  tax: 'itbis' | 'isr'
  partyType: TipoParte | 'ambas'
  /** Sobre que se aplica la tasa: el ITBIS facturado o el subtotal. */
  base: 'itbis' | 'subtotal'
  rate: number
  /** Codigo 01-09 de TIPOS_RETENCION_ISR_606. Obligatorio si tax='isr'. */
  dgiiIsrType?: string | null
  isActive?: boolean
  /** Codigo de la regla. Solo para desempatar y para poder nombrarla. */
  code?: string
  /** `YYYY-MM-DD`. Solo para desempatar: gana la vigencia mas reciente. */
  effectiveFrom?: string
}

export interface BaseRetencion {
  subtotal: number
  itbis: number
  partyType: TipoParte
  isExempt?: boolean
  /**
   * De ese subtotal, cuanto es SERVICIOS.
   *
   * El ISR a personas fisicas se retiene sobre los servicios, no sobre la
   * compra de bienes. En una factura mixta -un tecnico que cobra las
   * piezas y la mano de obra en el mismo documento- retener el 10% de
   * todo le paga de menos al proveedor, y el numero no cuadra despues
   * contra el desglose servicios/bienes que el 606 obliga a declarar
   * (supplier_invoices.services_amount, campo 8 contra campo 9).
   *
   * Si no viene, la base es el subtotal completo: es el caso del
   * proveedor de puro servicio, que es el normal.
   */
  servicios?: number
}

export interface Retenciones {
  itbisRetenido: number
  isrRetenido: number
  /** Codigo DGII que llenaria supplier_invoices.isr_retention_type. */
  tipoRetencionIsr: string | null
  totalRetenido: number
  netoAPagar: number
  /**
   * Cuantas reglas podian aplicar en el nivel que gano, por impuesto.
   *
   * Mas de una significa que se aplico UNA de varias y que la eleccion la
   * decidio un desempate, no el usuario. Quien pinta el numero tiene que
   * decirlo: un numero limpio que salio de una entre tres reglas es peor
   * que un numero con aviso.
   */
  candidatas: { itbis: number; isr: number }
  /** Codigo de la regla que se aplico, cuando la regla lo trae. */
  reglaAplicada: { itbis: string | null; isr: string | null }
}

/**
 * Desempate EXPLICITO: primero la vigencia mas reciente, y a igual fecha
 * el codigo en orden alfabetico.
 *
 * Cualquier orden declarado sirve; el que no sirve es el de llegada. La
 * pantalla de retenciones alimenta este arreglo con TODAS las reglas
 * activas cuando el proveedor no tiene una asignada, ordenadas por
 * `tax, party_type` -que entre dos reglas de ISR para fisica no desempata
 * nada-, asi que ganaba la que Postgres devolviera primero esa vez. Con
 * los nueve codigos 01-09 del 606 (alquileres, honorarios, intereses...)
 * tener varias reglas de ISR para fisica no es un caso raro, y si solo
 * difiere el codigo el 606 del mes se declara con el tipo que no era.
 */
function ordenarReglas(reglas: ReglaRetencion[]): ReglaRetencion[] {
  return [...reglas].sort(
    (a, b) =>
      (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? '') ||
      (a.code ?? '').localeCompare(b.code ?? ''),
  )
}

/**
 * Una regla gana sobre otra si nombra al tipo de proveedor en vez de
 * cubrirlo con el comodin: una regla escrita para 'fisica' es una decision
 * mas especifica que una escrita para 'ambas', y quien la escribio queria
 * que aplicara.
 *
 * Devuelve tambien cuantas competian en el nivel que gano, porque aplicar
 * una de tres en silencio es el problema, no cual de las tres.
 */
function elegirRegla(
  reglas: ReglaRetencion[],
  tax: 'itbis' | 'isr',
  parte: TipoParte,
): { regla: ReglaRetencion | undefined; candidatas: number } {
  const activas = reglas.filter((r) => r.tax === tax && r.isActive !== false)
  const propias = activas.filter((r) => r.partyType === parte)
  const nivel = propias.length > 0 ? propias : activas.filter((r) => r.partyType === 'ambas')
  return { regla: ordenarReglas(nivel)[0], candidatas: nivel.length }
}

/**
 * Cuanto se le retiene a un proveedor y cuanto le queda neto.
 *
 * La distincion que de verdad importa: el ITBIS se retiene sobre el ITBIS
 * facturado, el ISR sobre el subtotal pagado. Aplicar una sobre la base de
 * la otra hace que la retencion salga unas seis veces mal -y con un numero
 * que parece razonable, que es lo peligroso-, asi que la base la manda la
 * regla y no esta funcion.
 *
 * Un proveedor exento devuelve todo en cero. No es un atajo: es la unica
 * forma de marcar zona franca o regimen especial en este modulo, que no
 * los modela.
 */
export function calcularRetenciones(entrada: BaseRetencion, reglas: ReglaRetencion[]): Retenciones {
  const bruto = roundBankers(entrada.subtotal + entrada.itbis, 2)

  if (entrada.isExempt === true) {
    return {
      itbisRetenido: 0,
      isrRetenido: 0,
      tipoRetencionIsr: null,
      totalRetenido: 0,
      netoAPagar: bruto,
      candidatas: { itbis: 0, isr: 0 },
      reglaAplicada: { itbis: null, isr: null },
    }
  }

  const eItbis = elegirRegla(reglas, 'itbis', entrada.partyType)
  const eIsr = elegirRegla(reglas, 'isr', entrada.partyType)

  // La base del subtotal se limita a los servicios cuando se dice cuanto
  // es servicios. Nunca puede pasar del subtotal: retener sobre mas de lo
  // que dice la factura no es un caso, es un dedazo.
  const baseSubtotal =
    entrada.servicios === undefined
      ? entrada.subtotal
      : Math.min(Math.max(entrada.servicios, 0), entrada.subtotal)

  const montoDe = (r: ReglaRetencion | undefined): number =>
    r === undefined ? 0 : roundBankers((r.base === 'itbis' ? entrada.itbis : baseSubtotal) * r.rate, 2)

  const itbisRetenido = montoDe(eItbis.regla)
  const isrRetenido = montoDe(eIsr.regla)
  const totalRetenido = roundBankers(itbisRetenido + isrRetenido, 2)

  return {
    itbisRetenido,
    isrRetenido,
    tipoRetencionIsr: isrRetenido > 0 ? (eIsr.regla?.dgiiIsrType ?? null) : null,
    totalRetenido,
    netoAPagar: roundBankers(bruto - totalRetenido, 2),
    candidatas: { itbis: eItbis.candidatas, isr: eIsr.candidatas },
    reglaAplicada: { itbis: eItbis.regla?.code ?? null, isr: eIsr.regla?.code ?? null },
  }
}

// ── Liquidacion IT-1 ───────────────────────────────────────────────────

/** El `YYYYMM` inmediatamente anterior. Enero retrocede a diciembre. */
export function periodoAnterior(periodo: string): string {
  const anio = Number(periodo.slice(0, 4))
  const mes = Number(periodo.slice(4, 6))
  return mes === 1 ? `${anio - 1}12` : `${anio}${String(mes - 1).padStart(2, '0')}`
}

/** Una declaracion ya presentada, para resolver la cadena del saldo. */
export interface DeclaracionPrevia {
  /** `YYYYMM`. */
  period: string
  creditForward: number
}

export interface SaldoArrastrado {
  /** Lo que este periodo puede tomar como `previous_credit`. */
  previousCredit: number
  /**
   * Periodo que hay que cerrar ANTES que este, o null si no falta ninguno.
   * Quien cierra tiene que negarse mientras esto no sea null.
   */
  faltaCerrar: string | null
}

/**
 * De donde sale el saldo a favor que arrastra un periodo.
 *
 * Del periodo INMEDIATAMENTE anterior y de ningun otro. Antes se tomaba
 * "la ultima declaracion que hubiera" (`period < X order by period desc
 * limit 1`), y asi el mismo saldo se consumia dos veces: cerrar 202609
 * con 5,000 de saldo, saltarse octubre y cerrar 202611 se lo comia; volver
 * despues a cerrar 202610 se lo comia otra vez. Dos declaraciones bajaban
 * el ITBIS a pagar por el mismo dinero y las dos quedaban cerradas como
 * foto, asi que ni siquiera se podian recalcular: hay que rectificar las
 * dos. Y el periodo entra por el query string, o sea que cerrar en el
 * orden que a uno le de la gana no es un escenario rebuscado -es el
 * cliente que se pone al dia-.
 *
 * Si falta el eslabon, no se inventa un cero: se dice cual falta. Un cero
 * silencioso es declarar de mas, que le cuesta dinero al cliente sin que
 * nadie se entere. La unica excepcion es la PRIMERA declaracion de la
 * historia: cuando no hay ninguna anterior no falta ninguna, y ahi el
 * cero es la verdad.
 */
export function creditoArrastrado(
  periodo: string,
  cerradas: DeclaracionPrevia[],
): SaldoArrastrado {
  const anteriores = cerradas.filter((f) => f.period < periodo)
  const previo = periodoAnterior(periodo)
  const exacta = anteriores.find((f) => f.period === previo)

  if (exacta) return { previousCredit: exacta.creditForward, faltaCerrar: null }
  if (anteriores.length > 0) return { previousCredit: 0, faltaCerrar: previo }
  return { previousCredit: 0, faltaCerrar: null }
}

export interface EntradaLiquidacion {
  /** ITBIS cobrado en ventas del periodo. */
  itbisCharged: number
  /** ITBIS adelantado en compras del periodo. */
  itbisPaid: number
  /** ITBIS que otros me retuvieron a mi. */
  itbisWithheld: number
  /**
   * ITBIS que YO le retuve a mis proveedores.
   *
   * Va SUMANDO, al reves que todo lo demas de esta formula, y por eso
   * tiene su propio campo en vez de restarse de `itbisPaid`.
   *
   * Cuando le retengo ITBIS a un proveedor, no se lo pago a el: me lo
   * quedo para entregarselo a la DGII. Es plata de la DGII que esta en
   * mi cuenta, o sea una deuda, no un credito.
   *
   * Y sin este campo el error se DUPLICA, porque `itbisPaid` ya credita
   * el 100% del ITBIS de esa compra: me acredito un ITBIS completo que
   * solo pague en parte, y ademas no declaro la parte que retuve. El
   * IT-1 sale corto por los dos lados y cuadra consigo mismo.
   */
  itbisRetainedFromSuppliers: number
  /** Saldo a favor que venia arrastrado del periodo anterior. */
  previousCredit: number
}

export interface Liquidacion {
  amountDue: number
  creditForward: number
}

/**
 * ITBIS cobrado, mas lo que retuve, menos adelantado, retenido y saldo.
 *
 * El unico termino que SUMA es `itbisRetainedFromSuppliers`: ese es
 * dinero de la DGII que yo tengo, no un credito mio. Ver el comentario
 * de ese campo.
 *
 * Que pasa cuando da negativo es una DECISION de negocio, no una formula:
 * el exceso se arrastra como saldo a favor del periodo siguiente y jamas
 * se declara "a pagar" en negativo. Por eso los dos valores son
 * excluyentes -uno de los dos siempre es cero- y la tabla lo verifica con
 * un check, sin recalcular nada.
 */
export function liquidarItbis(e: EntradaLiquidacion): Liquidacion {
  const neto = roundBankers(
    e.itbisCharged +
      e.itbisRetainedFromSuppliers -
      e.itbisPaid -
      e.itbisWithheld -
      e.previousCredit,
    2,
  )
  return neto > 0
    ? { amountDue: neto, creditForward: 0 }
    : { amountDue: 0, creditForward: roundBankers(-neto, 2) }
}
