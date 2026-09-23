/** Mientras llega la ficha: su esqueleto (titulo, captura 16:10, barra de precio). */
const bloque = 'rounded-[var(--radius-md)] bg-[var(--color-surface-raised)]'

export default function CargandoFicha() {
  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-[var(--color-surface-base)]"
      aria-busy="true"
    >
      <p role="status" className="sr-only">
        Cargando la ficha del módulo…
      </p>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-3 md:px-6">
        <div className={`h-6 w-28 ${bloque}`} />
      </div>
      <div className="flex-1 overflow-hidden motion-safe:animate-pulse" aria-hidden>
        <div className="mx-auto max-w-5xl space-y-4 px-4 pt-6 md:px-6 md:pt-10">
          <div className={`h-3 w-40 ${bloque}`} />
          <div className={`h-10 w-2/3 ${bloque}`} />
          <div className={`h-5 w-full max-w-2xl ${bloque}`} />
          <div className="mt-8 aspect-[16/10] w-full rounded-[var(--radius-xl)] bg-[var(--color-surface-deepest)]" />
        </div>
      </div>
      <div className="h-20 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-deep)]" />
    </div>
  )
}
