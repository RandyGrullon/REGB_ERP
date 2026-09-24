'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/** Acciones de proveedores (modulo 42, F8/S43). */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const ESTADOS = ['pending', 'qualified', 'disqualified']
const TIPOS_DOCUMENTO = ['rnc_certificate', 'insurance', 'tax_compliance', 'contract', 'other']
const TIPOS_CUENTA = ['checking', 'savings']

/** Cambia el estado de homologacion de un proveedor. */
export async function cambiarHomologacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'suppliers', 'suppliers.manage')
  if (!permiso.ok) return permiso

  const supplierId = String(fd.get('supplierId') ?? '')
  const status = String(fd.get('status') ?? '')
  if (!supplierId) return { ok: false, error: 'Falta el proveedor.' }
  if (!ESTADOS.includes(status)) return { ok: false, error: 'Estado invalido.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        update public.suppliers set qualification_status = ${status}, updated_at = now()
        where id = ${supplierId} and tenant_id = ${ctx.tenantId}`

      await tx`
        select public.emit_event('suppliers.qualification.changed',
          ${JSON.stringify({ supplierId, status })}::text::jsonb, 'suppliers')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/proveedores')
  return { ok: true }
}

/** Registra un documento de un proveedor -su vigencia se calcula siempre contra hoy-. */
export async function crearDocumento(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'suppliers', 'suppliers.manage-documents')
  if (!permiso.ok) return permiso

  const supplierId = String(fd.get('supplierId') ?? '')
  const docType = String(fd.get('docType') ?? '')
  const docNumber = String(fd.get('docNumber') ?? '').trim() || null
  const issuedAt = String(fd.get('issuedAt') ?? '') || null
  const expiresAt = String(fd.get('expiresAt') ?? '') || null

  if (!supplierId) return { ok: false, error: 'Elige el proveedor.' }
  if (!TIPOS_DOCUMENTO.includes(docType))
    return { ok: false, error: 'Elige un tipo de documento valido.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.supplier_documents (tenant_id, supplier_id, doc_type, doc_number, issued_at, expires_at)
      values (${ctx.tenantId}, ${supplierId}, ${docType}, ${docNumber}, ${issuedAt}, ${expiresAt})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/proveedores')
  return { ok: true }
}

/** Registra una cuenta bancaria de un proveedor. */
export async function crearCuentaBancaria(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'suppliers', 'suppliers.manage')
  if (!permiso.ok) return permiso

  const supplierId = String(fd.get('supplierId') ?? '')
  const bankName = String(fd.get('bankName') ?? '').trim()
  const accountNumber = String(fd.get('accountNumber') ?? '').trim()
  const accountType = String(fd.get('accountType') ?? '')
  const currency = String(fd.get('currency') ?? '').trim() || 'DOP'

  if (!supplierId) return { ok: false, error: 'Elige el proveedor.' }
  if (!bankName) return { ok: false, error: 'Escribe el nombre del banco.' }
  if (!accountNumber) return { ok: false, error: 'Escribe el numero de cuenta.' }
  if (!TIPOS_CUENTA.includes(accountType))
    return { ok: false, error: 'Elige un tipo de cuenta valido.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
      insert into public.supplier_bank_accounts (tenant_id, supplier_id, bank_name, account_number, account_type, currency)
      values (${ctx.tenantId}, ${supplierId}, ${bankName}, ${accountNumber}, ${accountType}, ${currency})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/proveedores')
  return { ok: true }
}

/** Registra una evaluacion -queda fija desde el momento en que se registra-. */
export async function registrarEvaluacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'suppliers', 'suppliers.evaluate')
  if (!permiso.ok) return permiso

  const supplierId = String(fd.get('supplierId') ?? '')
  const score = Number.parseInt(String(fd.get('score') ?? ''), 10)
  const comments = String(fd.get('comments') ?? '').trim() || null
  const evaluatedBy = String(fd.get('evaluatedBy') ?? '').trim() || null

  if (!supplierId) return { ok: false, error: 'Elige el proveedor.' }
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return { ok: false, error: 'La calificacion debe ser un numero de 1 a 5.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        insert into public.supplier_evaluations (tenant_id, supplier_id, score, comments, evaluated_by)
        values (${ctx.tenantId}, ${supplierId}, ${score}, ${comments}, ${evaluatedBy})`

      await tx`
        select public.emit_event('suppliers.evaluation.recorded',
          ${JSON.stringify({ supplierId, score })}::text::jsonb, 'suppliers')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/proveedores')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function cambiarHomologacionForm(fd: FormData): Promise<void> {
  await anotarAviso(await cambiarHomologacion(fd), 'cambiarHomologacion')
}
export async function crearDocumentoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearDocumento(fd), 'crearDocumento')
}
export async function crearCuentaBancariaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearCuentaBancaria(fd), 'crearCuentaBancaria')
}
export async function registrarEvaluacionForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarEvaluacion(fd), 'registrarEvaluacion')
}
