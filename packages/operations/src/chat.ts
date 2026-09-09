export type AmbitoCanal = 'module' | 'project' | 'branch' | 'general'

/** Como se muestra una mencion en el hilo: @NombreSinEspacios. */
export function formatearMencion(displayName: string): string {
  return `@${displayName.trim().replace(/\s+/g, '')}`
}
