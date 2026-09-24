'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@regb/ui'

const SECCIONES = [
  { href: '/control', label: 'Clientes', icon: 'groups' },
  { href: '/control/salud', label: 'Salud', icon: 'monitor_heart' },
  { href: '/control/datos', label: 'Todo el dato', icon: 'database' },
  { href: '/control/actividad', label: 'Actividad', icon: 'history' },
  { href: '/control/facturacion', label: 'Facturación', icon: 'receipt_long' },
  { href: '/control/onboarding', label: 'Onboarding', icon: 'rocket_launch' },
] as const

/**
 * Nav de secciones con estado activo.
 *
 * Antes era una lista de enlaces sin marcar cual era el actual — en una
 * pantalla con 6 secciones parecidas, eso obliga a leer la URL para saber
 * donde estas. `usePathname()` es lo minimo para que la barra conteste esa
 * pregunta sola.
 */
export function ControlNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Secciones" className="flex items-center gap-1 overflow-x-auto text-sm">
      {SECCIONES.map((s) => {
        // '/control' no puede usar startsWith o marcaria todo como activo.
        const activo = s.href === '/control' ? pathname === '/control' : pathname.startsWith(s.href)
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={activo ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] ${
              activo
                ? 'bg-[var(--color-surface-raised)] font-medium text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Icon
              name={s.icon}
              size={16}
              className={
                activo ? 'text-[var(--color-accent-plum-bright)]' : 'text-[var(--color-text-muted)]'
              }
            />
            {s.label}
          </Link>
        )
      })}
    </nav>
  )
}
