'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir } from '@/lib/module-page'

/** Acciones del modulo `files` (S11). Nada se borra de verdad: papelera. */

const MAX_BYTES = 512 * 1024

function demoDe(formData: FormData) {
  return {
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  }
}

export async function subirArchivo(formData: FormData): Promise<void> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return
  if (!exigir(ctx, 'files', 'files.create').ok) return

  const file = formData.get('archivo')
  if (!(file instanceof File) || file.size === 0) return
  if (file.size > MAX_BYTES) return // el input avisa el limite; el server lo impone

  const buffer = Buffer.from(await file.arrayBuffer())

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      insert into public.files (tenant_id, name, mime, size_bytes, content, uploaded_by)
      values (${ctx.tenantId}, ${file.name}, ${file.type || 'application/octet-stream'},
              ${file.size}, ${buffer}, ${ctx.userId})`
  })

  revalidatePath('/archivos')
}

export async function enviarAPapelera(formData: FormData): Promise<void> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return
  if (!exigir(ctx, 'files', 'files.delete').ok) return

  const id = String(formData.get('id') ?? '')
  if (!id) return

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.files set deleted_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId} and deleted_at is null`
  })

  revalidatePath('/archivos')
}

export async function restaurarArchivo(formData: FormData): Promise<void> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return
  if (!exigir(ctx, 'files', 'files.edit').ok) return

  const id = String(formData.get('id') ?? '')
  if (!id) return

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.files set deleted_at = null
      where id = ${id} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath('/archivos')
}
