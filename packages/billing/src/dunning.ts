/**
 * Escalera de mora (§6.6): que le pasa al tenant segun los dias de atraso
 * de su factura impaga MAS VIEJA. Ningun paso borra datos, jamas.
 *
 * La transicion real la ejecuta regb.apply_dunning() en el servidor; esto
 * es la misma tabla en TypeScript para que las tres plataformas pinten
 * banners y avisos sin preguntarle a la base de datos.
 */

export type DunningStage =
  | 'ok' // sin mora
  | 'reminder' // dia 5: email de recordatorio
  | 'banner' // dia 10: banner amarillo dentro del ERP
  | 'readonly' // dia 15: solo lectura + banner rojo
  | 'suspended' // dia 30: login bloqueado, datos intactos
  | 'archived' // dia 90: archivo del tenant

export const DUNNING_LADDER: { day: number; stage: DunningStage }[] = [
  { day: 90, stage: 'archived' },
  { day: 30, stage: 'suspended' },
  { day: 15, stage: 'readonly' },
  { day: 10, stage: 'banner' },
  { day: 5, stage: 'reminder' },
]

export function dunningStage(daysOverdue: number): DunningStage {
  for (const rung of DUNNING_LADDER) {
    if (daysOverdue >= rung.day) return rung.stage
  }
  return 'ok'
}

/** Mensaje del banner segun el estado del tenant. `null` = sin banner. */
export function dunningBanner(
  tenantStatus: string,
): { tone: 'warning' | 'danger'; message: string } | null {
  if (tenantStatus === 'past_due') {
    return {
      tone: 'warning',
      message:
        'Tienes una factura pendiente. Regulariza el pago para evitar la suspension del servicio.',
    }
  }
  if (tenantStatus === 'readonly') {
    return {
      tone: 'danger',
      message:
        'Cuenta en solo lectura por falta de pago. Tus datos estan intactos; paga para reactivar.',
    }
  }
  return null
}
