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

/**
 * El RNC de la empresa sale en CADA ticket y factura. Uno mal escrito no
 * se nota hasta que un cliente con credito fiscal lo devuelve, o el
 * contador lo ve en el 607. Se valida con la misma funcion de la base que
 * usa el alta de clientes (0133): digito verificador de la DGII, RNC de 9
 * o cedula de 11.
 */
async function rncInvalido(
  tx: Parameters<Parameters<typeof asUser>[2]>[0],
  rnc: string | null,
): Promise<boolean> {
  if (!rnc) return false
  const [r] = await tx<{ ok: boolean }[]>`select regb.documento_fiscal_valido(${rnc}) as ok`
  return !r?.ok
}

const MENSAJE_RNC =
  'Ese RNC no es valido: revisa los numeros (el ultimo digito es de control). Si es una cedula, van 11 digitos.'

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
    const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      if (await rncInvalido(tx, rnc)) return 'rnc'
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
      return 'ok'
    })
    if (res === 'rnc') return { ok: false, error: MENSAJE_RNC }
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

  // Contacto: lo que el cliente lee en el ticket y en la factura. Solo se
  // toca si el formulario lo trae, para no borrarlo desde un formulario
  // que no lo muestra.
  const trae = (k: string) => formData.has(k)
  const texto = (k: string, max: number) =>
    String(formData.get(k) ?? '')
      .trim()
      .slice(0, max) || null
  const address = texto('address', 200)
  const phone = texto('phone', 30)
  const email = texto('email', 120)
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'Ese correo no parece valido.' }
  }

  try {
    const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      if (await rncInvalido(tx, rnc)) return 'rnc'
      await tx`
        update public.companies
        set legal_name = ${legal}, tax_id = ${rnc}, updated_at = now()
        where id = ${id} and tenant_id = ${ctx.tenantId}`
      if (trae('address') || trae('phone') || trae('email')) {
        await tx`
          update public.companies
          set address = ${address}, phone = ${phone}, email = ${email}, updated_at = now()
          where id = ${id} and tenant_id = ${ctx.tenantId}`
      }
      return 'ok'
    })
    if (res === 'rnc') return { ok: false, error: MENSAJE_RNC }
  } catch (e) {
    return { ok: false, error: limpiarError(e) }
  }

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
