'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult } from '@/lib/module-page'

/** Acciones del modulo `orgs` (multi-empresa, S9). */

function demoDe(formData: FormData) {
  return {
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  }
}

const limpiarError = (e: unknown): string =>
  (e instanceof Error ? e.message : 'Error inesperado').replace(/^.*ERROR:\s*/, '')

export async function crearEmpresa(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'orgs', 'orgs.create')
  if (!permiso.ok) return permiso

  const legal = String(formData.get('legal') ?? '').trim()
  const rnc = String(formData.get('rnc') ?? '').trim() || null
  const currency = String(formData.get('currency') ?? 'DOP')
  if (legal.length < 3) return { ok: false, error: 'La razon social necesita al menos 3 letras.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [empresa] = await tx<{ id: string }[]>`
        insert into public.companies (tenant_id, legal_name, tax_id, currency)
        values (${ctx.tenantId}, ${legal}, ${rnc}, ${currency})
        returning id`

      // Misma transaccion: si el evento no se puede escribir, la empresa
      // tampoco queda. Sin razon social ni RNC: el payload viaja a
      // webhooks de terceros, y quien los necesite los lee por el id.
      await tx`
        select public.emit_event('orgs.company.created',
          ${JSON.stringify({ companyId: empresa!.id, currency })}::text::jsonb, 'orgs')`
    })
  } catch (e) {
    return { ok: false, error: limpiarError(e) }
  }

  revalidatePath('/empresas')
  return { ok: true }
}

export async function editarEmpresa(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'orgs', 'orgs.edit')
  if (!permiso.ok) return permiso

  const id = String(formData.get('id') ?? '')
  const legal = String(formData.get('legal') ?? '').trim()
  const rnc = String(formData.get('rnc') ?? '').trim() || null
  if (!id || legal.length < 3) return { ok: false, error: 'Datos incompletos.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.companies
      set legal_name = ${legal}, tax_id = ${rnc}, updated_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath('/empresas')
  return { ok: true }
}

export async function marcarPrincipal(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'orgs', 'orgs.edit')
  if (!permiso.ok) return permiso

  const id = String(formData.get('id') ?? '')
  if (!id) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    await tx`update public.companies set is_default = false
      where tenant_id = ${ctx.tenantId}`
    await tx`update public.companies set is_default = true, updated_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath('/empresas')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearEmpresaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearEmpresa(fd), 'crearEmpresa')
}
export async function editarEmpresaForm(fd: FormData): Promise<void> {
  await anotarAviso(await editarEmpresa(fd), 'editarEmpresa')
}
export async function marcarPrincipalForm(fd: FormData): Promise<void> {
  await anotarAviso(await marcarPrincipal(fd), 'marcarPrincipal')
}
