'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Perfil fiscal del proveedor (modulo 24).
 *
 * Que es cada proveedor a ojos de la DGII -persona fisica o juridica- y
 * que regla de retencion le toca. Vive en supplier_tax_profiles y no en
 * columnas de public.suppliers: esa tabla es de `suppliers`, y colgarle
 * columnas de este modulo ataria dos modulos que el marketplace vende por
 * separado.
 *
 * Lo que esta pantalla NO hace es escribir la retencion en la factura.
 * supplier_invoices.retention_amount, isr_retained e isr_retention_type
 * son de `ap` y se siguen capturando en /pagar. Aqui sale el numero para
 * que alguien lo mire antes de aceptarlo.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const limpioError = (e: unknown): string =>
  (e instanceof Error ? e.message : 'Error inesperado').replace(/^.*ERROR:\s*/, '')

/** Asigna -o corrige- el perfil fiscal de un proveedor. */
export async function asignarPerfil(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'taxes', 'taxes.profile.assign')
  if (!permiso.ok) return permiso

  const supplierId = String(fd.get('supplierId') ?? '')
  const partyType = String(fd.get('partyType') ?? '').trim()
  const isExempt = fd.get('isExempt') !== null
  const notes = String(fd.get('notes') ?? '').trim()

  if (!supplierId) return { ok: false, error: 'Elige el proveedor.' }
  if (partyType !== 'fisica' && partyType !== 'juridica') {
    return { ok: false, error: 'Di si es persona fisica o juridica.' }
  }

  // Exento y con regla asignada es una contradiccion que la tabla rechaza.
  // Se limpian aqui -en vez de dejar que reviente- porque el usuario que
  // marca "exento" ya dijo lo que queria: la regla que quedo en el
  // formulario es ruido, no una segunda intencion.
  const itbisRuleId = isExempt ? null : String(fd.get('itbisRuleId') ?? '') || null
  const isrRuleId = isExempt ? null : String(fd.get('isrRuleId') ?? '') || null

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        insert into public.supplier_tax_profiles
          (tenant_id, supplier_id, party_type, itbis_rule_id, isr_rule_id, is_exempt, notes)
        values (${ctx.tenantId}, ${supplierId}, ${partyType}, ${itbisRuleId}, ${isrRuleId},
                ${isExempt}, ${notes || null})
        on conflict (tenant_id, supplier_id) do update
          set party_type    = excluded.party_type,
              itbis_rule_id = excluded.itbis_rule_id,
              isr_rule_id   = excluded.isr_rule_id,
              is_exempt     = excluded.is_exempt,
              notes         = excluded.notes`,
    )
  } catch (e) {
    return { ok: false, error: limpioError(e) }
  }

  revalidatePath('/impuestos/retenciones')
  return { ok: true }
}

// ── Version para <form action> ──────────────────────────────────────────
export async function asignarPerfilForm(fd: FormData): Promise<void> {
  await anotarAviso(await asignarPerfil(fd), 'asignarPerfil')
}
