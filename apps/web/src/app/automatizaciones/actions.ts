'use server'

import { revalidatePath } from 'next/cache'
import {
  accionValida,
  condicionCumple,
  tipoEventoValido,
  type OperadorCondicion,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Automatizaciones (modulo 88, F9/S63).
 *
 * `procesarEventosPendientes()` es el corazon del modulo: SOLO lee
 * `event_outbox` -nunca llama `claim_events()`/`settle_event()`,
 * reservados al despachador global de fondo- y deja su propia
 * bitacora en `automation_runs`, sin marcar nada como procesado para
 * el resto del sistema.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function crearRegla(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'automations', 'automations.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const triggerEventType = String(fd.get('triggerEventType') ?? '').trim()
  const conditionField = String(fd.get('conditionField') ?? '').trim() || null
  const conditionOperator = String(fd.get('conditionOperator') ?? '') || null
  const conditionValue = String(fd.get('conditionValue') ?? '').trim() || null
  const actionType = String(fd.get('actionType') ?? '')
  const title = String(fd.get('title') ?? '').trim()
  const body = String(fd.get('body') ?? '').trim()

  if (!name) return { ok: false, error: 'Falta el nombre de la regla.' }
  if (!tipoEventoValido(triggerEventType)) return { ok: false, error: 'El tipo de evento debe seguir modulo.entidad.accion.' }
  if (!accionValida(actionType)) return { ok: false, error: 'Elige una accion valida.' }
  if (!title) return { ok: false, error: 'Falta el titulo de la notificacion.' }
  if ((conditionField && !conditionOperator) || (!conditionField && conditionOperator)) {
    return { ok: false, error: 'La condicion necesita campo, operador y valor juntos.' }
  }
  if (conditionField && !conditionValue) return { ok: false, error: 'Falta el valor de la condicion.' }

  const actionParams = { title, body }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.automation_rules
      (tenant_id, name, trigger_event_type, condition_field, condition_operator, condition_value, action_type, action_params, created_by)
    values
      (${ctx.tenantId}, ${name}, ${triggerEventType}, ${conditionField}, ${conditionOperator}, ${conditionValue}, ${actionType}, ${JSON.stringify(actionParams)}::text::jsonb, ${ctx.userId})`)

  revalidatePath('/automatizaciones')
  return { ok: true }
}

export async function alternarRegla(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'automations', 'automations.manage')
  if (!permiso.ok) return permiso

  const ruleId = String(fd.get('ruleId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '')
  if (!['active', 'paused'].includes(siguiente)) return { ok: false, error: 'Estado invalido.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    update public.automation_rules set status = ${siguiente}, updated_at = now()
    where id = ${ruleId} and tenant_id = ${ctx.tenantId}`)

  revalidatePath('/automatizaciones')
  return { ok: true }
}

interface ReglaActiva {
  id: string
  trigger_event_type: string
  condition_field: string | null
  condition_operator: OperadorCondicion | null
  condition_value: string | null
  action_type: string
  action_params: { title: string; body: string }
}

interface EventoPendiente {
  id: string
  payload: Record<string, unknown>
}

/** Procesa eventos pendientes contra las reglas activas -sin tocar el despachador real-. */
export async function procesarEventosPendientes(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'automations', 'automations.manage')
  if (!permiso.ok) return permiso

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const reglas = await tx<ReglaActiva[]>`
      select id, trigger_event_type, condition_field, condition_operator, condition_value, action_type, action_params
      from public.automation_rules where tenant_id = ${ctx.tenantId} and status = 'active'`

    for (const regla of reglas) {
      const eventos = await tx<EventoPendiente[]>`
        select eo.id, eo.payload
        from public.event_outbox eo
        where eo.tenant_id = ${ctx.tenantId} and eo.type = ${regla.trigger_event_type}
          and not exists (
            select 1 from public.automation_runs ar
            where ar.rule_id = ${regla.id} and ar.event_id = eo.id
          )
        order by eo.emitted_at
        limit 20`

      for (const evento of eventos) {
        const cumple =
          !regla.condition_field || !regla.condition_operator || !regla.condition_value
            ? true
            : condicionCumple(String(evento.payload[regla.condition_field] ?? ''), regla.condition_operator, regla.condition_value)

        let resultado: { notificationId: string } | null = null
        if (cumple && regla.action_type === 'create_notification') {
          const [n] = await tx<{ id: string }[]>`
            insert into public.notifications (tenant_id, module_id, title, body)
            values (${ctx.tenantId}, 'automations', ${regla.action_params.title}, ${regla.action_params.body || null})
            returning id`
          resultado = { notificationId: n!.id }
        }

        await tx`
          insert into public.automation_runs (tenant_id, rule_id, event_id, matched, action_result)
          values (${ctx.tenantId}, ${regla.id}, ${evento.id}, ${cumple}, ${resultado ? JSON.stringify(resultado) : null}::text::jsonb)`
      }
    }
  })

  revalidatePath('/automatizaciones')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearReglaForm(fd: FormData): Promise<void> {
  await crearRegla(fd)
}
export async function alternarReglaForm(fd: FormData): Promise<void> {
  await alternarRegla(fd)
}
export async function procesarEventosPendientesForm(fd: FormData): Promise<void> {
  await procesarEventosPendientes(fd)
}
