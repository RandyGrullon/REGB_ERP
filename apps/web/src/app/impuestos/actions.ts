'use server'

import { revalidatePath } from 'next/cache'
import { TASAS_ITBIS_RD, porcentajeAFraccion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Configuracion fiscal: tasas de ITBIS y reglas de retencion (modulo 24).
 *
 * Doble candado en todas: el permiso se exige EN SERVIDOR antes de tocar
 * nada, y la escritura pasa por asUser -o sea, bajo RLS-. Que la UI
 * esconda el formulario no cuenta como permiso (§8.3).
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

// El campo es un PORCENTAJE y se divide siempre entre 100, sin adivinar:
// porcentajeAFraccion() en @regb/operations, con sus pruebas. La version
// anterior aceptaba "18" y "0.18" como lo mismo (`n > 1 ? n / 100 : n`) y
// esa comodidad guardaba 100% cuando alguien escribia 1 queriendo 1%.
// Guardar la fraccion sigue igual: la tabla usa la convencion de la 0021.

const limpioError = (e: unknown): string =>
  (e instanceof Error ? e.message : 'Error inesperado').replace(/^.*ERROR:\s*/, '')

/** Da de alta una tasa (ITBIS general, reducida, exento, ISC, propina). */
export async function crearTasa(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'taxes', 'taxes.rate.manage')
  if (!permiso.ok) return permiso

  const code = String(fd.get('code') ?? '').trim()
  const name = String(fd.get('name') ?? '').trim()
  const kind = String(fd.get('kind') ?? 'itbis').trim()
  const rate = porcentajeAFraccion(String(fd.get('rate') ?? ''))
  const isDefault = fd.get('isDefault') !== null

  if (code.length < 1) return { ok: false, error: 'Escribe el codigo de la tasa.' }
  if (name.length < 2) return { ok: false, error: 'Escribe el nombre de la tasa.' }
  if (rate === null) {
    return { ok: false, error: 'La tasa va en porcentaje, entre 0 y 100: escribe 18 para el 18%.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      // Una sola tasa por defecto y por tipo: si esta llega marcada, la
      // anterior deja de serlo. Sin esto el indice unico parcial rechaza
      // el insert y el usuario ve un "duplicate key" que no explica nada.
      if (isDefault) {
        await tx`
          update public.tax_rates set is_default = false
          where tenant_id = ${ctx.tenantId} and kind = ${kind} and is_default`
      }
      await tx`
        insert into public.tax_rates (tenant_id, code, name, kind, rate, is_default)
        values (${ctx.tenantId}, ${code}, ${name}, ${kind}, ${rate}, ${isDefault})`
    })
  } catch (e) {
    const msg = limpioError(e)
    if (msg.includes('duplicate key')) return { ok: false, error: 'Ya existe una tasa con ese codigo.' }
    return { ok: false, error: msg }
  }

  revalidatePath('/impuestos')
  return { ok: true }
}

/**
 * Enciende o apaga una tasa.
 *
 * Apagar y no borrar: una tasa que ya se uso en facturas del año pasado
 * sigue explicando esas facturas. Borrarla dejaria el historico sin nombre.
 */
export async function alternarTasa(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'taxes', 'taxes.rate.manage')
  if (!permiso.ok) return permiso

  const id = String(fd.get('id') ?? '')
  if (!id) return { ok: false, error: 'Falta la tasa.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        update public.tax_rates
        set is_active = not is_active,
            is_default = case when is_active then false else is_default end
        where id = ${id} and tenant_id = ${ctx.tenantId}`,
    )
  } catch (e) {
    return { ok: false, error: limpioError(e) }
  }

  revalidatePath('/impuestos')
  return { ok: true }
}

/**
 * Siembra las tres tasas de arranque (18 general, 16 reducida, exento).
 *
 * Sale de TASAS_ITBIS_RD, que es un punto de partida EDITABLE y no un dato
 * del sistema: por eso se siembra con un boton que el usuario aprieta y no
 * en la migracion. Quien lo aprieta esta aceptando revisarlas.
 */
export async function sembrarTasas(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'taxes', 'taxes.rate.manage')
  if (!permiso.ok) return permiso

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [ya] = await tx<{ c: string }[]>`
        select count(*) as c from public.tax_rates where tenant_id = ${ctx.tenantId}`
      if (Number(ya?.c ?? 0) > 0) return

      for (const t of TASAS_ITBIS_RD) {
        await tx`
          insert into public.tax_rates (tenant_id, code, name, kind, rate, is_default)
          values (${ctx.tenantId}, ${t.code}, ${t.name}, 'itbis', ${t.rate}, ${t.isDefault})
          on conflict (tenant_id, code) do nothing`
      }
    })
  } catch (e) {
    return { ok: false, error: limpioError(e) }
  }

  revalidatePath('/impuestos')
  return { ok: true }
}

/** Da de alta una regla de retencion. */
export async function crearRegla(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'taxes', 'taxes.rule.manage')
  if (!permiso.ok) return permiso

  const code = String(fd.get('code') ?? '').trim()
  const name = String(fd.get('name') ?? '').trim()
  const tax = String(fd.get('tax') ?? '').trim()
  const partyType = String(fd.get('partyType') ?? '').trim()
  const rate = porcentajeAFraccion(String(fd.get('rate') ?? ''))
  const dgiiIsrType = String(fd.get('dgiiIsrType') ?? '').trim()

  if (code.length < 1) return { ok: false, error: 'Escribe el codigo de la regla.' }
  if (name.length < 2) return { ok: false, error: 'Escribe el nombre de la regla.' }
  if (tax !== 'itbis' && tax !== 'isr') return { ok: false, error: 'Elige ITBIS o ISR.' }
  if (rate === null) {
    return {
      ok: false,
      error: 'La retencion va en porcentaje, entre 0 y 100: escribe 10 para el 10%.',
    }
  }
  if (tax === 'isr' && dgiiIsrType === '') {
    return {
      ok: false,
      error: 'Una retencion de ISR necesita su codigo de la DGII: sin el, el 606 rebota.',
    }
  }

  // La base no la elige el usuario: el ITBIS se retiene sobre el ITBIS
  // facturado y el ISR sobre el subtotal pagado. Ofrecerlo como opcion es
  // ofrecer la forma de que la retencion salga ~6 veces mal.
  const base = tax === 'itbis' ? 'itbis' : 'subtotal'

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        insert into public.tax_withholding_rules
          (tenant_id, code, name, tax, party_type, base, rate, dgii_isr_type)
        values (${ctx.tenantId}, ${code}, ${name}, ${tax}, ${partyType}, ${base}, ${rate},
                ${tax === 'isr' ? dgiiIsrType : null})`,
    )
  } catch (e) {
    const msg = limpioError(e)
    if (msg.includes('duplicate key')) return { ok: false, error: 'Ya existe una regla con ese codigo.' }
    return { ok: false, error: msg }
  }

  revalidatePath('/impuestos')
  revalidatePath('/impuestos/retenciones')
  return { ok: true }
}

/** Enciende o apaga una regla. Igual que con las tasas, no se borra. */
export async function alternarRegla(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'taxes', 'taxes.rule.manage')
  if (!permiso.ok) return permiso

  const id = String(fd.get('id') ?? '')
  if (!id) return { ok: false, error: 'Falta la regla.' }

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        update public.tax_withholding_rules set is_active = not is_active
        where id = ${id} and tenant_id = ${ctx.tenantId}`,
    )
  } catch (e) {
    return { ok: false, error: limpioError(e) }
  }

  revalidatePath('/impuestos')
  revalidatePath('/impuestos/retenciones')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearTasaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearTasa(fd), 'crearTasa')
}
export async function alternarTasaForm(fd: FormData): Promise<void> {
  await anotarAviso(await alternarTasa(fd), 'alternarTasa')
}
export async function sembrarTasasForm(fd: FormData): Promise<void> {
  await anotarAviso(await sembrarTasas(fd), 'sembrarTasas')
}
export async function crearReglaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearRegla(fd), 'crearRegla')
}
export async function alternarReglaForm(fd: FormData): Promise<void> {
  await anotarAviso(await alternarRegla(fd), 'alternarRegla')
}
