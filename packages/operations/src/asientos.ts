import { validateEntryLines, type AccountType } from './accounting.js'

/**
 * Asientos automaticos — que asiento sale de cada hecho de la operacion.
 *
 * Contabilidad escucha eventos (`pos.sale.completed`, `ar.invoice.issued`,
 * `ap.invoice.recorded`...) y por cada uno escribe UN asiento ya
 * contabilizado. Este archivo decide las LINEAS: que se debita, que se
 * acredita y por cuanto. No sabe de base de datos ni de ids de cuenta:
 * habla en PROPOSITOS ("la caja", "el ITBIS por pagar") y el mapa
 * contable de cada cliente (`accounting_account_map`, 0131) traduce cada
 * proposito a SU cuenta.
 *
 * Por que propositos y no cuentas: el catalogo es del cliente. Un colmado
 * tiene "1101 Caja" y una ferreteria "1.1.01.001 Efectivo en caja"; la
 * regla "una venta de contado debita la caja" es la misma para los dos.
 *
 * Todo el calculo va en CENTAVOS enteros. Sumar 0.1 + 0.2 en coma
 * flotante da 0.30000000000000004, y un asiento que no cuadra por un
 * residuo de coma flotante lo rechaza la base -con razon-.
 */

// ── Propositos del mapa contable ────────────────────────────────────────

export type PropositoContable =
  | 'caja'
  | 'banco'
  | 'cxc'
  | 'inventario'
  | 'itbis_adelantado'
  | 'itbis_por_pagar'
  | 'cxp'
  | 'itbis_retenido'
  | 'isr_retenido'
  | 'ventas'
  | 'ingresos_mora'
  | 'costo_ventas'
  | 'compras'
  | 'gastos'

export interface DefinicionProposito {
  proposito: PropositoContable
  /** Como se le explica al contador en la pantalla del mapa. */
  etiqueta: string
  ayuda: string
  /** El tipo que TIENE que tener la cuenta: la base rechaza otro. */
  tipo: AccountType
  /** Cuenta por defecto si el cliente no eligio otra (se crea si falta). */
  codigo: string
  nombre: string
}

/**
 * Catalogo minimo por defecto, en el orden en que se muestra.
 *
 * No existia plantilla dominicana en el repo: esta es la minima que
 * necesitan los asientos automaticos, con los codigos alineados a los que
 * ya usa la demo (1101 Caja, 1102 CxC, 2101 ITBIS, 4101 Ventas, 5101 Costo)
 * para que un cliente que ya los tenga no termine con duplicados.
 *
 * `compras` apunta por defecto a la MISMA cuenta que `inventario`: la
 * factura de mercancia de un proveedor entra al inventario y sale al
 * costo cuando se vende. Un negocio de servicios la apunta a un gasto.
 *
 * `cuentas_contables_por_defecto()` en 0131 repite esta tabla en SQL (un
 * trigger no puede leer TypeScript); `contabilidad-automatica.accion.test.ts`
 * compara las dos.
 */
export const PROPOSITOS_CONTABLES: readonly DefinicionProposito[] = [
  {
    proposito: 'caja',
    etiqueta: 'Caja (efectivo)',
    ayuda: 'Se debita con cada venta o cobro en efectivo; se acredita al pagar en efectivo.',
    tipo: 'asset',
    codigo: '1101',
    nombre: 'Caja general',
  },
  {
    proposito: 'cxc',
    etiqueta: 'Cuentas por cobrar clientes',
    ayuda: 'Se debita al emitir una factura a credito; se acredita con cada cobro.',
    tipo: 'asset',
    codigo: '1102',
    nombre: 'Cuentas por cobrar clientes',
  },
  {
    proposito: 'banco',
    etiqueta: 'Banco (tarjeta, transferencia, cheque)',
    ayuda: 'Lo que no es efectivo: tarjeta, transferencia o cheque, al cobrar y al pagar.',
    tipo: 'asset',
    codigo: '1103',
    nombre: 'Bancos',
  },
  {
    proposito: 'inventario',
    etiqueta: 'Inventario de mercancias',
    ayuda: 'Se acredita con el costo de lo vendido en caja.',
    tipo: 'asset',
    codigo: '1104',
    nombre: 'Inventario de mercancias',
  },
  {
    proposito: 'itbis_adelantado',
    etiqueta: 'ITBIS adelantado',
    ayuda: 'El ITBIS que te facturan tus proveedores: lo descuentas en el IT-1.',
    tipo: 'asset',
    codigo: '1105',
    nombre: 'ITBIS adelantado en compras',
  },
  {
    proposito: 'itbis_por_pagar',
    etiqueta: 'ITBIS por pagar',
    ayuda: 'El ITBIS que cobras al vender: se le debe a la DGII.',
    tipo: 'liability',
    codigo: '2101',
    nombre: 'ITBIS por pagar',
  },
  {
    proposito: 'cxp',
    etiqueta: 'Cuentas por pagar proveedores',
    ayuda: 'Se acredita al registrar la factura del proveedor; se debita al pagarla.',
    tipo: 'liability',
    codigo: '2102',
    nombre: 'Cuentas por pagar proveedores',
  },
  {
    proposito: 'itbis_retenido',
    etiqueta: 'ITBIS retenido a terceros',
    ayuda: 'La parte de ITBIS que le retienes al proveedor: se le paga a la DGII, no a el.',
    tipo: 'liability',
    codigo: '2103',
    nombre: 'ITBIS retenido por pagar',
  },
  {
    proposito: 'isr_retenido',
    etiqueta: 'ISR retenido a terceros',
    ayuda: 'La retencion de ISR al proveedor (honorarios, alquileres): se le paga a la DGII.',
    tipo: 'liability',
    codigo: '2104',
    nombre: 'ISR retenido por pagar',
  },
  {
    proposito: 'ventas',
    etiqueta: 'Ventas',
    ayuda: 'Se acredita con lo vendido, sin el ITBIS.',
    tipo: 'revenue',
    codigo: '4101',
    nombre: 'Ventas de mercancias',
  },
  {
    proposito: 'costo_ventas',
    etiqueta: 'Costo de ventas',
    ayuda: 'Se debita con el costo promedio de lo que sale vendido en caja.',
    tipo: 'expense',
    codigo: '5101',
    nombre: 'Costo de ventas',
  },
  {
    proposito: 'compras',
    etiqueta: 'Compras de mercancia (606 tipo 09 o sin clasificar)',
    ayuda: 'Lo que se debita con la factura de un proveedor de mercancia. Por defecto, el inventario.',
    tipo: 'asset',
    codigo: '1104',
    nombre: 'Inventario de mercancias',
  },
  {
    proposito: 'gastos',
    etiqueta: 'Gastos (606 tipos 01-08, 10 y 11)',
    ayuda: 'Lo que se debita con la factura de un proveedor que no es mercancia para vender.',
    tipo: 'expense',
    codigo: '6101',
    nombre: 'Gastos generales',
  },
  {
    proposito: 'ingresos_mora',
    etiqueta: 'Recargos por mora',
    ayuda: 'El cargo por mora que se le aplica a una factura vencida: es un ingreso aparte de la venta.',
    tipo: 'revenue',
    codigo: '4201',
    nombre: 'Recargos por mora',
  },
]

// ── Lineas ──────────────────────────────────────────────────────────────

/**
 * Una linea de un asiento automatico. Lleva el PROPOSITO (se traduce con
 * el mapa del cliente) o la CUENTA ya resuelta -solo los reversos: un
 * reverso tiene que tocar exactamente las cuentas del original, aunque el
 * mapa haya cambiado despues-.
 */
export interface LineaAutomatica {
  purpose?: PropositoContable
  accountId?: string
  debit: number
  credit: number
  memo?: string
}

export type MetodoPago = 'cash' | 'card' | 'transfer' | 'check'

/** Efectivo va a caja; tarjeta, transferencia y cheque, al banco. */
export function propositoDelMetodo(metodo: string): 'caja' | 'banco' {
  return metodo === 'cash' ? 'caja' : 'banco'
}

const cent = (n: number | string): number => Math.round(Number(n) * 100)
const peso = (c: number): number => c / 100

function debe(purpose: PropositoContable, centavos: number, memo?: string): LineaAutomatica[] {
  return centavos > 0 ? [{ purpose, debit: peso(centavos), credit: 0, ...(memo ? { memo } : {}) }] : []
}
function haber(purpose: PropositoContable, centavos: number, memo?: string): LineaAutomatica[] {
  return centavos > 0 ? [{ purpose, debit: 0, credit: peso(centavos), ...(memo ? { memo } : {}) }] : []
}

/**
 * Ultimo filtro antes de devolver: si una regla de aqui produjera un
 * asiento descuadrado, que reviente AQUI -en la prueba unitaria- y no en
 * la base a las 6 de la tarde con la caja llena.
 */
function cuadrado(lineas: LineaAutomatica[]): LineaAutomatica[] {
  if (lineas.length === 0) return lineas
  const v = validateEntryLines(lineas)
  if (!v.ok) throw new Error(`Regla de asiento automatico mal armada: ${v.error}`)
  return lineas
}

// ── Venta de contado (POS) ──────────────────────────────────────────────

export interface VentaContado {
  total: number | string
  /** ITBIS del ticket. */
  impuesto: number | string
  pagos: { method: string; amount: number | string }[]
  /** Costo de lo vendido (cantidad x costo promedio). 0 si no se sabe. */
  costo?: number | string
}

/**
 * Venta de caja:
 *
 *   Caja / Banco          total (repartido segun como se pago)
 *       Ventas                    total - ITBIS
 *       ITBIS por pagar           ITBIS
 *   Costo de ventas       costo
 *       Inventario                costo
 *
 * Ventas es `total - ITBIS` y no el `subtotal` guardado: hay documentos
 * con subtotal bruto y otros con subtotal neto de descuento (hallazgo 4
 * del analisis de flujo), y total - ITBIS es lo que de verdad se cobro
 * sin impuesto en los dos casos.
 *
 * La caja acepta pagos que difieren del total en un centavo (redondeo al
 * dividir entre formas de pago): ese centavo se absorbe en la forma de
 * pago mas grande para que el asiento cuadre con el total del ticket.
 */
export function asientoVentaContado(v: VentaContado): LineaAutomatica[] {
  const total = cent(v.total)
  const itbis = cent(v.impuesto)
  const costo = Math.max(0, cent(v.costo ?? 0))

  const porProposito = new Map<'caja' | 'banco', number>()
  for (const p of v.pagos) {
    const c = cent(p.amount)
    if (c <= 0) continue
    const k = propositoDelMetodo(p.method)
    porProposito.set(k, (porProposito.get(k) ?? 0) + c)
  }
  if (porProposito.size === 0) porProposito.set('caja', total)

  const pagado = [...porProposito.values()].reduce((a, c) => a + c, 0)
  const residuo = total - pagado
  if (residuo !== 0) {
    const mayor = [...porProposito.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    porProposito.set(mayor, porProposito.get(mayor)! + residuo)
  }

  return cuadrado([
    ...debe('caja', porProposito.get('caja') ?? 0),
    ...debe('banco', porProposito.get('banco') ?? 0),
    ...haber('ventas', total - itbis),
    ...haber('itbis_por_pagar', itbis),
    ...debe('costo_ventas', costo, 'Costo promedio de lo vendido'),
    ...haber('inventario', costo, 'Costo promedio de lo vendido'),
  ])
}

// ── Factura a credito (AR) ──────────────────────────────────────────────

/**
 *   Cuentas por cobrar    total
 *       Ventas                    total - ITBIS
 *       ITBIS por pagar           ITBIS
 */
export function asientoFacturaCredito(f: {
  total: number | string
  impuesto: number | string
}): LineaAutomatica[] {
  const total = cent(f.total)
  const itbis = cent(f.impuesto)
  return cuadrado([
    ...debe('cxc', total),
    ...haber('ventas', total - itbis),
    ...haber('itbis_por_pagar', itbis),
  ])
}

// ── Cobro de una factura (AR) ───────────────────────────────────────────

/**
 *   Caja / Banco          monto
 *       Cuentas por cobrar        monto
 */
export function asientoCobroCliente(c: {
  monto: number | string
  metodo: string
}): LineaAutomatica[] {
  const monto = cent(c.monto)
  return cuadrado([...debe(propositoDelMetodo(c.metodo), monto), ...haber('cxc', monto)])
}

// ── Nota de credito y mora (AR) ─────────────────────────────────────────

/**
 * Nota de credito (B04): devolucion o rebaja sobre una factura a credito.
 * Es la factura al reves, por el monto de la nota:
 *
 *   Ventas                total - ITBIS
 *   ITBIS por pagar       ITBIS
 *       Cuentas por cobrar        total
 */
export function asientoNotaCredito(n: {
  total: number | string
  impuesto: number | string
}): LineaAutomatica[] {
  const total = cent(n.total)
  const itbis = cent(n.impuesto)
  return cuadrado([
    ...debe('ventas', total - itbis),
    ...debe('itbis_por_pagar', itbis),
    ...haber('cxc', total),
  ])
}

/**
 * Cargo por mora: el cliente debe mas, y ese mas es un ingreso distinto
 * de la venta (sin ITBIS: no es una venta de bienes ni un servicio nuevo).
 * Sin este asiento, cobrar la mora dejaba la cartera del mayor en
 * negativo por el monto del cargo.
 *
 *   Cuentas por cobrar    monto
 *       Recargos por mora         monto
 */
export function asientoCargoMora(m: { monto: number | string }): LineaAutomatica[] {
  const monto = cent(m.monto)
  return cuadrado([...debe('cxc', monto), ...haber('ingresos_mora', monto)])
}

// ── Factura de proveedor (AP) ───────────────────────────────────────────

/**
 * El tipo de gasto del 606 decide a donde va la base: `09` (compras que
 * forman parte del costo de venta) y "sin clasificar" van a `compras` (por
 * defecto, el inventario); todo lo demas es un gasto. Sin clasificar se
 * trata como mercancia porque es lo que registra un negocio de inventario
 * el 90% de las veces, y el mapa deja apuntarlo a otra cuenta.
 */
export function propositoDelGasto(tipoGasto: string | null | undefined): 'compras' | 'gastos' {
  return !tipoGasto || tipoGasto === '09' ? 'compras' : 'gastos'
}

/**
 *   Compras / Gastos      total - ITBIS
 *   ITBIS adelantado      ITBIS
 *       Cuentas por pagar         total - retencion
 *       ITBIS retenido            retencion - ISR retenido
 *       ISR retenido              ISR retenido
 *
 * Lo retenido no se le debe al proveedor sino a la DGII: por eso la
 * cuenta por pagar queda en `total - retencion`, que es exactamente el
 * tope que `registrarPago` deja pagar.
 */
export function asientoFacturaProveedor(f: {
  total: number | string
  impuesto: number | string
  retencion?: number | string
  isrRetenido?: number | string
  tipoGasto?: string | null
}): LineaAutomatica[] {
  const total = cent(f.total)
  const itbis = cent(f.impuesto)
  const retencion = cent(f.retencion ?? 0)
  const isr = Math.min(cent(f.isrRetenido ?? 0), retencion)
  return cuadrado([
    ...debe(propositoDelGasto(f.tipoGasto), total - itbis),
    ...debe('itbis_adelantado', itbis),
    ...haber('cxp', total - retencion),
    ...haber('itbis_retenido', retencion - isr),
    ...haber('isr_retenido', isr),
  ])
}

// ── Pago a un proveedor (AP) ────────────────────────────────────────────

/**
 *   Cuentas por pagar     monto
 *       Caja / Banco              monto
 */
export function asientoPagoProveedor(p: {
  monto: number | string
  metodo: string
}): LineaAutomatica[] {
  const monto = cent(p.monto)
  return cuadrado([...debe('cxp', monto), ...haber(propositoDelMetodo(p.metodo), monto)])
}

// ── Reverso ─────────────────────────────────────────────────────────────

/**
 * El asiento inverso de otro: mismas cuentas, debito y credito
 * intercambiados. Es como se "anula" en contabilidad -el original queda,
 * inmutable, y los dos juntos suman cero-.
 */
export function invertirAsiento(
  original: { accountId: string; debit: number | string; credit: number | string; memo?: string | null }[],
): LineaAutomatica[] {
  return cuadrado(
    original.map((l) => ({
      accountId: l.accountId,
      debit: peso(cent(l.credit)),
      credit: peso(cent(l.debit)),
      ...(l.memo ? { memo: l.memo } : {}),
    })),
  )
}
