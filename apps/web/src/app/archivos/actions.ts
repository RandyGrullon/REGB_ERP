'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult } from '@/lib/module-page'
import { anotarAviso } from '@/lib/aviso'

/**
 * Acciones del modulo `files` (S11). Nada se borra de verdad: papelera.
 *
 * Estas acciones devolvian `void` y hacian `return` en seco ante
 * cualquier problema: subir un archivo de mas de 512 KB no producia
 * NADA en pantalla. Ahora cada salida dice por que -el limite lo sigue
 * imponiendo el servidor, pero al menos se entera quien lo intento-.
 */

const MAX_BYTES = 512 * 1024

function demoDe(formData: FormData) {
  return {
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  }
}

async function subir(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'files', 'files.create')
  if (!permiso.ok) return permiso

  const file = formData.get('archivo')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Elige un archivo primero.' }
  }
  // El input avisa el limite; el servidor lo impone. Se dice el tamaño
  // real para que no haya que adivinar cuanto sobra.
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: `Ese archivo pesa ${(file.size / 1024).toFixed(0)} KB y el limite es ${MAX_BYTES / 1024} KB.`,
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      insert into public.files (tenant_id, name, mime, size_bytes, content, uploaded_by)
      values (${ctx.tenantId}, ${file.name}, ${file.type || 'application/octet-stream'},
              ${file.size}, ${buffer}, ${ctx.userId})`
  })

  revalidatePath('/archivos')
  return { ok: true }
}

async function aPapelera(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'files', 'files.delete')
  if (!permiso.ok) return permiso

  const id = String(formData.get('id') ?? '')
  if (!id) return { ok: false, error: 'Falta el archivo.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.files set deleted_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId} and deleted_at is null`
  })

  revalidatePath('/archivos')
  return { ok: true }
}

async function restaurar(formData: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(formData))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'files', 'files.edit')
  if (!permiso.ok) return permiso

  const id = String(formData.get('id') ?? '')
  if (!id) return { ok: false, error: 'Falta el archivo.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.files set deleted_at = null
      where id = ${id} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath('/archivos')
  return { ok: true }
}

// ── Envoltorios para <form action> ──────────────────────────────────────
export async function subirArchivo(fd: FormData): Promise<void> {
  await anotarAviso(await subir(fd), 'subirArchivo', 'Listo, subimos el archivo.')
}
export async function enviarAPapelera(fd: FormData): Promise<void> {
  await anotarAviso(await aPapelera(fd), 'enviarAPapelera', 'Listo, lo mandamos a la papelera.')
}
export async function restaurarArchivo(fd: FormData): Promise<void> {
  await anotarAviso(await restaurar(fd), 'restaurarArchivo', 'Listo, lo restauramos.')
}
