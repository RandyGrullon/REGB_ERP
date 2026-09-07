/** Etiquetas de estado de un link de cobro. */
export type PaymentLinkTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADO_LINK: Record<string, { label: string; tone: PaymentLinkTone }> = {
  pending: { label: 'Pendiente', tone: 'warning' },
  paid: { label: 'Pagado', tone: 'success' },
  expired: { label: 'Vencido', tone: 'danger' },
  canceled: { label: 'Cancelado', tone: 'neutral' },
}

export const GATEWAY_LABEL: Record<string, string> = {
  manual: 'Manual',
  stripe: 'Stripe',
  azul: 'Azul',
  cardnet: 'CardNet',
  paypal: 'PayPal',
}

export const FRECUENCIA_LABEL: Record<string, string> = {
  weekly: 'Semanal',
  monthly: 'Mensual',
  yearly: 'Anual',
}
