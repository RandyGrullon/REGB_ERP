import 'server-only'

import { MANIFESTS } from '@/lib/bootstrap'

/**
 * El nombre que el cliente ve en el menu, a partir del id de un modulo.
 * Los de plataforma sin manifest salian con su id ("rbac", "marketplace")
 * y el inicio como "Dashboard".
 */
const NOMBRE_VISIBLE: Record<string, string> = {
  rbac: 'Roles y permisos',
  marketplace: 'Marketplace',
  dashboard: 'Inicio',
}

export function nombreDeModulo(id: string): string {
  return NOMBRE_VISIBLE[id] ?? MANIFESTS.get(id)?.name ?? id
}
