/** Etiquetas de estado de un empleado. */
export type EmployeeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADO_EMPLEADO: Record<string, { label: string; tone: EmployeeTone }> = {
  active: { label: 'Activo', tone: 'success' },
  on_leave: { label: 'De permiso', tone: 'warning' },
  terminated: { label: 'Dado de baja', tone: 'neutral' },
}

export const TIPO_CONTRATO: Record<string, string> = {
  indefinido: 'Indefinido',
  determinado: 'Por tiempo determinado',
  por_obra: 'Por obra',
}
