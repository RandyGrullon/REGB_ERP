'use client'

import { Icon } from '@regb/ui'

/**
 * Manda la pagina a la impresora. Es cliente porque `window.print` no
 * existe en el servidor, y vive aparte para que el ticket siga siendo un
 * Server Component —los datos del comprobante no tienen por que viajar al
 * navegador como props.
 */
export function PrintButton({ label = 'Imprimir ticket' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
    >
      <Icon name="print" size={18} />
      {label}
    </button>
  )
}
