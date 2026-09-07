/** Etiquetas de estado y categoria de un activo fijo. */
export type FixedAssetTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADO_ACTIVO: Record<string, { label: string; tone: FixedAssetTone }> = {
  active: { label: 'Activo', tone: 'success' },
  disposed: { label: 'Dado de baja', tone: 'neutral' },
}

export const CATEGORIA_ACTIVO: Record<string, string> = {
  vehicle: 'Vehiculo',
  equipment: 'Equipo',
  furniture: 'Mobiliario',
  building: 'Edificio',
  other: 'Otro',
}

export const METODO_DEPRECIACION: Record<string, string> = {
  straight_line: 'Linea recta',
  declining_balance: 'Acelerada',
}
