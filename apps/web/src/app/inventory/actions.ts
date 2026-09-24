'use server'

import { revalidatePath } from 'next/cache'
import { countVariance, varianceValue } from '@regb/operations'
import { asUser, db } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de inventario (S19). El kardex (`inventory_movements`) es
 * INMUTABLE: cada accion de aqui INSERTA un movimiento, nunca actualiza
 * una fila anterior. `stock_levels` lo mantiene un trigger en la base,
 * dentro de la misma transaccion.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

function numero(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * El producto como lo escribe la gente: su codigo, su codigo de barras (lo
 * que teclea la pistola) o su nombre. Antes el formulario pedia pegar el
 * UUID "desde el catalogo", uno por uno.
 *
 * En orden, y el primero que resuelve gana:
 *  1. SKU o codigo de barras exactos.
 *  2. SKU o nombre completos, sin mayusculas.
 *  3. Parte del nombre o del SKU -solo activos-.
 * Si en un paso coinciden varios, no se adivina: se dice cuales.
 */
async function resolverProducto(
  ctx: { userId: string; tenantId: string },
  texto: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const t = texto.trim()
  const candidatos = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const exactos = await tx<{ id: string; sku: string; name: string }[]>`
      select id, sku, name from public.products
      where tenant_id = ${ctx.tenantId} and (sku = ${t} or barcode = ${t})
      order by (sku = ${t}) desc
      limit 1`
    if (exactos.length > 0) return exactos

    const iguales = await tx<{ id: string; sku: string; name: string }[]>`
      select id, sku, name from public.products
      where tenant_id = ${ctx.tenantId} and (lower(sku) = lower(${t}) or lower(name) = lower(${t}))
      order by sku
      limit 6`
    if (iguales.length > 0) return iguales

    // Los comodines de LIKE se escapan: "100%" es texto, no "todo".
    const patron = `%${t.replace(/[\\%_]/g, '\\$&')}%`
    return tx<{ id: string; sku: string; name: string }[]>`
      select id, sku, name from public.products
      where tenant_id = ${ctx.tenantId} and active
        and (name ilike ${patron} or sku ilike ${patron})
      order by sku
      limit 6`
  })

  if (candidatos.length === 1) return { ok: true, id: candidatos[0]!.id }
  if (candidatos.length === 0) {
    return {
      ok: false,
      error: `No encontramos ningun producto con "${t}". Escribe su codigo, su codigo de barras o parte del nombre.`,
    }
  }
  const cuantos = candidatos.length > 5 ? 'Mas de 5' : `Hay ${candidatos.length}`
  return {
    ok: false,
    error: `${cuantos} productos que coinciden con "${t}": ${candidatos
      .slice(0, 5)
      .map((p) => `${p.sku} (${p.name})`)
      .join(', ')}. Elige uno de la lista o escribe su codigo.`,
  }
}

/**
 * Ajuste manual de existencias (conteo suelto, merma, rotura). Positivo
 * entra, negativo sale. Por encima del `max_amount` del rol (si tiene uno
 * configurado) exige que el propio rol lo permita — la comprobacion es la
 * misma que usa cualquier otro monto en el sistema (§8, alcance de rol).
 */
export async function ajustarInventario(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'inventory', 'inventory.adjust')
  if (!permiso.ok) return permiso

  const warehouseId = String(fd.get('warehouseId') ?? '')
  const productIdCrudo = String(fd.get('productId') ?? '').trim()
  const productoTexto = String(fd.get('producto') ?? '').trim()
  const qty = numero(String(fd.get('qty') ?? ''))
  const reason = String(fd.get('reason') ?? '').trim()
  const notes = String(fd.get('notes') ?? '').trim() || null
  const unitCostRaw = String(fd.get('unitCost') ?? '').trim()
  const unitCost = unitCostRaw === '' ? null : numero(unitCostRaw)

  if (!warehouseId) return { ok: false, error: 'Elige el almacen.' }
  if (!productIdCrudo && !productoTexto) return { ok: false, error: 'Elige el producto.' }
  // El id sigue sirviendo (lo manda cualquier formulario viejo); si no es
  // un uuid, se busca como codigo o nombre en vez de reventar en la base.
  let productId = UUID.test(productIdCrudo) ? productIdCrudo : ''
  if (!productId) {
    const r = await resolverProducto(ctx, productoTexto || productIdCrudo)
    if (!r.ok) return r
    productId = r.id
  }
  if (qty === null || qty === 0)
    return { ok: false, error: 'La cantidad debe ser distinta de cero.' }
  if (reason.length < 3) return { ok: false, error: 'Indica el motivo del ajuste.' }
  if (unitCostRaw !== '' && unitCost === null) {
    return { ok: false, error: 'El costo no es un numero valido.' }
  }
  // El costo solo tiene sentido cuando entra mercancia. Declararlo en una
  // salida (merma, rotura) no cambia nada: las salidas consumen el costo
  // promedio vigente, nunca el que se escriba aqui.
  if (qty < 0 && unitCost !== null) {
    return { ok: false, error: 'El costo solo aplica cuando la cantidad es positiva.' }
  }

  // Con la conexion DUEÑA, no con `asUser`. Dos razones, y la segunda es
  // la que importa:
  //
  //  1. Desde 0109 `authenticated` no tiene SELECT sobre `avg_cost`, asi
  //     que leer `stock_levels` a pelo revienta con "permission denied
  //     for table stock_levels" y ningun ajuste se podia registrar.
  //
  //  2. Este costo NO se le enseña a nadie: alimenta `montoAjuste`, que
  //     es lo que compara el `max_amount` del rol unas lineas mas abajo.
  //     Si viniera tapado en null -por `existencias()`, para quien no
  //     tiene `inventory.cost.view`-, el monto saldria CERO y cualquier
  //     ajuste pasaria por debajo de cualquier limite. O sea que tapar el
  //     costo aqui no protegeria nada: abriria el candado.
  //
  // Al correr como dueño no hay RLS. El `tenant_id` va a mano en las dos
  // puntas del join, y es lo unico que separa una cuenta de otra aqui.
  const [datos] = await db()<{ avg_cost: string | null; catalog_cost: string | null }[]>`
    select sl.avg_cost::text as avg_cost, p.cost::text as catalog_cost
    from public.products p
    left join public.stock_levels sl
      on sl.product_id = p.id and sl.warehouse_id = ${warehouseId}
     and sl.tenant_id = ${ctx.tenantId}
    where p.id = ${productId} and p.tenant_id = ${ctx.tenantId}`
  if (!datos) return { ok: false, error: 'Ese producto no existe.' }

  const avgCost = Number(datos.avg_cost ?? 0)
  const montoAjuste = Math.abs(varianceValue(qty, avgCost))

  /**
   * Costo a registrar en una ENTRADA.
   *
   * El motor (@regb/operations#applyInbound) deja el promedio intacto
   * cuando la entrada no trae costo, y eso es correcto para una devolucion
   * o un ajuste de cantidad. Pero cargar stock inicial SI es una compra: si
   * se registra sin costo, el promedio se calcula contra un monton fantasma
   * de costo cero y el inventario queda subvaluado (100 unidades sin costo
   * + 50 a $195 daban $65 de promedio, no $195).
   *
   * Por eso, si el usuario no declara costo, se hereda el del catalogo, que
   * es el dato que ya registro al crear el producto. Si tampoco hay costo en
   * catalogo, se deja nulo y aplica la regla del motor: no tocar el promedio.
   */
  const costoEntrada =
    qty > 0 ? (unitCost ?? (datos.catalog_cost !== null ? Number(datos.catalog_cost) : null)) : null

  // El monto entra a la comprobacion de permiso: un rol con max_amount
  // configurado no puede ajustar por encima de su limite. Sin limite
  // configurado, pasa igual que cualquier otro monto sin tope.
  const permisoMonto = exigir(ctx, 'inventory', 'inventory.adjust', montoAjuste)
  if (!permisoMonto.ok) return permisoMonto

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, reason, notes, created_by)
      values
        (${ctx.tenantId}, ${warehouseId}, ${productId},
         ${qty > 0 ? 'adjustment_in' : 'adjustment_out'}, ${qty}, ${costoEntrada},
         ${reason}, ${notes}, ${ctx.userId})`
  })

  revalidatePath('/inventory')
  revalidatePath('/inventory/movements')
  return { ok: true }
}

export async function crearAlmacen(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'inventory', 'inventory.warehouses.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const code = String(fd.get('code') ?? '').trim() || null
  const branchId = String(fd.get('branchId') ?? '') || null
  if (name.length < 2) return { ok: false, error: 'El nombre necesita al menos 2 letras.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      insert into public.warehouses (tenant_id, branch_id, name, code)
      values (${ctx.tenantId}, ${branchId}, ${name}, ${code})`
  })

  revalidatePath('/inventory/warehouses')
  return { ok: true }
}

// ── Conteos ciclicos ─────────────────────────────────────────────────────

export async function iniciarConteo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'inventory', 'inventory.count')
  if (!permiso.ok) return permiso

  const warehouseId = String(fd.get('warehouseId') ?? '')
  if (!warehouseId) return { ok: false, error: 'Elige un almacen.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [count] = await tx<{ id: string }[]>`
      insert into public.stock_counts (tenant_id, warehouse_id, started_by)
      values (${ctx.tenantId}, ${warehouseId}, ${ctx.userId})
      returning id`

    // Fotografia del sistema AL ABRIR: si algo se vende mientras se cuenta,
    // la diferencia debe reflejarlo, no un numero que ya cambio.
    await tx`
      insert into public.stock_count_lines (count_id, tenant_id, product_id, system_qty)
      select ${count!.id}, ${ctx.tenantId}, sl.product_id, sl.qty_on_hand
      from public.stock_levels sl
      where sl.tenant_id = ${ctx.tenantId} and sl.warehouse_id = ${warehouseId}`
  })

  revalidatePath('/inventory/counts')
  return { ok: true }
}

export async function registrarLineaConteo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'inventory', 'inventory.count')
  if (!permiso.ok) return permiso

  const lineId = String(fd.get('lineId') ?? '')
  const counted = numero(String(fd.get('counted') ?? ''))
  if (!lineId || counted === null || counted < 0) {
    return { ok: false, error: 'La cantidad contada no es valida.' }
  }

  // Por `public.contar()` y no por un UPDATE: desde 0115 es la unica
  // puerta, y es la que comprueba que el conteo siga abierto. Antes no lo
  // comprobaba nadie, y tocar `counted_qty` despues de cerrar reescribe
  // una diferencia que ya salio al kardex, que es inmutable.
  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => {
      return tx`select public.contar(${lineId}, ${counted})`
    })
  } catch (e) {
    // El mensaje de 0115 ya viene en español y dice que hacer.
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/inventory/counts`)
  return { ok: true }
}

/**
 * Cierra el conteo: por cada linea con diferencia, inserta el movimiento
 * de ajuste correspondiente. Las lineas sin contar (`counted_qty` nulo) se
 * ignoran — no se asume que "no contado" significa "sin diferencia".
 */
export async function cerrarConteo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'inventory', 'inventory.count')
  if (!permiso.ok) return permiso

  const countId = String(fd.get('countId') ?? '')
  if (!countId) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [count] = await tx<{ warehouse_id: string; status: string }[]>`
      select warehouse_id, status from public.stock_counts
      where id = ${countId} and tenant_id = ${ctx.tenantId}`
    if (!count || count.status !== 'open') return

    const lines = await tx<
      { id: string; product_id: string; system_qty: string; counted_qty: string | null }[]
    >`
      select id, product_id, system_qty::text, counted_qty::text
      from public.stock_count_lines
      where count_id = ${countId} and tenant_id = ${ctx.tenantId}`

    for (const l of lines) {
      if (l.counted_qty === null) continue
      const variance = countVariance(Number(l.counted_qty), Number(l.system_qty))
      if (variance === 0) continue

      await tx`
        insert into public.inventory_movements
          (tenant_id, warehouse_id, product_id, movement_type, qty, reason, reference_type, reference_id, created_by)
        values
          (${ctx.tenantId}, ${count.warehouse_id}, ${l.product_id},
           'count_adjustment', ${variance},
           'Conteo ciclico', 'stock_count', ${countId}, ${ctx.userId})`
    }

    await tx`
      update public.stock_counts set status = 'closed', closed_at = now()
      where id = ${countId} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath('/inventory/counts')
  revalidatePath('/inventory')
  return { ok: true }
}

// ── Transferencias ───────────────────────────────────────────────────────

export async function crearTransferencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'inventory', 'inventory.transfer')
  if (!permiso.ok) return permiso

  const from = String(fd.get('fromWarehouseId') ?? '')
  const to = String(fd.get('toWarehouseId') ?? '')
  const productId = String(fd.get('productId') ?? '')
  const qty = numero(String(fd.get('qty') ?? ''))

  if (!from || !to || !productId) return { ok: false, error: 'Faltan datos.' }
  if (from === to) return { ok: false, error: 'El origen y el destino deben ser distintos.' }
  if (qty === null || qty <= 0) return { ok: false, error: 'La cantidad debe ser positiva.' }

  // Se crea y se completa de una vez: es la version minima de F4, sin
  // estado "en transito" (eso llega con `transfers`, #50, en F8).
  //
  // Antes no miraba la existencia: se trasladaba lo que no habia, el
  // origen quedaba en negativo, y cualquier error de la base salia como
  // excepcion sin atrapar (pantalla de error en vez de un aviso).
  let sinExistencia: { hay: number; nombre: string } | null = null
  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [p] = await tx<{ nombre: string; hay: string; lleva: boolean }[]>`
        select p.name as nombre, p.tracks_stock as lleva,
               coalesce((select sl.qty_on_hand - sl.qty_reserved from public.stock_levels sl
                          where sl.tenant_id = ${ctx.tenantId} and sl.warehouse_id = ${from}
                            and sl.product_id = p.id), 0)::text as hay
        from public.products p
        where p.tenant_id = ${ctx.tenantId} and p.id = ${productId}`
      if (!p) throw new Error('Ese producto no existe.')
      if (p.lleva && Number(p.hay) < qty) {
        sinExistencia = { hay: Number(p.hay), nombre: p.nombre }
        return
      }

      const [transfer] = await tx<{ id: string }[]>`
      insert into public.stock_transfers
        (tenant_id, from_warehouse_id, to_warehouse_id, status, created_by, completed_at)
      values (${ctx.tenantId}, ${from}, ${to}, 'completed', ${ctx.userId}, now())
      returning id`

      await tx`
      insert into public.stock_transfer_lines (transfer_id, tenant_id, product_id, qty)
      values (${transfer!.id}, ${ctx.tenantId}, ${productId}, ${qty})`

      await tx`
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, created_by)
      values (${ctx.tenantId}, ${from}, ${productId}, 'transfer_out', ${-qty}, 'stock_transfer', ${transfer!.id}, ${ctx.userId})`

      await tx`
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, movement_type, qty, reference_type, reference_id, created_by)
      values (${ctx.tenantId}, ${to}, ${productId}, 'transfer_in', ${qty}, 'stock_transfer', ${transfer!.id}, ${ctx.userId})`
    })
  } catch (e) {
    return {
      ok: false,
      error: (e instanceof Error ? e.message : 'No pudimos hacer el traslado.').replace(
        /^.*ERROR:\s*/,
        '',
      ),
    }
  }
  const falta = sinExistencia as { hay: number; nombre: string } | null
  if (falta) {
    return {
      ok: false,
      error: `En el origen hay ${falta.hay} de ${falta.nombre}: no alcanza para trasladar ${qty}.`,
    }
  }

  revalidatePath('/inventory/transfers')
  revalidatePath('/inventory')
  return { ok: true }
}

// ── Envoltorios para <form action> ─────────────────────────────────────
export async function ajustarInventarioForm(fd: FormData): Promise<void> {
  await anotarAviso(await ajustarInventario(fd), 'ajustarInventario')
}
export async function crearAlmacenForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearAlmacen(fd), 'crearAlmacen')
}
export async function iniciarConteoForm(fd: FormData): Promise<void> {
  await anotarAviso(await iniciarConteo(fd), 'iniciarConteo')
}
export async function registrarLineaConteoForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarLineaConteo(fd), 'registrarLineaConteo')
}
export async function cerrarConteoForm(fd: FormData): Promise<void> {
  await anotarAviso(await cerrarConteo(fd), 'cerrarConteo')
}
export async function crearTransferenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearTransferencia(fd), 'crearTransferencia')
}
