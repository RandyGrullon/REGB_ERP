'use server'

import { revalidatePath } from 'next/cache'
import { parseCsv, validateProducts, type ImportError } from '@regb/core'
import { asUser } from '@/lib/db'
import { actionCtx, exigir } from '@/lib/module-page'

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

export async function importarProductos(formData: FormData): Promise<void> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return
  if (!exigir(ctx, 'imports', 'imports.create').ok) return
  // Importar productos exige poder crear productos: el permiso del modulo
  // destino manda, no solo el de importar.
  if (!exigir(ctx, 'products', 'products.create').ok) return

  const file = formData.get('archivo')
  if (!(file instanceof File) || file.size === 0) return

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
      await tx`
        insert into public.products
          (tenant_id, sku, name, category, unit, price, cost, import_batch_id)
        values (${ctx.tenantId}, ${p.sku}, ${p.name}, ${p.category},
                ${p.unit}, ${p.price}, ${p.cost}, ${batch.id})
        on conflict (tenant_id, sku) do nothing`
    }
  })

  revalidatePath('/importar')
  revalidatePath('/products')
}

export async function deshacerImportacion(formData: FormData): Promise<void> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return
  if (!exigir(ctx, 'imports', 'imports.edit').ok) return
  if (!exigir(ctx, 'products', 'products.delete').ok) return

  const batchId = String(formData.get('batchId') ?? '')
  if (!batchId) return

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
}
