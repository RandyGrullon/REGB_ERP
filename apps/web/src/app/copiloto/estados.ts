import type { PreguntaCatalogo } from '@regb/operations'

/** Catalogo FIJO de preguntas vetadas -el mismo que ya usa bi-. Nunca se acepta una pregunta libre convertida en SQL. */
export const CATALOGO_PREGUNTAS: PreguntaCatalogo[] = [
  { key: 'sales_by_day', palabrasClave: ['venta', 'ventas', 'vendimos', 'vendiste'] },
  { key: 'top_products', palabrasClave: ['producto', 'vendido', 'vendidos', 'popular'] },
  {
    key: 'overdue_invoices',
    palabrasClave: ['factura', 'facturas', 'vencida', 'vencidas', 'cobrar', 'deuda'],
  },
  { key: 'leads_by_status', palabrasClave: ['lead', 'leads', 'prospecto', 'prospectos'] },
  { key: 'tickets_by_priority', palabrasClave: ['ticket', 'tickets', 'soporte', 'prioridad'] },
]

export const FUENTE_LABEL_COPILOTO: Record<string, string> = {
  sales_by_day: 'Ventas por dia',
  top_products: 'Productos mas vendidos',
  overdue_invoices: 'Facturas vencidas',
  leads_by_status: 'Leads por estado',
  tickets_by_priority: 'Tickets por prioridad',
  no_match: 'Sin coincidencia',
}

export const PREGUNTAS_EJEMPLO = [
  '¿Cuanto vendimos hoy?',
  '¿Cual es el producto mas vendido?',
  '¿Que facturas estan vencidas?',
  '¿Cuantos leads tengo por estado?',
  '¿Cuantos tickets urgentes hay?',
]
