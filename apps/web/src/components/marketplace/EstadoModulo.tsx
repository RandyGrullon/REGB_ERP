import { Badge, Icon } from '@regb/ui'
import type { CatalogEntry } from '@/lib/catalog'
import { diasRestantes } from './formato'

/**
 * El estado de un modulo en ESTE cliente: color + icono + texto, nunca
 * color solo. Sin `'use client'`: no tiene estado, lo puede pintar la
 * tarjeta o la ficha.
 *
 * "Disponible" no lleva insignia a proposito: lo dice el boton de
 * agregar. Una insignia en cada tarjeta que se puede comprar es ruido.
 */
export function EstadoModulo({
  mod,
  largo = false,
}: {
  mod: Pick<CatalogEntry, 'status' | 'enabled' | 'isPublished' | 'category' | 'trialEndsAt'>
  /** Texto completo, para la ficha. */
  largo?: boolean
}) {
  if (mod.status === 'trial') {
    const dias = diasRestantes(mod.trialEndsAt)
    return (
      <Badge tone="warning" dot={false}>
        <Icon name="hourglass_top" size={14} />
        {dias === null
          ? 'En prueba'
          : `${largo ? 'En prueba · te quedan' : 'Prueba ·'} ${dias} ${dias === 1 ? 'día' : 'días'}`}
      </Badge>
    )
  }
  if (mod.status === 'trial_expired') {
    // Vencida (0128): ya no se ve ni se cobra. Se dice que termino y que
    // los datos siguen, y la tarjeta la ofrece de nuevo para pedirla.
    return (
      <Badge tone="neutral" dot={false}>
        <Icon name="event_busy" size={14} />
        {largo ? 'Prueba terminada: tus datos se quedan' : 'Prueba terminada'}
      </Badge>
    )
  }
  if (mod.status === 'active') {
    return mod.enabled ? (
      <Badge tone="success" dot={false}>
        <Icon name="check_circle" size={14} filled />
        {largo ? 'Activo en tu cuenta' : 'Activo'}
      </Badge>
    ) : (
      <Badge tone="neutral" dot={false}>
        <Icon name="toggle_off" size={14} />
        {largo ? 'Contratado, pero apagado' : 'Apagado'}
      </Badge>
    )
  }
  if (mod.status === 'suspended') {
    return (
      <Badge tone="danger" dot={false}>
        <Icon name="block" size={14} />
        Suspendido
      </Badge>
    )
  }
  if (!mod.isPublished) {
    return (
      <Badge tone="neutral" dot={false}>
        <Icon name="construction" size={14} />
        {largo ? 'Todavía no está disponible' : 'Próximamente'}
      </Badge>
    )
  }
  if (mod.category === 'core') {
    return (
      <Badge tone="neutral" dot={false}>
        <Icon name="verified" size={14} />
        Incluido en tu plan
      </Badge>
    )
  }
  if (mod.status === 'archived') {
    return (
      <Badge tone="neutral" dot={false}>
        <Icon name="inventory" size={14} />
        {largo ? 'Lo tuviste: tus datos siguen aquí' : 'Tus datos siguen'}
      </Badge>
    )
  }
  return null
}
