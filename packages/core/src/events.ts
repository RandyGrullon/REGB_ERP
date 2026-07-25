/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Bus de eventos entre modulos — logica pura
 *
 *  Documento maestro §4.4. Un modulo NUNCA importa otro: emite un evento
 *  y quien quiera lo escucha. `inventory` reacciona a
 *  `sales.order.confirmed` sin conocer a `sales`.
 *
 *  Patron outbox: el emisor escribe en `event_outbox` dentro de la MISMA
 *  transaccion que su cambio de negocio. Si la transaccion falla, el evento
 *  no existe. Si tiene exito, el evento esta garantizado. Entrega
 *  at-least-once, asi que TODO manejador debe ser idempotente.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod'

/** Una fila de public.event_outbox lista para despachar. */
export const outboxRowSchema = z.object({
  id: z.union([z.string(), z.number()]),
  tenant_id: z.string().uuid(),
  type: z.string(),
  payload: z.unknown(),
  emitted_by: z.string(),
  correlation_id: z.string().uuid(),
  emitted_at: z.string(),
  attempts: z.number().int().nonnegative(),
})
export type OutboxRow = z.infer<typeof outboxRowSchema>

/** Quien escucha un tipo de evento. Sale de `manifest.events.listens`. */
export interface Subscription {
  /** Modulo que escucha. */
  moduleId: string
  /** Patron: `sales.order.confirmed` o `sales.order.*` o `sales.*`. */
  pattern: string
}

/** Cuantos reintentos antes de rendirse. */
export const MAX_ATTEMPTS = 5

/**
 * Backoff exponencial con tope, en segundos.
 *
 * 30s → 2min → 8min → 32min → 2h. Da margen a que un servicio externo
 * caido se recupere sin martillearlo.
 */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(30 * 4 ** attempts, 7200)
}

/**
 * ¿El patron cubre este tipo de evento?
 *
 * `sales.order.*` cubre `sales.order.confirmed` pero NO `sales.invoice.paid`.
 * `sales.*` cubre ambos. `*` cubre todo.
 */
export function patternMatches(pattern: string, type: string): boolean {
  if (pattern === '*') return true
  if (pattern === type) return true

  if (!pattern.endsWith('.*')) return false
  const prefix = pattern.slice(0, -2)
  return type.startsWith(`${prefix}.`)
}

/**
 * Que modulos deben recibir este evento.
 *
 * Solo se entrega a modulos ACTIVOS: si el cliente apago `inventory`, sus
 * manejadores no corren, igual que sus tablas no se leen (§4.3).
 * Un modulo nunca se escucha a si mismo: eso seria un bucle.
 */
export function resolveTargets(
  event: Pick<OutboxRow, 'type' | 'emitted_by'>,
  subscriptions: readonly Subscription[],
  activeModules: ReadonlySet<string>,
): string[] {
  const targets = new Set<string>()

  for (const sub of subscriptions) {
    if (sub.moduleId === event.emitted_by) continue
    if (!activeModules.has(sub.moduleId)) continue
    if (patternMatches(sub.pattern, event.type)) targets.add(sub.moduleId)
  }

  return [...targets].sort()
}

/** Que hacer con un evento tras intentar despacharlo. */
export type DispatchOutcome =
  | { action: 'done' }
  | { action: 'retry'; delaySeconds: number; attempts: number }
  | { action: 'dead-letter'; reason: string }

/**
 * Decide el destino de un evento segun el resultado del despacho.
 *
 * Se separa de la ejecucion a proposito: asi la politica de reintentos se
 * prueba sin base de datos ni red.
 */
export function nextOutcome(
  row: Pick<OutboxRow, 'attempts'>,
  result: { ok: true } | { ok: false; error: string },
): DispatchOutcome {
  if (result.ok) return { action: 'done' }

  const attempts = row.attempts + 1
  if (attempts >= MAX_ATTEMPTS) {
    return {
      action: 'dead-letter',
      reason: `Agotados ${MAX_ATTEMPTS} intentos. Ultimo error: ${result.error}`,
    }
  }

  return { action: 'retry', delaySeconds: retryDelaySeconds(attempts), attempts }
}

/**
 * Construye el indice de suscripciones desde los manifests.
 *
 * El core no sabe quien escucha que: lo deduce de lo que cada modulo
 * declaro en `events.listens`.
 */
export function buildSubscriptions(
  manifests: readonly { id: string; events: { listens: string[] } }[],
): Subscription[] {
  return manifests.flatMap((m) => m.events.listens.map((pattern) => ({ moduleId: m.id, pattern })))
}
