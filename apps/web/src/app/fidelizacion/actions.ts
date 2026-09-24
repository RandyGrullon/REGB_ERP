'use server'

import { revalidatePath } from 'next/cache'
import {
  transicionValidaCupon,
  transicionValidaReferido,
  type EstadoCupon,
  type EstadoReferido,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Fidelizacion (modulo 38, F9/S59).
 *
 * El saldo y el nivel nunca se escriben aqui -se derivan siempre de
 * `loyalty_balance()`/`loyalty_lifetime_points()`-. Estas acciones
 * solo agregan hechos historicos al ledger.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function registrarPuntos(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'loyalty', 'loyalty.manage')
  if (!permiso.ok) return permiso

  const customerId = String(fd.get('customerId') ?? '')
  const puntos = Number(fd.get('points') ?? '')
  const reason = String(fd.get('reason') ?? '').trim()

  if (!customerId) return { ok: false, error: 'Elige el cliente.' }
  if (!Number.isFinite(puntos) || puntos === 0)
    return { ok: false, error: 'Los puntos no pueden ser cero.' }
  if (!reason) return { ok: false, error: 'Escribe una razon.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.loyalty_transactions (tenant_id, customer_id, points, reason, source_type, created_by)
    values (${ctx.tenantId}, ${customerId}, ${puntos}, ${reason}, 'manual', ${ctx.userId})`,
  )

  revalidatePath('/fidelizacion')
  revalidatePath(`/fidelizacion/${customerId}`)
  return { ok: true }
}

export async function crearCupon(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'loyalty', 'loyalty.manage')
  if (!permiso.ok) return permiso

  const code = String(fd.get('code') ?? '')
    .trim()
    .toUpperCase()
  const customerId = String(fd.get('customerId') ?? '') || null
  const discountType = String(fd.get('discountType') ?? '')
  const discountValueRaw = Number(fd.get('discountValue') ?? '')
  const expiresAtRaw = String(fd.get('expiresAt') ?? '')

  if (!code) return { ok: false, error: 'Falta el codigo del cupon.' }
  if (!['percentage', 'fixed'].includes(discountType))
    return { ok: false, error: 'Elige un tipo de descuento valido.' }
  if (!Number.isFinite(discountValueRaw) || discountValueRaw <= 0)
    return { ok: false, error: 'El descuento debe ser mayor que cero.' }
  const discountValue = discountType === 'percentage' ? discountValueRaw / 100 : discountValueRaw
  if (discountType === 'percentage' && discountValue > 1)
    return { ok: false, error: 'Un descuento porcentual no puede ser mayor que 100%.' }
  const expiresAt = expiresAtRaw || null

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.loyalty_coupons (tenant_id, code, customer_id, discount_type, discount_value, expires_at, created_by)
    values (${ctx.tenantId}, ${code}, ${customerId}, ${discountType}, ${discountValue}, ${expiresAt}, ${ctx.userId})`,
  )

  revalidatePath('/fidelizacion/cupones')
  return { ok: true }
}

/** Avanza el estado de un cupon -activo a redimido o expirado, ambos terminales-. */
export async function transicionarCupon(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'loyalty', 'loyalty.manage')
  if (!permiso.ok) return permiso

  const couponId = String(fd.get('couponId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoCupon

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [c] = await tx<{ status: EstadoCupon }[]>`
      select status from public.loyalty_coupons where id = ${couponId} and tenant_id = ${ctx.tenantId} for update`
    if (!c) return 'no-existe'
    if (!transicionValidaCupon(c.status, siguiente)) return 'Ese cupon ya se resolvio.'

    await tx`
      update public.loyalty_coupons
      set status = ${siguiente}, redeemed_at = case when ${siguiente === 'redeemed'} then now() else redeemed_at end
      where id = ${couponId} and tenant_id = ${ctx.tenantId}`

    if (siguiente === 'redeemed') {
      await tx`
        select public.emit_event('loyalty.coupon.redeemed',
          ${JSON.stringify({ couponId })}::text::jsonb, 'loyalty')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese cupon no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/fidelizacion/cupones')
  return { ok: true }
}

export async function crearReferido(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'loyalty', 'loyalty.manage')
  if (!permiso.ok) return permiso

  const referrerCustomerId = String(fd.get('customerId') ?? '')
  const referredCustomerId = String(fd.get('referredCustomerId') ?? '')
  const bonusPoints = Number(fd.get('bonusPoints') ?? '')

  if (!referrerCustomerId) return { ok: false, error: 'Falta el cliente que refiere.' }
  if (!referredCustomerId) return { ok: false, error: 'Elige a quien refiere.' }
  if (referrerCustomerId === referredCustomerId)
    return { ok: false, error: 'Un cliente no puede referirse a si mismo.' }
  if (!Number.isFinite(bonusPoints) || bonusPoints <= 0)
    return { ok: false, error: 'El bono debe ser mayor que cero.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.loyalty_referrals (tenant_id, referrer_customer_id, referred_customer_id, bonus_points)
    values (${ctx.tenantId}, ${referrerCustomerId}, ${referredCustomerId}, ${bonusPoints})`,
  )

  revalidatePath(`/fidelizacion/${referrerCustomerId}`)
  return { ok: true }
}

/** Completar un referido acredita el bono al referente en el mismo movimiento; expirar no acredita nada. */
export async function transicionarReferido(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'loyalty', 'loyalty.manage')
  if (!permiso.ok) return permiso

  const referralId = String(fd.get('referralId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoReferido

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [r] = await tx<
      { status: EstadoReferido; referrer_customer_id: string; bonus_points: number }[]
    >`
      select status, referrer_customer_id, bonus_points from public.loyalty_referrals
      where id = ${referralId} and tenant_id = ${ctx.tenantId} for update`
    if (!r) return 'no-existe'
    if (!transicionValidaReferido(r.status, siguiente)) return 'Ese referido ya se resolvio.'

    await tx`
      update public.loyalty_referrals
      set status = ${siguiente}, completed_at = case when ${siguiente === 'completed'} then now() else completed_at end
      where id = ${referralId} and tenant_id = ${ctx.tenantId}`

    if (siguiente === 'completed') {
      await tx`
        insert into public.loyalty_transactions (tenant_id, customer_id, points, reason, source_type, source_id)
        values (${ctx.tenantId}, ${r.referrer_customer_id}, ${r.bonus_points}, 'Bono por referido', 'referral_bonus', ${referralId})`

      await tx`
        select public.emit_event('loyalty.referral.completed',
          ${JSON.stringify({ referralId })}::text::jsonb, 'loyalty')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese referido no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/fidelizacion/${String(fd.get('customerId') ?? '')}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function registrarPuntosForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarPuntos(fd), 'registrarPuntos')
}
export async function crearCuponForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearCupon(fd), 'crearCupon')
}
export async function transicionarCuponForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarCupon(fd), 'transicionarCupon')
}
export async function crearReferidoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearReferido(fd), 'crearReferido')
}
export async function transicionarReferidoForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarReferido(fd), 'transicionarReferido')
}
