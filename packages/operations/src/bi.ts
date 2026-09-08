export type FrecuenciaExportacion = 'daily' | 'weekly' | 'monthly'

/** Proxima fecha de ejecucion de un export programado -misma fecha del mes se ajusta al ultimo dia si el mes es mas corto-. */
export function proximaEjecucion(desde: Date, frecuencia: FrecuenciaExportacion): Date {
  const siguiente = new Date(desde)
  if (frecuencia === 'daily') {
    siguiente.setUTCDate(siguiente.getUTCDate() + 1)
  } else if (frecuencia === 'weekly') {
    siguiente.setUTCDate(siguiente.getUTCDate() + 7)
  } else {
    const diaOriginal = siguiente.getUTCDate()
    siguiente.setUTCDate(1)
    siguiente.setUTCMonth(siguiente.getUTCMonth() + 1)
    const ultimoDiaDelMes = new Date(Date.UTC(siguiente.getUTCFullYear(), siguiente.getUTCMonth() + 1, 0)).getUTCDate()
    siguiente.setUTCDate(Math.min(diaOriginal, ultimoDiaDelMes))
  }
  return siguiente
}

export const FUENTES_REPORTE = [
  'sales_by_day',
  'top_products',
  'overdue_invoices',
  'leads_by_status',
  'tickets_by_priority',
] as const

export type FuenteReporte = (typeof FUENTES_REPORTE)[number]

export function fuenteValida(valor: string): valor is FuenteReporte {
  return (FUENTES_REPORTE as readonly string[]).includes(valor)
}
