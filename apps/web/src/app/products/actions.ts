'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones del catalogo (S18). Doble candado de siempre: permiso en
 * servidor + escritura bajo RLS.
 *
 * `products.price.edit` se comprueba APARTE de `products.edit`: el rol
 * Vendedor edita la ficha pero no toca el precio, y el Almacenista ni
 * siquiera lo ve (§8, alcance de rol).
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

/** Precio y costo llegan como texto del formulario; vacio no es cero. */
function numeroOpcional(raw: string): number | null | undefined {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export async function crearProducto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'products', 'products.create')
  if (!permiso.ok) return permiso

  const sku = String(fd.get('sku') ?? '').trim()
  const name = String(fd.get('name') ?? '').trim()
  const unit = String(fd.get('unit') ?? 'unidad').trim() || 'unidad'
  const barcode = String(fd.get('barcode') ?? '').trim() || null
  const categoryId = String(fd.get('categoryId') ?? '') || null
  const price = numeroOpcional(String(fd.get('price') ?? ''))
  const cost = numeroOpcional(String(fd.get('cost') ?? ''))
  const reorder = numeroOpcional(String(fd.get('reorderPoint') ?? ''))
  const exento = fd.get('exento') === 'on'
  // Un concepto vendible sin existencias: envio, instalacion, mano de obra.
  const sinStock = fd.get('sinStock') === 'on'

  if (sku.length < 1) return { ok: false, error: 'El codigo es obligatorio.' }
  if (name.length < 2) return { ok: false, error: 'El nombre necesita al menos 2 letras.' }
  if (price === undefined) return { ok: false, error: 'El precio no es un numero valido.' }
  if (cost === undefined) return { ok: false, error: 'El costo no es un numero valido.' }
  if (reorder === undefined) return { ok: false, error: 'El punto de reorden no es valido.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      // El nombre de categoria se desnormaliza para listados e importacion.
      const [cat] = categoryId
        ? await tx<{ name: string }[]>`
            select name from public.product_categories
            where id = ${categoryId} and tenant_id = ${ctx.tenantId}`
        : []

      await tx`
        insert into public.products
          (tenant_id, sku, name, unit, price, cost, barcode, category_id,
           category, reorder_point, tax_rate, tracks_stock)
        values
          (${ctx.tenantId}, ${sku}, ${name}, ${unit}, ${price ?? 0}, ${cost},
           ${barcode}, ${categoryId}, ${cat?.name ?? null},
           ${sinStock ? null : reorder}, ${exento ? 0 : 0.18}, ${!sinStock})`
    })
  } catch (e) {
    const msg = String(e)
    if (msg.includes('products_tenant_id_sku_key')) {
      return { ok: false, error: `Ya existe un producto con el codigo "${sku}".` }
    }
    if (msg.includes('products_barcode_idx')) {
      return { ok: false, error: `Ese codigo de barras ya lo usa otro producto.` }
    }
    throw e
  }

  revalidatePath('/products')
  return { ok: true }
}

export async function editarProducto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'products', 'products.edit')
  if (!permiso.ok) return permiso

  const id = String(fd.get('id') ?? '')
  const name = String(fd.get('name') ?? '').trim()
  const unit = String(fd.get('unit') ?? 'unidad').trim() || 'unidad'
  const barcode = String(fd.get('barcode') ?? '').trim() || null
  const categoryId = String(fd.get('categoryId') ?? '') || null
  const reorder = numeroOpcional(String(fd.get('reorderPoint') ?? ''))
  const exento = fd.get('exento') === 'on'

  if (!id || name.length < 2) return { ok: false, error: 'Datos incompletos.' }
  if (reorder === undefined) return { ok: false, error: 'El punto de reorden no es valido.' }

  // El precio solo se toca con su propio permiso. Si el rol no lo tiene, la
  // columna se deja como esta en vez de rechazar la edicion entera.
  const puedePrecio = exigir(ctx, 'products', 'products.price.edit').ok
  let precios: { price: number; cost: number | null } | null = null
  if (puedePrecio) {
    const price = numeroOpcional(String(fd.get('price') ?? ''))
    const cost = numeroOpcional(String(fd.get('cost') ?? ''))
    if (price === undefined || cost === undefined) {
      return { ok: false, error: 'El precio o el costo no son numeros validos.' }
    }
    precios = { price: price ?? 0, cost }
  }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [cat] = categoryId
      ? await tx<{ name: string }[]>`
          select name from public.product_categories
          where id = ${categoryId} and tenant_id = ${ctx.tenantId}`
      : []

    await tx`
      update public.products set
        name          = ${name},
        unit          = ${unit},
        barcode       = ${barcode},
        category_id   = ${categoryId},
        category      = ${cat?.name ?? null},
        reorder_point = ${reorder},
        tax_rate      = ${exento ? 0 : 0.18},
        updated_at    = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`

    // El precio va en su PROPIA sentencia, solo si el rol puede tocarlo.
    // Meterlo arriba con un ternario seria un error silencioso: postgres.js
    // convierte `undefined` en NULL, asi que un Vendedor editando la ficha
    // dejaria el precio del producto en cero.
    if (precios) {
      await tx`
        update public.products
        set price = ${precios.price}, cost = ${precios.cost}, updated_at = now()
        where id = ${id} and tenant_id = ${ctx.tenantId}`
    }
  })

  revalidatePath('/products')
  return { ok: true }
}

/** Nunca se borra un producto: se archiva. Puede estar en ventas historicas. */
export async function alternarProducto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'products', 'products.edit')
  if (!permiso.ok) return permiso

  const id = String(fd.get('id') ?? '')
  if (!id) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.products set active = not active, updated_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath('/products')
  return { ok: true }
}

export async function crearCategoria(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  const permiso = exigir(ctx, 'products', 'products.categories.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const parentId = String(fd.get('parentId') ?? '') || null
  if (name.length < 2) return { ok: false, error: 'El nombre necesita al menos 2 letras.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      insert into public.product_categories (tenant_id, parent_id, name)
      values (${ctx.tenantId}, ${parentId}, ${name})
      on conflict (tenant_id, parent_id, name) do nothing`
  })

  revalidatePath('/products/categories')
  revalidatePath('/products')
  return { ok: true }
}

// ── Envoltorios para <form action> ─────────────────────────────────────
export async function crearProductoForm(fd: FormData): Promise<void> {
  await crearProducto(fd)
}
export async function editarProductoForm(fd: FormData): Promise<void> {
  await editarProducto(fd)
}
export async function alternarProductoForm(fd: FormData): Promise<void> {
  await alternarProducto(fd)
}
export async function crearCategoriaForm(fd: FormData): Promise<void> {
  await crearCategoria(fd)
}
