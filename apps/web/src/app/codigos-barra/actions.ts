'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { generarEan13 } from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de codigos de barra (modulo 52, F8/S48).
 *
 * `generarCodigosFaltantes()` asigna EAN-13 reales -prefijo "20", el
 * rango que GS1 reserva para uso interno/circulacion restringida, no
 * uno de los prefijos de pais reales- con el digito verificador
 * calculado por `generarEan13()`, nunca un numero inventado a mano.
 *
 * `registrarEscaneo()` es la unica escritura del flujo de escaneo:
 * busca el producto por codigo, registra el escaneo, y REDIRIGE a la
 * misma pantalla con `?codigo=` en la URL -la pagina, ya en un GET,
 * hace la consulta de lectura para mostrar el resultado-. Mismo
 * patron que un lector fisico: escribe (o la camara detecta) el
 * codigo, Enter, y la pantalla muestra que producto es.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

/** Genera un EAN-13 para cada producto activo que todavia no tiene codigo de barras. */
export async function generarCodigosFaltantes(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'barcode', 'barcode.generate')
  if (!permiso.ok) return permiso

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [ultimo] = await tx<{ n: string }[]>`
        select count(*)::text as n from public.products
        where tenant_id = ${ctx.tenantId} and barcode like '20%'`
      let contador = Number(ultimo!.n)

      const sinCodigo = await tx<{ id: string }[]>`
        select id from public.products
        where tenant_id = ${ctx.tenantId} and active and barcode is null
        order by created_at`

      for (const p of sinCodigo) {
        contador += 1
        const base12 = `20${String(contador).padStart(10, '0')}`
        const codigo = generarEan13(base12)
        await tx`update public.products set barcode = ${codigo} where id = ${p.id} and tenant_id = ${ctx.tenantId}`
        await tx`
          select public.emit_event('barcode.code.generated',
            ${JSON.stringify({ productId: p.id, codigo })}::text::jsonb, 'barcode')`
      }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/codigos-barra')
  return { ok: true }
}

/** Busca un producto por su codigo, registra el escaneo, y redirige a mostrar el resultado. */
export async function registrarEscaneoForm(fd: FormData): Promise<void> {
  const ctx = await actionCtx(demoDe(fd))
  const codigo = String(fd.get('codigo') ?? '').trim()
  const qs = ctx?.demoQs ?? ''

  if (!ctx || !codigo || !exigir(ctx, 'barcode', 'barcode.scan').ok) {
    redirect(`/codigos-barra/escaneo${qs}`)
  }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [producto] = await tx<{ id: string }[]>`
      select id from public.products where tenant_id = ${ctx.tenantId} and barcode = ${codigo}`
    if (producto) {
      await tx`
        insert into public.barcode_scans (tenant_id, product_id, scanned_code, scanned_by)
        values (${ctx.tenantId}, ${producto.id}, ${codigo}, ${ctx.userId})`
      await tx`
        select public.emit_event('barcode.product.scanned',
          ${JSON.stringify({ productId: producto.id, codigo })}::text::jsonb, 'barcode')`
    }
  })

  const separador = qs ? '&' : '?'
  redirect(`/codigos-barra/escaneo${qs}${separador}codigo=${encodeURIComponent(codigo)}`)
}

// ── Version para <form action> ──────────────────────────────────────────
export async function generarCodigosFaltantesForm(fd: FormData): Promise<void> {
  await generarCodigosFaltantes(fd)
}
