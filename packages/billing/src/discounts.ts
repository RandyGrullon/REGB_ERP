export type DiscountKind = 'none' | 'annual' | 'biennial' | 'triennial' | 'partner' | 'ong'

/** §6.4 y agente regb-billing: descuentos por ciclo de pago, partner y ONG. */
export const DISCOUNT_RATES: Record<DiscountKind, number> = {
  none: 0,
  annual: 0.15,
  biennial: 0.2,
  triennial: 0.25,
  partner: 0.2,
  ong: 0.3,
}

export const DISCOUNT_LABELS: Record<DiscountKind, string> = {
  none: '',
  annual: 'Ciclo anual',
  biennial: 'Ciclo bianual',
  triennial: 'Ciclo trianual',
  partner: 'Partner',
  ong: 'ONG',
}

/** ITBIS estandar en Republica Dominicana. */
export const ITBIS_RATE = 0.18
