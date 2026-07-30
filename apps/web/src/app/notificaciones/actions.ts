'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir } from '@/lib/module-page'

/** Acciones del modulo `notifications` (S10). */

function demoDe(formData: FormData) {
  return {
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  }
}

export async function marcarLeida(formData: FormData): Promise<void> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return
  if (!exigir(ctx, 'notifications', 'notifications.edit').ok) return

  const id = String(formData.get('id') ?? '')
  if (!id) return

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.notifications set read_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}
        and (user_id = ${ctx.userId} or user_id is null)
        and read_at is null`
  })

  revalidatePath('/notificaciones')
}

export async function marcarTodasLeidas(formData: FormData): Promise<void> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return
  if (!exigir(ctx, 'notifications', 'notifications.edit').ok) return

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.notifications set read_at = now()
      where tenant_id = ${ctx.tenantId}
        and (user_id = ${ctx.userId} or user_id is null)
        and read_at is null`
  })

  revalidatePath('/notificaciones')
}
