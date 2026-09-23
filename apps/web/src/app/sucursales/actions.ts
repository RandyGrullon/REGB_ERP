'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult } from '@/lib/module-page'

/** Acciones del modulo `branches` (S9). */

function demoDe(formData: FormData) {
  return {
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  }
}

export async function crearSucursal(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'branches', 'branches.create')
  if (!permiso.ok) return permiso

  const nombre = String(formData.get('nombre') ?? '').trim()
  const codigo = String(formData.get('codigo') ?? '').trim() || null
  const companyId = String(formData.get('companyId') ?? '')
  const direccion = String(formData.get('direccion') ?? '').trim() || null
  if (nombre.length < 2) return { ok: false, error: 'El nombre necesita al menos 2 letras.' }
  if (!companyId) return { ok: false, error: 'Elige la empresa.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [sucursal] = await tx<{ id: string }[]>`
        insert into public.branches (tenant_id, company_id, name, code, address)
        values (${ctx.tenantId}, ${companyId}, ${nombre}, ${codigo}, ${direccion})
        returning id`

      // Misma transaccion que la sucursal. Sin nombre ni direccion: el
      // evento dice QUE paso; la ficha se lee por el id, bajo RLS.
      await tx`
        select public.emit_event('branches.branch.created',
          ${JSON.stringify({ branchId: sucursal!.id, companyId })}::text::jsonb, 'branches')`
    })
  } catch (e) {
    return {
      ok: false,
      error: (e instanceof Error ? e.message : 'Error inesperado').replace(/^.*ERROR:\s*/, ''),
    }
  }

  revalidatePath('/sucursales')
  return { ok: true }
}

export async function alternarSucursal(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'branches', 'branches.edit')
  if (!permiso.ok) return permiso

  const id = String(formData.get('id') ?? '')
  if (!id) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.branches
      set is_active = not is_active, updated_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath('/sucursales')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearSucursalForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearSucursal(fd), 'crearSucursal')
}
export async function alternarSucursalForm(fd: FormData): Promise<void> {
  await anotarAviso(await alternarSucursal(fd), 'alternarSucursal')
}
