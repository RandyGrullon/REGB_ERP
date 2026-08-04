'use server'

import { revalidatePath } from 'next/cache'
import {
  documentTotals,
  paymentsBalance,
  reconcileCash,
  type Payment,
  type PaymentMethod,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

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
 * Cobra un ticket completo: lineas + pagos, todo en una transaccion.
 *
 * El carrito viaja como JSON en un campo del formulario. Asi la caja
 * funciona con un solo envio y no deja tickets a medias si el cajero
 * cierra la pestana en mitad del cobro.
 */
export async function cobrarVenta(fd: FormData): Promise<ActionResult> {
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
  }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [shift] = await tx<{ status: string; warehouse_id: string }[]>`
      select status, warehouse_id from public.pos_shifts
      where id = ${shiftId} and tenant_id = ${ctx.tenantId}`
    if (!shift) return 'sin-turno'
    if (shift.status !== 'open') return 'turno-cerrado'

    // Precios y tasas SIEMPRE del servidor: lo que mande el navegador es
    // una sugerencia, no un precio (§8.3).
    const ids = carrito.map((l) => l.productId)
    const productos = await tx<{ id: string; price: string; tax_rate: string }[]>`
      select id, price::text, tax_rate::text from public.products
      where tenant_id = ${ctx.tenantId} and id = any(${ids}) and active`
    const porId = new Map(productos.map((p) => [p.id, p]))
    if (carrito.some((l) => !porId.has(l.productId))) return 'producto-invalido'

    const lineasCalc = carrito.map((l) => {
      const p = porId.get(l.productId)!
      return {
        productId: l.productId,
        qty: l.qty,
        unitPrice: Number(p.price),
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
        and expires_on >= current_date
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
  return { ok: true }
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
  if (!saleId) return { ok: false, error: 'Faltan datos.' }
  if (motivo.length < 4) return { ok: false, error: 'Escribe el motivo de la anulacion.' }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [venta] = await tx<{ voided: boolean; shift_id: string }[]>`
      select voided, shift_id from public.pos_sales
      where id = ${saleId} and tenant_id = ${ctx.tenantId} for update`
    if (!venta) return 'no-existe'
    if (venta.voided) return 'ya-anulada'

    const [shift] = await tx<{ warehouse_id: string }[]>`
      select warehouse_id from public.pos_shifts where id = ${venta.shift_id}`

    const lineas = await tx<{ product_id: string; qty: string }[]>`
      select product_id, qty::text from public.pos_sale_lines
      where sale_id = ${saleId} and tenant_id = ${ctx.tenantId}`

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
      set voided = true, void_reason = ${motivo}, voided_at = now()
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
  await abrirTurno(fd)
}
export async function cerrarTurnoForm(fd: FormData): Promise<void> {
  await cerrarTurno(fd)
}
export async function anularVentaForm(fd: FormData): Promise<void> {
  await anularVenta(fd)
}
export async function cobrarVentaForm(fd: FormData): Promise<void> {
  await cobrarVenta(fd)
}
