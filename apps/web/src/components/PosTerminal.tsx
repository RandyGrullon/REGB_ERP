'use client'

import { useMemo, useState } from 'react'
import { Badge, Icon, cn } from '@regb/ui'
import {
  computeChange,
  documentTotals,
  paymentsBalance,
  resolverPrecio,
  type EntradaLista,
  type ListaPrecio,
  type PaymentMethod,
} from '@regb/operations'
import { cobrarVentaForm } from '@/app/pos/actions'
import { BotonEnvio } from '@/components/BotonEnvio'

/**
 * Terminal tactil de caja (S21).
 *
 * Botones grandes: se usa con el dedo sobre una tablet, no con raton. El
 * carrito vive en el cliente para que agregar un articulo sea instantaneo
 * —el cajero no espera al servidor entre producto y producto— pero el
 * COBRO va entero al servidor en una sola transaccion, y alli se vuelven a
 * calcular precios, impuestos y totales. Lo que manda el navegador es una
 * sugerencia, nunca un precio (§8.3).
 */

export interface PosProduct {
  id: string
  sku: string
  /** Codigo de barras impreso en el empaque. Lo dispara el lector. */
  barcode: string | null
  name: string
  unit: string
  price: number
  taxRate: number
  disponible: number
  /** false = concepto sin existencias (envio, instalacion). */
  tracksStock: boolean
}

export interface PosCustomer {
  id: string
  name: string
}

/**
 * Listas de precio, tal como viajan al navegador.
 *
 * Van en texto y no como `Date` porque lo que cruza del servidor al
 * cliente se serializa, y una fecha reconstruida a mano no depende de
 * como Next decida serializarla hoy.
 *
 * Viajan al navegador a proposito: el precio de un cliente mayorista
 * depende de a QUIEN se le vende, y el cajero elige el cliente aqui,
 * despues de armar el carrito. Si el precio solo se resolviera en el
 * servidor, la pantalla ensenaria un total y el ticket saldria con otro
 * -y el cobro se caeria por descuadre-. No hay secreto que proteger: un
 * precio es justo lo que se le ensena al cliente.
 */
/** Una cuota de una lista, con el producto al que pertenece. */
export interface PosEntrada extends EntradaLista {
  productId: string
}

export interface PosLista {
  id: string
  scope: string
  customerId: string | null
  channel: string | null
  startDate: string
  endDate: string | null
  status: string
}

interface Linea {
  productId: string
  qty: number
  discountPct: number
}

const METODOS: { id: PaymentMethod; label: string; icon: string }[] = [
  { id: 'cash', label: 'Efectivo', icon: 'payments' },
  { id: 'card', label: 'Tarjeta', icon: 'credit_card' },
  { id: 'transfer', label: 'Transferencia', icon: 'account_balance' },
]

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Lo unico que el terminal necesita del escritorio. */
interface PuenteCaja {
  encolarVenta?: (v: {
    soldAt: string
    shiftId: string
    customerId: string | null
    cart: unknown
    payments: unknown
    tenant?: string
    rol?: string
  }) => Promise<{ ok: boolean; clientRef: string; pendientes: number }>
}

/**
 * Criterio unico de busqueda: lo usan la rejilla y el escaner. Separados
 * se desincronizan, y entonces el cajero ve un solo producto en pantalla
 * pero el Enter no lo agrega —el fallo mas confuso posible en un mostrador.
 */
function coincide(p: PosProduct, q: string): boolean {
  const t = q.toLowerCase()
  return (
    p.name.toLowerCase().includes(t) ||
    p.sku.toLowerCase().includes(t) ||
    (p.barcode?.includes(q) ?? false)
  )
}

export function PosTerminal({
  shiftId,
  products,
  customers,
  listas,
  entradas,
  puedeDescuento,
  hiddenFields,
}: {
  shiftId: string
  products: PosProduct[]
  customers: PosCustomer[]
  listas: PosLista[]
  entradas: PosEntrada[]
  puedeDescuento: boolean
  hiddenFields: Record<string, string>
}) {
  const [busqueda, setBusqueda] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [customerId, setCustomerId] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('cash')
  const [recibido, setRecibido] = useState('')
  const [noEncontrado, setNoEncontrado] = useState<string | null>(null)
  const [encolada, setEncolada] = useState<string | null>(null)

  const porId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const filtrados = useMemo(() => {
    const q = busqueda.trim()
    if (q === '') return products.slice(0, 40)
    return products.filter((p) => coincide(p, q)).slice(0, 40)
  }, [busqueda, products])

  const listasParseadas = useMemo<ListaPrecio[]>(
    () =>
      listas.map((l) => ({
        id: l.id,
        scope: l.scope as ListaPrecio['scope'],
        customerId: l.customerId,
        channel: l.channel,
        startDate: new Date(`${l.startDate}T00:00:00Z`),
        endDate: l.endDate === null ? null : new Date(`${l.endDate}T23:59:59Z`),
        status: l.status,
      })),
    [listas],
  )

  const entradasPorProducto = useMemo(() => {
    const m = new Map<string, EntradaLista[]>()
    for (const e of entradas) {
      const acc = m.get(e.productId)
      if (acc) acc.push(e)
      else m.set(e.productId, [e])
    }
    return m
  }, [entradas])

  /**
   * El precio de una linea, con la MISMA funcion que usa el servidor.
   *
   * Que el cajero vea 80 y el ticket diga 80 no es cosmetico: si no
   * coinciden, el servidor rechaza el cobro por descuadre de pagos y el
   * cliente ya tiene el dinero en la mano.
   */
  const precioDe = useMemo(
    () => (productId: string, cantidad: number) => {
      const p = porId.get(productId)
      if (!p) return 0
      return resolverPrecio(
        p.price,
        listasParseadas,
        entradasPorProducto.get(productId) ?? [],
        { customerId: customerId || null, channel: 'pos', cantidad },
        new Date(),
      ).precio
    },
    [porId, listasParseadas, entradasPorProducto, customerId],
  )

  // Mismo motor que usa el servidor: lo que ve el cajero antes de cobrar es
  // exactamente lo que se va a guardar.
  const totales = useMemo(
    () =>
      documentTotals(
        lineas.map((l) => {
          const p = porId.get(l.productId)!
          return {
            quantity: l.qty,
            unitPrice: precioDe(l.productId, l.qty),
            discountPct: l.discountPct,
            taxRate: p.taxRate,
          }
        }),
      ),
    [lineas, porId, precioDe],
  )

  const entregado = Number(recibido.replace(/,/g, '')) || 0
  const vuelto = computeChange(entregado, totales.total)
  const pagos = [{ method: metodo, amount: totales.total }]
  const puedeCobrar =
    lineas.length > 0 &&
    paymentsBalance(pagos, totales.total) &&
    (metodo !== 'cash' || entregado >= totales.total)

  function agregar(p: PosProduct) {
    setLineas((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id)
      if (i >= 0) {
        const copia = [...prev]
        copia[i] = { ...copia[i]!, qty: copia[i]!.qty + 1 }
        return copia
      }
      return [...prev, { productId: p.id, qty: 1, discountPct: 0 }]
    })
    setBusqueda('')
  }

  /**
   * Lector de codigo de barras.
   *
   * Un lector USB es un TECLADO: teclea el codigo y manda Enter. No hace
   * falta driver ni Electron — solo escuchar el Enter en el buscador,
   * resolver el codigo y limpiar para el siguiente producto.
   *
   * Se busca por codigo de barras exacto primero y por SKU despues: dos
   * productos distintos no comparten codigo, pero un SKU escrito a mano
   * puede coincidir parcialmente con otro.
   */
  function alEscanear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()

    // Del DOM, no del estado: el escaner teclea el codigo entero y manda
    // Enter en milisegundos, asi que `busqueda` puede ir un render atrasado
    // y con el closure viejo se leeria un codigo a medias. El input siempre
    // tiene el valor completo.
    const codigo = e.currentTarget.value.trim()
    if (codigo === '') return

    const exacto =
      products.find((p) => p.barcode && p.barcode === codigo) ??
      products.find((p) => p.sku.toLowerCase() === codigo.toLowerCase())

    if (exacto) {
      agregar(exacto)
      return
    }
    // Un solo resultado tambien basta: el cajero ya filtro escribiendo.
    const coincidencias = products.filter((p) => coincide(p, codigo))
    if (coincidencias.length === 1) {
      agregar(coincidencias[0]!)
      return
    }
    setNoEncontrado(codigo)
    setTimeout(() => setNoEncontrado(null), 2500)
  }

  /**
   * Cobro en la app de escritorio (F5).
   *
   * Cuando existe el puente, la venta SIEMPRE pasa por la cola: haya linea
   * o no. Un solo camino, no dos.
   *
   * Es deliberado y es la decision que evita la clase de fallo mas cara de
   * un POS offline. Si la caja preguntara "¿hay internet?" para decidir
   * entre enviar y encolar, el caso malo es justo el del medio: hay linea,
   * el envio sale, y el corte ocurre ANTES de que llegue la respuesta.
   * Ahi la caja no sabe si la venta entro, y cualquier cosa que haga esta
   * mal —reintentar duplica, rendirse pierde—. Pasando siempre por la
   * cola, ese caso es el normal: la clave de idempotencia hace que el
   * reintento sea seguro y la venta llegue exactamente una vez.
   *
   * Con linea, la cola sube de inmediato y el cajero no nota diferencia.
   */
  function alCobrar(e: React.FormEvent<HTMLFormElement>) {
    const puente = (window as unknown as { regb?: PuenteCaja }).regb
    if (!puente?.encolarVenta) return // en el navegador manda el formulario

    e.preventDefault()
    void puente
      .encolarVenta({
        soldAt: new Date().toISOString(),
        shiftId,
        customerId: customerId || null,
        cart: lineas,
        payments: pagos,
        ...(hiddenFields.tenant ? { tenant: hiddenFields.tenant } : {}),
        ...(hiddenFields.rol ? { rol: hiddenFields.rol } : {}),
      })
      .then((r) => {
        setLineas([])
        setRecibido('')
        setEncolada(
          r.pendientes > 1
            ? `Cobrada. Quedan ${r.pendientes} ventas por subir.`
            : 'Cobrada y subida.',
        )
        setTimeout(() => setEncolada(null), 4000)
      })
  }

  function cambiarQty(productId: string, delta: number) {
    setLineas((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    )
  }

  function cambiarDescuento(productId: string, pct: number) {
    setLineas((prev) =>
      prev.map((l) =>
        l.productId === productId ? { ...l, discountPct: Math.min(100, Math.max(0, pct)) } : l,
      ),
    )
  }

  const btn =
    'flex items-center justify-center gap-1.5 rounded-[var(--radius-lg)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      {/* ── Catalogo ──────────────────────────────────────────────── */}
      <section aria-label="Productos" className="space-y-3">
        <div className="relative flex items-center">
          <Icon
            name="search"
            size={20}
            className="pointer-events-none absolute left-3 text-[var(--color-text-muted)]"
          />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={alEscanear}
            placeholder="Buscar o escanear codigo de barras…"
            aria-label="Buscar producto o escanear codigo de barras"
            autoFocus
            className="h-12 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-input)] pl-11 pr-3 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-brand-bright)]"
          />
        </div>

        {noEncontrado && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_16%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-text-warning)]"
          >
            <Icon name="barcode_reader" size={18} />
            Ningun producto con el codigo <strong>{noEncontrado}</strong>. Revisa que este en el
            catalogo con su codigo de barras.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {filtrados.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => agregar(p)}
              className={cn(
                btn,
                'min-h-24 flex-col items-start border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 text-left hover:border-[var(--color-brand)] hover:bg-[var(--color-surface-overlay)]',
              )}
            >
              <span className="line-clamp-2 flex-1 text-sm font-medium text-[var(--color-text-primary)]">
                {p.name}
              </span>
              <span className="tabular mt-1 w-full text-sm font-bold text-[var(--color-brand-bright)]">
                RD$ {money(precioDe(p.id, 1))}
                {precioDe(p.id, 1) !== p.price && (
                  <span className="ml-1 text-[10px] font-normal text-[var(--color-text-muted)] line-through">
                    {money(p.price)}
                  </span>
                )}
              </span>
              <span className="flex w-full items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                <span className="font-[family-name:var(--font-mono)]">{p.sku}</span>
                {p.tracksStock ? (
                  <span
                    className={p.disponible <= 0 ? 'text-[var(--color-semantic-text-danger)]' : ''}
                  >
                    {p.disponible} {p.unit}
                  </span>
                ) : (
                  // Un envio no tiene existencias que contar. Ensenar "0"
                  // le diria al cajero que no lo puede vender, que es
                  // justo al reves.
                  <span>servicio</span>
                )}
              </span>
            </button>
          ))}
          {filtrados.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-[var(--color-text-muted)]">
              Nada coincide con &quot;{busqueda}&quot;.
            </p>
          )}
        </div>
      </section>

      {/* ── Ticket ────────────────────────────────────────────────── */}
      <section
        aria-label="Ticket"
        className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[var(--color-text-primary)]">Ticket</h2>
          {lineas.length > 0 && (
            <button
              type="button"
              onClick={() => setLineas([])}
              className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-semantic-text-danger)]"
            >
              <Icon name="delete_sweep" size={16} />
              Vaciar
            </button>
          )}
        </div>

        {customers.length > 0 && (
          <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            Cliente
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
            >
              <option value="">Consumidor final</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <ul className="min-h-32 flex-1 space-y-2 overflow-y-auto">
          {lineas.length === 0 && (
            <li className="grid min-h-32 place-items-center text-center text-sm text-[var(--color-text-muted)]">
              Toca un producto para agregarlo.
            </li>
          )}
          {lineas.map((l, i) => {
            const p = porId.get(l.productId)!
            const t = totales.lines[i]
            return (
              <li
                key={l.productId}
                className="rounded-[var(--radius-md)] bg-[var(--color-surface-overlay)] p-2"
              >
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-sm text-[var(--color-text-primary)]">
                    {p.name}
                    {l.qty > p.disponible && (
                      <Badge tone="warning" dot={false} className="ml-1">
                        sin stock
                      </Badge>
                    )}
                  </span>
                  <span className="tabular text-sm font-semibold text-[var(--color-text-primary)]">
                    {money(t?.total ?? 0)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => cambiarQty(l.productId, -1)}
                    aria-label={`Quitar uno de ${p.name}`}
                    className={cn(
                      btn,
                      'h-8 w-8 bg-[var(--color-surface-raised)] hover:bg-[var(--color-surface-deep)]',
                    )}
                  >
                    <Icon name="remove" size={16} />
                  </button>
                  <span className="tabular w-10 text-center text-sm text-[var(--color-text-primary)]">
                    {l.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => cambiarQty(l.productId, 1)}
                    aria-label={`Agregar uno de ${p.name}`}
                    className={cn(
                      btn,
                      'h-8 w-8 bg-[var(--color-surface-raised)] hover:bg-[var(--color-surface-deep)]',
                    )}
                  >
                    <Icon name="add" size={16} />
                  </button>
                  <span className="tabular ml-auto text-xs text-[var(--color-text-muted)]">
                    × {money(precioDe(l.productId, l.qty))}
                  </span>
                  {puedeDescuento && (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={l.discountPct || ''}
                      onChange={(e) => cambiarDescuento(l.productId, Number(e.target.value))}
                      placeholder="%"
                      aria-label={`Descuento de ${p.name}`}
                      className="h-8 w-12 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-1 text-center text-xs text-[var(--color-text-primary)]"
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <dl className="space-y-1 border-t border-[var(--color-border)] pt-3 text-sm">
          <div className="flex justify-between text-[var(--color-text-secondary)]">
            <dt>Subtotal</dt>
            <dd className="tabular">{money(totales.subtotal)}</dd>
          </div>
          {totales.discount > 0 && (
            <div className="flex justify-between text-[var(--color-semantic-text-warning)]">
              <dt>Descuento</dt>
              <dd className="tabular">−{money(totales.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between text-[var(--color-text-secondary)]">
            <dt>ITBIS</dt>
            <dd className="tabular">{money(totales.tax)}</dd>
          </div>
          <div className="flex justify-between border-t border-[var(--color-border)] pt-2 text-lg font-bold text-[var(--color-text-primary)]">
            <dt>Total</dt>
            <dd className="tabular">RD$ {money(totales.total)}</dd>
          </div>
        </dl>

        {/* Forma de pago */}
        <div className="grid grid-cols-3 gap-1.5">
          {METODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMetodo(m.id)}
              className={cn(
                btn,
                'h-11 flex-col gap-0.5 border text-[11px]',
                metodo === m.id
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand-bright)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)]',
              )}
            >
              <Icon name={m.icon} size={18} filled={metodo === m.id} />
              {m.label}
            </button>
          ))}
        </div>

        {metodo === 'cash' && (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              Recibe
              <input
                value={recibido}
                onChange={(e) => setRecibido(e.target.value)}
                inputMode="decimal"
                placeholder={totales.total.toFixed(2)}
                className="tabular h-10 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-right text-base text-[var(--color-text-primary)]"
              />
            </label>
            {entregado > 0 && (
              <p className="flex justify-between text-sm">
                <span className="text-[var(--color-text-secondary)]">Vuelto</span>
                <span className="tabular font-bold text-[var(--color-semantic-text-success)]">
                  RD$ {money(vuelto)}
                </span>
              </p>
            )}
          </div>
        )}

        <form action={cobrarVentaForm} onSubmit={alCobrar}>
          {Object.entries(hiddenFields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="shiftId" value={shiftId} />
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="cart" value={JSON.stringify(lineas)} />
          <input type="hidden" name="payments" value={JSON.stringify(pagos)} />
          <BotonEnvio
            
            disabled={!puedeCobrar}
            onClick={() =>
              setTimeout(() => {
                setLineas([])
                setRecibido('')
              }, 100)
            }
            className={cn(
              btn,
              'h-14 w-full bg-[var(--color-brand)] text-base font-bold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            <Icon name="point_of_sale" size={22} />
            Cobrar RD$ {money(totales.total)}
          </BotonEnvio>
        </form>

        {encolada && (
          <p
            role="status"
            className="mt-2 flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-semantic-success)_14%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-text-success)]"
          >
            <Icon name="check_circle" size={18} filled />
            {encolada}
          </p>
        )}
      </section>
    </div>
  )
}
