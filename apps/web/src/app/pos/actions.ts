'use server'

import { revalidatePath } from 'next/cache'
import {
  discountWithinLimit,
  documentTotals,
  esMotivoDgii,
  paymentsBalance,
  reconcileCash,
  type Payment,
  type PaymentMethod,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { preciosDeVenta } from '@/lib/precio'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'
import type { PosProduct } from '@/components/PosTerminal'

/**
 * Acciones del punto de venta (S21).
 *
 * Un ticket SIEMPRE pertenece a un turno abierto: sin eso no hay arqueo
 * posible, porque al cerrar la caja no se sabria que ventas contar.
 *
 * La venta descuenta existencia de inmediato (movimiento `sale`): en el
 * mostrador no hay reserva previa, el cliente se lleva la mercancia.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const num = (raw: string): number | null => {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ── Turnos ───────────────────────────────────────────────────────────────

export async function abrirTurno(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'pos', 'pos.shift.open')
  if (!permiso.ok) return permiso

  const warehouseId = String(fd.get('warehouseId') ?? '')
  const fondo = num(String(fd.get('openingFloat') ?? '0')) ?? 0
  if (!warehouseId) return { ok: false, error: 'Elige el almacen de la caja.' }
  if (fondo < 0) return { ok: false, error: 'El fondo no puede ser negativo.' }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [abierto] = await tx<{ id: string }[]>`
      select id from public.pos_shifts
      where tenant_id = ${ctx.tenantId} and warehouse_id = ${warehouseId} and status = 'open'`
    if (abierto) return 'ya-abierto'

    await tx`
      insert into public.pos_shifts (tenant_id, warehouse_id, cashier_id, opening_float)
      values (${ctx.tenantId}, ${warehouseId}, ${ctx.userId}, ${fondo})`
    return 'ok'
  })

  if (res === 'ya-abierto') {
    return { ok: false, error: 'Ya hay un turno abierto en esa caja. Cierralo primero.' }
  }

  revalidatePath('/pos')
  revalidatePath('/pos/shifts')
  return { ok: true }
}

/**
 * Cierra el turno con el arqueo. Guarda lo esperado y la diferencia
 * calculados: si despues se anula un ticket, el cierre sigue reflejando lo
 * que se conto ese dia.
 */
export async function cerrarTurno(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'pos', 'pos.shift.close')
  if (!permiso.ok) return permiso

  const shiftId = String(fd.get('shiftId') ?? '')
  const contado = num(String(fd.get('countedCash') ?? ''))
  const notas = String(fd.get('notes') ?? '').trim() || null
  if (!shiftId) return { ok: false, error: 'Faltan datos.' }
  if (contado === null || contado < 0) {
    return { ok: false, error: 'Cuenta el efectivo antes de cerrar.' }
  }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [shift] = await tx<{ status: string; opening_float: string }[]>`
      select status, opening_float::text from public.pos_shifts
      where id = ${shiftId} and tenant_id = ${ctx.tenantId} for update`
    if (!shift) return 'no-existe'
    if (shift.status !== 'open') return 'ya-cerrado'

    const pagos = await tx<{ method: PaymentMethod; amount: string }[]>`
      select p.method, p.amount::text
      from public.pos_payments p
      join public.pos_sales s on s.id = p.sale_id
      where s.shift_id = ${shiftId} and s.tenant_id = ${ctx.tenantId} and not s.voided`

    const arqueo = reconcileCash(
      Number(shift.opening_float),
      pagos.map((p): Payment => ({ method: p.method, amount: Number(p.amount) })),
      contado,
    )

    await tx`
      update public.pos_shifts
      set status = 'closed', closed_at = now(), counted_cash = ${arqueo.counted},
          expected_cash = ${arqueo.expected}, variance = ${arqueo.difference}, notes = ${notas}
      where id = ${shiftId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('pos.shift.closed',
        ${JSON.stringify({ shiftId, variance: arqueo.difference })}::text::jsonb, 'pos')`

    return 'ok'
  })

  if (res === 'no-existe') return { ok: false, error: 'Ese turno no existe.' }
  if (res === 'ya-cerrado') return { ok: false, error: 'Ese turno ya esta cerrado.' }

  revalidatePath('/pos')
  revalidatePath('/pos/shifts')
  revalidatePath('/pos/reports')
  return { ok: true }
}

// ── Venta ────────────────────────────────────────────────────────────────

/**
 * Lo que la caja necesita saber de la venta recien cobrada: su ticket y
 * su NCF, para ofrecer imprimirlo. Sigue siendo un `ActionResult` para
 * quien no lo necesita (la cola del escritorio, `/api/pos/sync`).
 */
export type ResultadoCobro =
  | { ok: true; venta?: { id: string; ncf: string | null; total: number } }
  | { ok: false; error: string }

/**
 * Cobra un ticket completo: lineas + pagos, todo en una transaccion.
 *
 * El carrito viaja como JSON en un campo del formulario. Asi la caja
 * funciona con un solo envio y no deja tickets a medias si el cajero
 * cierra la pestana en mitad del cobro.
 */
export async function cobrarVenta(fd: FormData): Promise<ResultadoCobro> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'pos', 'pos.sell')
  if (!permiso.ok) return permiso

  const shiftId = String(fd.get('shiftId') ?? '')
  const customerId = String(fd.get('customerId') ?? '') || null
  if (!shiftId) return { ok: false, error: 'Abre un turno antes de vender.' }

  // Clave de idempotencia de la caja (F5). Va siempre, no solo offline:
  // una respuesta perdida por un corte deja a la caja sin saber si la
  // venta entro, y su unica salida es reintentar. Sin esta clave, ese
  // reintento crea el duplicado que descuadra el arqueo a las 6 de la
  // tarde. `sold_at` es la hora REAL del cobro, que en una venta encolada
  // no es la de llegada al servidor.
  const clientRef = String(fd.get('clientRef') ?? '').trim() || null
  const soldAtRaw = String(fd.get('soldAt') ?? '').trim()
  const soldAt = soldAtRaw !== '' && !Number.isNaN(Date.parse(soldAtRaw)) ? soldAtRaw : null
  if (clientRef !== null && !/^[0-9a-f-]{36}$/i.test(clientRef)) {
    return { ok: false, error: 'La referencia de la venta no es valida.' }
  }

  let carrito: { productId: string; qty: number; discountPct: number }[]
  let pagos: { method: PaymentMethod; amount: number }[]
  try {
    carrito = JSON.parse(String(fd.get('cart') ?? '[]'))
    pagos = JSON.parse(String(fd.get('payments') ?? '[]'))
  } catch {
    return { ok: false, error: 'El carrito no se pudo leer.' }
  }

  if (!Array.isArray(carrito) || carrito.length === 0) {
    return { ok: false, error: 'El carrito esta vacio.' }
  }
  if (!Array.isArray(pagos) || pagos.length === 0) {
    return { ok: false, error: 'Indica como se paga.' }
  }
  if (carrito.some((l) => l.discountPct > 0)) {
    const pd = exigir(ctx, 'pos', 'pos.discount')
    if (!pd.ok) return pd

    // El tope del rol (`pos.discount.max`, un numero en sus permisos) se
    // comprueba AQUI y no solo en el campo: el navegador puede mandar lo
    // que quiera. El Cajero de fabrica descuenta hasta 10%.
    const tope = (ctx.role.permissions as Record<string, unknown>)['pos.discount.max']
    const max = typeof tope === 'number' ? tope : null
    const excedido = carrito.find((l) => !discountWithinLimit(l.discountPct, max))
    if (excedido) {
      return {
        ok: false,
        error: `Tu rol puede descontar hasta ${max}%. Un descuento mayor lo aplica un supervisor.`,
      }
    }
  }

  // Un objeto y no un `let`: TypeScript no ve la asignacion dentro del
  // callback de la transaccion y daria la variable por siempre vacia.
  const cobro: { venta?: { id: string; ncf: string | null; total: number } } = {}

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [shift] = await tx<{ status: string; warehouse_id: string }[]>`
      select status, warehouse_id from public.pos_shifts
      where id = ${shiftId} and tenant_id = ${ctx.tenantId}`
    if (!shift) return 'sin-turno'
    if (shift.status !== 'open') return 'turno-cerrado'

    // Precios y tasas SIEMPRE del servidor: lo que mande el navegador es
    // una sugerencia, no un precio (§8.3).
    const ids = carrito.map((l) => l.productId)
    const productos = await tx<
      { id: string; price: string; tax_rate: string; tracks_stock: boolean }[]
    >`
      select id, price::text, tax_rate::text, tracks_stock from public.products
      where tenant_id = ${ctx.tenantId} and id = any(${ids}) and active`
    const porId = new Map(productos.map((p) => [p.id, p]))
    if (carrito.some((l) => !porId.has(l.productId))) return 'producto-invalido'

    // El precio sale de la lista que le toque a ESTE cliente en ESTA
    // cantidad; si no hay lista aplicable, del catalogo. En lote: un
    // ticket de quince articulos no puede hacer treinta consultas. Y con
    // el mismo helper que los pedidos, para que el mostrador y el pedido
    // no cobren distinto por lo mismo.
    const precios = await preciosDeVenta(
      tx,
      ctx.tenantId,
      carrito.map((l) => ({
        productId: l.productId,
        cantidad: l.qty,
        precioBase: Number(porId.get(l.productId)!.price),
      })),
      { customerId, channel: 'pos' },
    )

    const lineasCalc = carrito.map((l) => {
      const p = porId.get(l.productId)!
      return {
        productId: l.productId,
        qty: l.qty,
        unitPrice: precios.get(l.productId)?.precio ?? Number(p.price),
        discountPct: l.discountPct ?? 0,
        taxRate: Number(p.tax_rate),
      }
    })

    const totales = documentTotals(
      lineasCalc.map((l) => ({
        quantity: l.qty,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct,
        taxRate: l.taxRate,
      })),
    )

    const pagosLimpios: Payment[] = pagos
      .filter((p) => p.amount > 0)
      .map((p) => ({ method: p.method, amount: p.amount }))

    if (!paymentsBalance(pagosLimpios, totales.total)) {
      return `Los pagos suman ${pagosLimpios
        .reduce((a, p) => a + p.amount, 0)
        .toFixed(2)} y el ticket es ${totales.total.toFixed(2)}.`
    }

    // Antes de consumir numero y NCF: si esta venta ya llego, se devuelve
    // la que hay. Consumir primero seria quemar un NCF por cada reintento,
    // y un NCF gastado no vuelve.
    if (clientRef !== null) {
      const [ya] = await tx<{ id: string; number: string }[]>`
        select id, number from public.pos_sales
        where tenant_id = ${ctx.tenantId} and client_ref = ${clientRef}`
      if (ya) return `duplicada:${ya.number}`
    }

    const [n] = await tx<{ next_pos_sale_number: string }[]>`
      select public.next_pos_sale_number(${ctx.tenantId})`

    // Comprobante fiscal. Un cliente con RNC pide credito fiscal (B01) para
    // deducir el ITBIS; el que pasa por el mostrador se lleva consumo (B02).
    //
    // Si no hay secuencia cargada la venta NO se detiene: un colmado que
    // recien abre vende antes de que la DGII le autorice el primer rango, y
    // trancar la caja por eso seria peor que el ticket sin NCF. La pantalla
    // de Comprobantes ya avisa a gritos cuando falta o esta por agotarse.
    const [cli] = customerId
      ? await tx<{ tax_id: string | null }[]>`
          select tax_id from public.customers
          where id = ${customerId} and tenant_id = ${ctx.tenantId}`
      : []
    const tipoNcf = cli?.tax_id ? 'B01' : 'B02'

    // Se comprueba ANTES de llamar en vez de atrapar la excepcion: si
    // `assign_ncf` lanza, Postgres aborta la transaccion completa y todo lo
    // que viene despues —lineas, kardex, pagos— falla con "current
    // transaction is aborted". Un try/catch de JS no deshace eso.
    //
    // El `for update` de aqui es el mismo candado que toma `assign_ncf`, y
    // dura hasta el commit: entre la comprobacion y el consumo nadie mas
    // puede gastar el numero.
    const [disponible] = await tx<{ id: string }[]>`
      select id from public.ncf_sequences
      where tenant_id = ${ctx.tenantId} and ncf_type = ${tipoNcf}
        and is_active and company_id is null
        and expires_on >= public.hoy_fiscal()
        and next_number <= range_to
      for update`

    const ncf = disponible
      ? ((
          await tx<{ assign_ncf: string }[]>`
            select public.assign_ncf(${ctx.tenantId}, ${tipoNcf})`
        )[0]?.assign_ncf ?? null)
      : null

    const [venta] = await tx<{ id: string }[]>`
      insert into public.pos_sales
        (tenant_id, shift_id, number, customer_id, subtotal, discount, tax, total, cashier_id,
         ncf, ncf_type, client_ref, sold_at, synced_at)
      values (${ctx.tenantId}, ${shiftId}, ${n!.next_pos_sale_number}, ${customerId},
              ${totales.subtotal}, ${totales.discount}, ${totales.tax}, ${totales.total},
              ${ctx.userId}, ${ncf}, ${ncf ? tipoNcf : null},
              ${clientRef}, ${soldAt ?? new Date().toISOString()},
              ${clientRef !== null ? new Date().toISOString() : null})
      returning id`

    for (const [i, l] of lineasCalc.entries()) {
      await tx`
        insert into public.pos_sale_lines
          (sale_id, tenant_id, product_id, qty, unit_price, discount_pct, tax_rate, line_total)
        values (${venta!.id}, ${ctx.tenantId}, ${l.productId}, ${l.qty}, ${l.unitPrice},
                ${l.discountPct}, ${l.taxRate}, ${totales.lines[i]!.total})`

      // Un concepto sin existencias (envio, instalacion) se cobra pero no
      // sale de ningun almacen: no hay nada que descontar.
      if (!porId.get(l.productId)!.tracks_stock) continue

      // En el mostrador no hay reserva: la mercancia sale ya.
      await tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty,
           reference_type, reference_id, created_by)
        values (${ctx.tenantId}, ${shift.warehouse_id}, ${l.productId}, 'sale', ${-l.qty},
                'pos_sale', ${venta!.id}, ${ctx.userId})`
    }

    for (const p of pagosLimpios) {
      await tx`
        insert into public.pos_payments (sale_id, tenant_id, method, amount)
        values (${venta!.id}, ${ctx.tenantId}, ${p.method}, ${p.amount})`
    }

    await tx`
      select public.emit_event('pos.sale.completed',
        ${JSON.stringify({ saleId: venta!.id, total: totales.total })}::text::jsonb, 'pos')`

    cobro.venta = { id: venta!.id, ncf, total: totales.total }
    return 'ok'
  })

  // Una venta ya sincronizada NO es un error: es el reintento haciendo su
  // trabajo. Devolver ok deja que la caja borre la venta de su cola.
  if (typeof res === 'string' && res.startsWith('duplicada:')) return { ok: true }
  if (res === 'sin-turno') return { ok: false, error: 'Ese turno no existe.' }
  if (res === 'turno-cerrado') return { ok: false, error: 'El turno ya se cerro.' }
  if (res === 'producto-invalido') {
    return { ok: false, error: 'Hay un producto que ya no esta disponible.' }
  }
  if (res !== 'ok') return { ok: false, error: res }

  revalidatePath('/pos')
  revalidatePath('/inventory')
  return cobro.venta ? { ok: true, venta: cobro.venta } : { ok: true }
}

/**
 * Anula un ticket: lo marca, NO lo borra —un ticket que desaparece es un
 * agujero en la numeracion fiscal— y devuelve la mercancia al almacen.
 */
export async function anularVenta(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'pos', 'pos.void')
  if (!permiso.ok) return permiso

  const saleId = String(fd.get('saleId') ?? '')
  const motivo = String(fd.get('reason') ?? '').trim()
  // El codigo es lo que se DECLARA en el 608; el texto es lo que se
  // entiende en una auditoria dentro de seis meses. Se piden los dos
  // porque "codigo 6" a secas no le dice nada a nadie.
  const codigo = String(fd.get('voidType') ?? '').trim()
  if (!saleId) return { ok: false, error: 'Faltan datos.' }
  if (motivo.length < 4) return { ok: false, error: 'Escribe el motivo de la anulacion.' }
  if (!esMotivoDgii(codigo)) {
    return {
      ok: false,
      error: 'Elige el motivo que pide la DGII: sin el, el ticket no se puede declarar en el 608.',
    }
  }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [venta] = await tx<{ voided: boolean; shift_id: string }[]>`
      select voided, shift_id from public.pos_sales
      where id = ${saleId} and tenant_id = ${ctx.tenantId} for update`
    if (!venta) return 'no-existe'
    if (venta.voided) return 'ya-anulada'

    const [shift] = await tx<{ warehouse_id: string }[]>`
      select warehouse_id from public.pos_shifts where id = ${venta.shift_id}`

    // Solo vuelven al almacen las lineas que salieron de un almacen: un
    // envio anulado no devuelve nada al estante.
    const lineas = await tx<{ product_id: string; qty: string }[]>`
      select psl.product_id, psl.qty::text from public.pos_sale_lines psl
      join public.products p on p.id = psl.product_id
      where psl.sale_id = ${saleId} and psl.tenant_id = ${ctx.tenantId}
        and p.tracks_stock`

    for (const l of lineas) {
      await tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, reason,
           reference_type, reference_id, created_by)
        values (${ctx.tenantId}, ${shift!.warehouse_id}, ${l.product_id},
                'adjustment_in', ${Number(l.qty)}, ${'Anulacion: ' + motivo},
                'pos_sale', ${saleId}, ${ctx.userId})`
    }

    await tx`
      update public.pos_sales
      set voided = true, void_type = ${codigo}, void_reason = ${motivo}, voided_at = now()
      where id = ${saleId} and tenant_id = ${ctx.tenantId}`

    return 'ok'
  })

  if (res === 'no-existe') return { ok: false, error: 'Ese ticket no existe.' }
  if (res === 'ya-anulada') return { ok: false, error: 'Ese ticket ya estaba anulado.' }

  revalidatePath('/pos')
  revalidatePath('/inventory')
  return { ok: true }
}

// ── Envoltorios para <form action> ─────────────────────────────────────
export async function abrirTurnoForm(fd: FormData): Promise<void> {
  await anotarAviso(await abrirTurno(fd), 'abrirTurno')
}
export async function cerrarTurnoForm(fd: FormData): Promise<void> {
  await anotarAviso(await cerrarTurno(fd), 'cerrarTurno')
}
export async function anularVentaForm(fd: FormData): Promise<void> {
  await anotarAviso(await anularVenta(fd), 'anularVenta')
}
/**
 * El cobro para `useActionState`: anota el aviso Y devuelve el resultado.
 *
 * La caja necesita saber si el cobro entro para vaciar el carrito. Antes
 * lo vaciaba 100 ms despues del clic, saliera bien o mal: si la venta
 * fallaba -un producto archivado, el turno cerrado desde otra caja- el
 * cajero perdia el ticket armado y tenia que volver a escanear todo.
 */
export async function cobrarVentaAccion(
  _previo: ResultadoCobro | null,
  fd: FormData,
): Promise<ResultadoCobro> {
  const r = await cobrarVenta(fd)
  await avisarCobro(r, fd)
  return r
}

export async function cobrarVentaForm(fd: FormData): Promise<void> {
  await avisarCobro(await cobrarVenta(fd), fd)
}

async function avisarCobro(r: ResultadoCobro, fd: FormData): Promise<void> {
  if (!r.ok || !r.venta) {
    await anotarAviso(r, 'cobrarVenta')
    return
  }
  // Lo que el cajero hace despues de cobrar es entregar el ticket: el
  // aviso trae el NCF y el camino para imprimirlo.
  const { tenant, rol } = demoDe(fd)
  const qs = tenant ? `?tenant=${tenant}&rol=${encodeURIComponent(rol ?? 'Owner')}` : ''
  const total = r.venta.total.toLocaleString('es-DO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  await anotarAviso(
    r,
    'cobrarVenta',
    `Cobrado RD$ ${total} · ${r.venta.ncf ? `NCF ${r.venta.ncf}` : 'sin NCF'}.`,
    { href: `/pos/ticket/${r.venta.id}${qs}`, texto: 'Ver e imprimir ticket' },
  )
}

/**
 * Busca en el catalogo completo un codigo que la caja no tiene cargado.
 *
 * La caja trae al navegador los primeros miles de productos para que
 * agregar sea instantaneo. Una ferreteria con mas que eso escaneaba un
 * articulo que SI existe y la caja decia "ningun producto con ese
 * codigo". Cuando el escaneo no encuentra nada en lo cargado, pregunta
 * aqui antes de rendirse.
 *
 * Solo por codigo exacto (barras o SKU), no por nombre: es la respuesta
 * a un escaneo, no un buscador.
 */
export async function buscarProductoCaja(
  codigo: string,
  shiftId: string,
  demo: DemoParams,
): Promise<PosProduct | null> {
  const ctx = await actionCtx(demo)
  if (!ctx) return null
  if (!exigir(ctx, 'pos', 'pos.sell').ok) return null
  const c = codigo.trim()
  if (c === '' || c.length > 64) return null

  return asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [p] = await tx<
      {
        id: string
        sku: string
        name: string
        unit: string
        barcode: string | null
        price: string
        tax_rate: string
        tracks_stock: boolean
        disponible: string
      }[]
    >`
      select pr.id, pr.sku, pr.name, pr.unit, pr.barcode, pr.price::text,
             pr.tax_rate::text, pr.tracks_stock,
             coalesce(sl.qty_on_hand - sl.qty_reserved, 0)::text as disponible
      from public.products pr
      left join public.pos_shifts sh
        on sh.id = ${shiftId} and sh.tenant_id = ${ctx.tenantId}
      left join public.stock_levels sl
        on sl.product_id = pr.id and sl.warehouse_id = sh.warehouse_id
       and sl.tenant_id = ${ctx.tenantId}
      where pr.tenant_id = ${ctx.tenantId} and pr.active
        and (pr.barcode = ${c} or lower(pr.sku) = lower(${c}))
      order by (pr.barcode = ${c}) desc
      limit 1`
    if (!p) return null
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      barcode: p.barcode,
      price: Number(p.price),
      taxRate: Number(p.tax_rate),
      disponible: Number(p.disponible),
      tracksStock: p.tracks_stock,
    }
  })
}
