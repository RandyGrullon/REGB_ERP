/**
 * Mientras llega el catalogo: el esqueleto de la vitrina, no una pantalla
 * en blanco. Misma estructura que la real (encabezado, cifras, tarjetas
 * 16:10 y la barra del simulador) para que nada salte al pintar.
 */
const bloque = 'rounded-[var(--radius-md)] bg-[var(--color-surface-raised)]'

export default function CargandoMarketplace() {
  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-[var(--color-surface-base)]"
      aria-busy="true"
    >
      <p role="status" className="sr-only">
        Cargando el marketplace…
      </p>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-3 md:px-6">
        <div className={`h-6 w-20 ${bloque}`} />
        <div className={`h-5 w-24 ${bloque}`} />
      </div>

      <div className="flex-1 overflow-hidden motion-safe:animate-pulse" aria-hidden>
        <div className="mx-auto max-w-7xl space-y-8 px-4 pt-6 md:px-6 md:pt-10">
          <div className="space-y-3">
            <div className={`h-3 w-40 ${bloque}`} />
            <div className={`h-9 w-full max-w-lg ${bloque}`} />
            <div className={`h-4 w-full max-w-2xl ${bloque}`} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div
                key={i}
                className="h-20 rounded-[var(--radius-lg)] bg-[var(--color-surface-raised)]"
              />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
              >
                <div className="aspect-[16/10] bg-[var(--color-surface-deepest)]" />
                <div className="space-y-2 p-4">
                  <div className={`h-4 w-1/2 ${bloque}`} />
                  <div className={`h-3 w-full ${bloque}`} />
                  <div className={`h-3 w-4/5 ${bloque}`} />
                  <div className="flex items-end justify-between pt-2">
                    <div className={`h-6 w-20 ${bloque}`} />
                    <div className="h-9 w-24 rounded-full bg-[var(--color-surface-raised)]" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="h-16 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-deep)]" />
    </div>
  )
}
