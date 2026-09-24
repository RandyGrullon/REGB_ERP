import { Icon, cn } from '@regb/ui'
import {
  PAQUETES,
  cerrarDependencias,
  estaActivo,
  sePuedePedir,
  type CatalogEntry,
} from '@/lib/catalog'
import { FOCO, plural, usd } from './formato'

/**
 * "¿No sabes por donde empezar?" — paquetes por tipo de negocio.
 *
 * Cada paquete dice que trae, que ya tienes (con icono y texto, no solo
 * color), cuantos te faltan contando los requisitos que arrastran, y cuanto
 * subiria tu factura: lo calcula en el servidor el motor de facturacion
 * (`cotizacionesPaquetes` en la pagina), con ITBIS y los incluidos del
 * plan, no una suma de precios de lista. Cargarlo no compra nada: lo pone
 * en el simulador, donde se puede ajustar.
 *
 * En movil los paquetes se deslizan de lado (con su propio scroll) en vez
 * de apilar ocho tarjetas antes del catalogo.
 */
export function PaquetesNegocio({
  porId,
  cotizaciones,
  enSimulador,
  onCargar,
  onQuitar,
}: {
  porId: ReadonlyMap<string, CatalogEntry>
  /** Por id de paquete: cuanto sube la factura y cuanto cuesta instalar. */
  cotizaciones: Record<string, { aumento: number; instalacion: number }>
  /** Lo que ya esta en el simulador, dependencias incluidas. */
  enSimulador: ReadonlySet<string>
  onCargar: (ids: string[]) => void
  onQuitar: (ids: string[]) => void
}) {
  const paquetes = PAQUETES.map((p) => {
    // Se vuelve a filtrar por publicado al pintar: si un modulo se
    // despublica, el paquete deja de prometerlo sin tocar la lista.
    const incluidos = p.modulos
      .map((id) => porId.get(id))
      .filter((m): m is CatalogEntry => m !== undefined && m.isPublished)
    const faltan = incluidos.filter(sePuedePedir).map((m) => m.id)
    const { total, anadidos } = cerrarDependencias(faltan, porId)
    const costo = cotizaciones[p.id] ?? null
    return { ...p, incluidos, faltan, total: [...total], anadidos, costo }
  }).filter((p) => p.incluidos.length > 0)

  if (paquetes.length === 0) return null

  return (
    <section aria-labelledby="paquetes-titulo" data-tour="marketplace-paquetes">
      <div className="mb-4">
        <h2
          id="paquetes-titulo"
          className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]"
        >
          Empieza por tu tipo de negocio
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Elige el que más se parece al tuyo. Lo cargamos en el simulador con lo que te falta; el
          monto es lo que subiría tu factura, con ITBIS.
        </p>
      </div>

      <ul className="relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-4">
        {paquetes.map((p) => {
          const completo = p.faltan.length === 0
          const cargado = !completo && p.total.every((id) => enSimulador.has(id))
          const tituloId = `paquete-${p.id}`
          return (
            <li
              key={p.id}
              className={cn(
                'flex w-[84%] shrink-0 snap-start flex-col gap-3 rounded-[var(--radius-lg)] border bg-[var(--color-surface-raised)] p-4 sm:w-[58%] md:w-auto',
                cargado
                  ? 'border-transparent outline-2 -outline-offset-1 outline-[var(--color-brand-bright)]'
                  : 'border-[var(--color-border)]',
              )}
            >
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-brand-soft)] text-[var(--color-text-link)]">
                  <Icon name={p.icono} size={22} />
                </span>
                <div className="min-w-0">
                  <h3
                    id={tituloId}
                    className="text-[15px] font-semibold leading-5 text-[var(--color-text-primary)]"
                  >
                    {p.nombre}
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{p.para}</p>
                </div>
              </div>

              <ul aria-label={`Qué incluye ${p.nombre}`} className="flex flex-wrap gap-1">
                {p.incluidos.map((m) => {
                  const tiene = estaActivo(m) || m.category === 'core'
                  return (
                    <li
                      key={m.id}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-base)] px-2 py-0.5 text-xs',
                        tiene
                          ? 'text-[var(--color-text-muted)]'
                          : 'text-[var(--color-text-primary)]',
                      )}
                    >
                      <Icon
                        name={tiene ? 'check' : 'add'}
                        size={12}
                        className={tiene ? 'text-[var(--color-semantic-text-success)]' : ''}
                      />
                      {m.name}
                      <span className="sr-only">{tiene ? '(ya lo tienes)' : '(te falta)'}</span>
                    </li>
                  )
                })}
              </ul>

              {p.nota && (
                <p className="flex items-start gap-1 text-xs text-[var(--color-text-muted)]">
                  <Icon name="info" size={14} className="mt-px shrink-0" />
                  {p.nota}
                </p>
              )}

              <div className="mt-auto flex items-end justify-between gap-3 border-t border-[var(--color-border)] pt-3">
                {completo ? (
                  <p className="flex items-center gap-1 text-sm font-semibold text-[var(--color-semantic-text-success)]">
                    <Icon name="check_circle" size={18} filled />
                    Ya lo tienes completo
                  </p>
                ) : (
                  <div className="min-w-0">
                    {p.costo && (
                      <p className="tabular flex items-baseline gap-0.5">
                        <span className="text-lg font-bold tracking-tight text-[var(--color-text-primary)]">
                          +{usd(p.costo.aumento)}
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)]">/mes</span>
                      </p>
                    )}
                    <p className="tabular text-xs text-[var(--color-text-muted)]">
                      Te faltan {p.total.length}
                      {p.anadidos.length > 0 &&
                        ` (${plural(p.anadidos.length, 'es requisito', 'son requisitos')})`}
                      {p.costo && ` · + ${usd(p.costo.instalacion)} + ITBIS de instalación`}
                    </p>
                  </div>
                )}

                {!completo && (
                  <button
                    type="button"
                    aria-pressed={cargado}
                    aria-label={`Simular paquete ${p.nombre}`}
                    onClick={() => (cargado ? onQuitar(p.total) : onCargar(p.faltan))}
                    className={cn(
                      'inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-4 text-[13px] font-semibold transition-colors duration-100 ease-out active:translate-y-px md:h-9',
                      FOCO,
                      cargado
                        ? 'bg-[var(--color-brand)] text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
                        : 'border border-[var(--color-brand-bright)] text-[var(--color-text-link)] hover:bg-[var(--color-brand-soft)]',
                    )}
                  >
                    <Icon name={cargado ? 'check' : 'add'} size={16} />
                    Simular
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
