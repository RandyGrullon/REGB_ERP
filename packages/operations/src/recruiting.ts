/**
 * Reclutamiento (ATS) -Sec5.6, modulo 65 (F7/S41).
 *
 * SIN portal de empleo publico -este esquema nunca otorga acceso al rol
 * `anon` sobre datos de negocio (ver 0005_rls_policies.sql), y una
 * pagina de vacantes visible sin iniciar sesion rompe esa regla ya
 * establecida-. Los candidatos se registran manualmente por quien
 * recluta, igual que un gasto sin OCR: sin foto de curriculum procesada
 * automaticamente.
 */

export type EtapaAplicacion = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'

const ORDEN_PIPELINE: EtapaAplicacion[] = ['applied', 'screening', 'interview', 'offer', 'hired']

/**
 * Si avanzar de una etapa a otra es un movimiento valido del pipeline.
 * `hired` y `rejected` son terminales -no salen de ahi-. Se puede
 * rechazar desde cualquier etapa no terminal, pero avanzar solo un paso
 * a la vez -no saltar de "applied" directo a "offer"-.
 */
export function transicionValida(actual: EtapaAplicacion, siguiente: EtapaAplicacion): boolean {
  if (actual === 'hired' || actual === 'rejected') return false
  if (siguiente === 'rejected') return true

  const iActual = ORDEN_PIPELINE.indexOf(actual)
  const iSiguiente = ORDEN_PIPELINE.indexOf(siguiente)
  if (iActual === -1 || iSiguiente === -1) return false
  return iSiguiente === iActual + 1
}

/** Dias que un candidato lleva en el pipeline -para el reporte de tiempo de contratacion-. */
export function diasEnPipeline(appliedAt: Date, asOf: Date): number {
  const dias = Math.round((asOf.getTime() - appliedAt.getTime()) / 86_400_000)
  return Math.max(0, dias)
}
