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
}

export interface BaseRetencion {
  subtotal: number
  itbis: number
  partyType: TipoParte
  isExempt?: boolean
}

export interface Retenciones {
  itbisRetenido: number
  isrRetenido: number
  /** Codigo DGII que llenaria supplier_invoices.isr_retention_type. */
  tipoRetencionIsr: string | null
  totalRetenido: number
  netoAPagar: number
}

/**
 * Una regla gana sobre otra si nombra al tipo de proveedor en vez de
 * cubrirlo con el comodin: una regla escrita para 'fisica' es una decision
 * mas especifica que una escrita para 'ambas', y quien la escribio queria
 * que aplicara.
 */
function elegirRegla(reglas: ReglaRetencion[], tax: 'itbis' | 'isr', parte: TipoParte) {
  const activas = reglas.filter((r) => r.tax === tax && r.isActive !== false)
  return activas.find((r) => r.partyType === parte) ?? activas.find((r) => r.partyType === 'ambas')
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
    }
  }

  const rItbis = elegirRegla(reglas, 'itbis', entrada.partyType)
  const rIsr = elegirRegla(reglas, 'isr', entrada.partyType)

  const montoDe = (r: ReglaRetencion | undefined): number =>
    r === undefined ? 0 : roundBankers((r.base === 'itbis' ? entrada.itbis : entrada.subtotal) * r.rate, 2)

  const itbisRetenido = montoDe(rItbis)
  const isrRetenido = montoDe(rIsr)
  const totalRetenido = roundBankers(itbisRetenido + isrRetenido, 2)

  return {
    itbisRetenido,
    isrRetenido,
    tipoRetencionIsr: isrRetenido > 0 ? (rIsr?.dgiiIsrType ?? null) : null,
    totalRetenido,
    netoAPagar: roundBankers(bruto - totalRetenido, 2),
  }
}

// ── Liquidacion IT-1 ───────────────────────────────────────────────────

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
