'use server'

import { revalidatePath } from 'next/cache'
import { parseCsv, validateProducts, type ImportError } from '@regb/core'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult } from '@/lib/module-page'
import { anotarAviso } from '@/lib/aviso'

/**
 * Importacion de productos desde CSV (S12) con DESHACER.
 *
 * Cada lote deja su id en los productos que creo, asi que deshacer es
 * exacto: borra lo que ESE lote inserto y no toca nada mas. El lote queda
 * marcado como deshecho — la bitacora del import tampoco se borra.
 */

export interface ImportOutcome {
  ok: boolean
  message: string
  inserted?: number
  errors?: ImportError[]
}

function demoDe(formData: FormData) {
  return {
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  }
}

/**
 * Importa el CSV y devuelve CUANTAS filas entraron y cuantas se
 * rechazaron. Antes devolvia `void` y un archivo entero mal formado se
 * veia igual que uno perfecto: no pasaba nada en pantalla.
 */
async function importar(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'imports', 'imports.create')
  if (!permiso.ok) return permiso
  // Importar productos exige poder crear productos: el permiso del modulo
  // destino manda, no solo el de importar.
  const pProd = exigir(ctx, 'products', 'products.create')
  if (!pProd.ok) return pProd

  const file = formData.get('archivo')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Elige un archivo CSV primero.' }
  }

  const text = await file.text()
  const rows = parseCsv(text)
  const headers = rows[0] ?? []
  const { valid, errors } = validateProducts(rows.slice(1), headers)

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    // El cast va por text a proposito. Con ::jsonb directo, Postgres
    // infiere que el parametro ES jsonb, postgres.js le aplica
    // JSON.stringify otra vez y la columna acaba guardando un jsonb de
    // tipo string: al leerlo, errors.map explota. Fijado en
    // supabase/tests/jsonb-params.test.ts.
    const [batch] = await tx<{ id: string }[]>`
      insert into public.import_batches
        (tenant_id, target, file_name, total_rows, inserted, rejected, errors, created_by)
      values (${ctx.tenantId}, 'products', ${file.name}, ${rows.length - 1},
              ${valid.length}, ${errors.length},
              ${JSON.stringify(errors)}::text::jsonb, ${ctx.userId})
      returning id`
    if (!batch) return

    for (const p of valid) {
      // `on conflict do nothing`: si el sku ya existe, no se pisa un
      // producto vivo con datos de un archivo. Se reporta y sigue.
      // La tasa se pide explicita: el default de columna es un 0.18 fijo y
      // el CSV no trae tasa, asi que el catalogo quedaba lleno al 18% aunque
      // el cliente tuviera otra por defecto en Impuestos (0118).
      await tx`
        insert into public.products
          (tenant_id, sku, name, category, unit, price, cost, tax_rate, import_batch_id)
        values (${ctx.tenantId}, ${p.sku}, ${p.name}, ${p.category},
                ${p.unit}, ${p.price}, ${p.cost}, public.tasa_itbis_por_defecto(),
                ${batch.id})
        on conflict (tenant_id, sku) do nothing`
    }
  })

  revalidatePath('/importar')
  revalidatePath('/products')

  // Un archivo donde NADA entro no es un exito aunque el proceso corriera:
  // se dice como error para que nadie cierre la pantalla creyendo que
  // subio su catalogo.
  if (valid.length === 0) {
    return {
      ok: false,
      error: `No entro ninguna fila: ${errors.length} rechazada(s). Revisa el detalle abajo.`,
    }
  }
  return { ok: true }
}

async function deshacer(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const pImp = exigir(ctx, 'imports', 'imports.edit')
  if (!pImp.ok) return pImp
  const pDel = exigir(ctx, 'products', 'products.delete')
  if (!pDel.ok) return pDel

  const batchId = String(formData.get('batchId') ?? '')
  if (!batchId) return { ok: false, error: 'Falta la importacion.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    await tx`
      delete from public.products
      where tenant_id = ${ctx.tenantId} and import_batch_id = ${batchId}`
    await tx`
      update public.import_batches set undone_at = now()
      where id = ${batchId} and tenant_id = ${ctx.tenantId} and undone_at is null`
  })

  revalidatePath('/importar')
  revalidatePath('/products')
  return { ok: true }
}

// ── Envoltorios para <form action> ──────────────────────────────────────
export async function importarProductos(fd: FormData): Promise<void> {
  await anotarAviso(await importar(fd), 'importarProductos', 'Listo, importamos el archivo.')
}
export async function deshacerImportacion(fd: FormData): Promise<void> {
  await anotarAviso(await deshacer(fd), 'deshacerImportacion', 'Listo, deshicimos esa importacion.')
}
