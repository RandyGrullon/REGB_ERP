import { Icon, cn } from '@regb/ui'
import { sePuedePedir, type CatalogEntry } from '@/lib/catalog'
import { CapturaModulo } from './CapturaModulo'
import { EstadoModulo } from './EstadoModulo'
import { FOCO, diasRestantes, money } from './formato'

/**
 * Tarjeta de un modulo en la vitrina.
 *
 * Jerarquia, de arriba abajo: la pantalla real (lo que se compra), el
 * nombre y su estado, una linea de valor, y abajo el precio mensual —lo
 * unico que se compara entre tarjetas— junto a la accion.
 *
 * La accion es un checkbox con cara de boton pildora: semanticamente es
 * "¿entra en el simulador, si o no?", y un checkbox lo anuncia bien sin
 * inventar roles. Nada se compra desde aqui: solo se simula.
 *
 * Seleccion = contorno azul de 2px (la unica vez que aparece un borde
 * grueso). Arrastrado por dependencia = el mismo contorno, punteado, y el
 * texto lo dice: el color nunca va solo.
 */
export function TarjetaModulo({
  mod,
  marcado,
  arrastrado,
  onToggle,
  detailHref,
  necesita,
}: {
  mod: CatalogEntry
  /** El cliente lo marco. */
  marcado: boolean
  /** Entro al calculo porque otro lo necesita, no porque se marcara. */
  arrastrado: boolean
  onToggle: () => void
  detailHref: string
  /** Nombres de las dependencias que le faltan. */
  necesita: string[]
}) {
  const vendible = sePuedePedir(mod)
  const tituloId = `mod-${mod.id}`

  return (
    <article
      aria-labelledby={tituloId}
      className={cn(
        'group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface-raised)]',
        'transition-colors duration-100 ease-out',
        marcado
          ? 'border-transparent outline-2 -outline-offset-1 outline-[var(--color-brand-bright)]'
          : arrastrado
            ? 'border-transparent outline-2 -outline-offset-1 outline-dashed outline-[var(--color-brand-bright)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
      )}
    >
      {/* La imagen tambien lleva a la ficha, pero fuera del orden de
          tabulacion: el nombre ya es ese enlace y dos paradas iguales
          seguidas cansan a quien navega con teclado. */}
      <a href={detailHref} tabIndex={-1} aria-hidden className="block">
        <CapturaModulo
          mod={mod}
          className={cn(
            'aspect-[16/10] border-b border-[var(--color-border)]',
            !mod.isPublished && 'opacity-80',
          )}
        />
      </a>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h4 id={tituloId} className="min-w-0 text-[15px] font-semibold leading-5">
            <a
              href={detailHref}
              className={cn(
                'rounded-[var(--radius-sm)] text-[var(--color-text-primary)] underline-offset-2 hover:text-[var(--color-text-link)] hover:underline',
                FOCO,
              )}
            >
              {mod.name}
            </a>
          </h4>
          <span className="shrink-0">
            <EstadoModulo mod={mod} />
          </span>
        </div>

        <p className="line-clamp-2 text-[13px] leading-[18px] text-[var(--color-text-secondary)]">
          {mod.description}
        </p>

        {vendible && necesita.length > 0 && (
          <p className="flex items-start gap-1 text-xs text-[var(--color-text-muted)]">
            <Icon name="link" size={14} className="mt-px shrink-0" />
            <span>
              Necesita{' '}
              <span className="text-[var(--color-text-secondary)]">{necesita.join(', ')}</span>
              {necesita.length === 1
                ? ' · se agrega solo al marcarlo'
                : ' · se agregan solos al marcarlo'}
            </span>
          </p>
        )}

        <Plataformas platforms={mod.platforms} />

        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-2">
          <Precio mod={mod} />

          {vendible ? (
            <label className="relative inline-flex cursor-pointer">
              <input
                type="checkbox"
                checked={marcado}
                onChange={onToggle}
                className="peer sr-only"
                aria-describedby={arrastrado ? `${tituloId}-dep` : undefined}
              />
              <span
                className={cn(
                  'inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold md:h-9',
                  'transition-colors duration-100 ease-out active:translate-y-px',
                  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-brand-bright)]',
                  marcado
                    ? 'bg-[var(--color-brand)] text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
                    : arrastrado
                      ? 'border border-dashed border-[var(--color-brand-bright)] text-[var(--color-text-link)]'
                      : 'border border-[var(--color-brand-bright)] text-[var(--color-text-link)] hover:bg-[var(--color-brand-soft)]',
                )}
              >
                <Icon name={marcado ? 'check' : arrastrado ? 'link' : 'add'} size={16} />
                <span aria-hidden>
                  {marcado ? 'Agregado' : arrastrado ? 'Por dependencia' : 'Agregar'}
                </span>
                <span className="sr-only">Agregar {mod.name} al simulador</span>
              </span>
              {arrastrado && (
                <span id={`${tituloId}-dep`} className="sr-only">
                  Ya entra en el cálculo porque otro módulo que marcaste lo necesita.
                </span>
              )}
            </label>
          ) : (
            <a
              href={detailHref}
              className={cn(
                'inline-flex h-11 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-[var(--color-text-link)] hover:bg-[var(--color-surface-overlay)] md:h-9',
                FOCO,
              )}
            >
              Ver ficha
              <span className="sr-only"> de {mod.name}</span>
              <Icon name="chevron_right" size={16} />
            </a>
          )}
        </div>
      </div>
    </article>
  )
}

function Precio({ mod }: { mod: CatalogEntry }) {
  if (mod.category === 'core') {
    return (
      <div>
        <p className="text-base font-bold text-[var(--color-text-primary)]">Incluido</p>
        <p className="text-xs text-[var(--color-text-muted)]">Sin costo aparte</p>
      </div>
    )
  }

  if (mod.status === 'trial') {
    const dias = diasRestantes(mod.trialEndsAt)
    return (
      <div>
        <p className="text-base font-bold text-[var(--color-text-primary)]">Gratis en prueba</p>
        <p className="tabular text-xs text-[var(--color-text-muted)]">
          {dias !== null && `${dias === 1 ? 'Queda 1 día' : `Quedan ${dias} días`} · `}luego US${' '}
          {money(mod.monthlyPrice)}/mes
        </p>
      </div>
    )
  }

  const tenue = !mod.isPublished || mod.status === 'active'
  return (
    <div>
      <p className="tabular flex items-baseline gap-0.5">
        <span
          className={cn(
            'text-xl font-bold tracking-tight',
            tenue ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]',
          )}
        >
          US$ {money(mod.monthlyPrice)}
        </span>
        <span className="text-xs text-[var(--color-text-muted)]">/mes</span>
      </p>
      <p className="tabular text-xs text-[var(--color-text-muted)]">
        {mod.status === 'active'
          ? 'Ya está en tu factura'
          : !mod.isPublished
            ? 'Precio previsto al salir'
            : `+ US$ ${money(mod.installPrice)} de instalación`}
      </p>
    </div>
  )
}

function Plataformas({ platforms }: { platforms: CatalogEntry['platforms'] }) {
  const lista = (
    [
      ['web', 'language', 'Web'],
      ['desktop', 'desktop_windows', 'Escritorio'],
      ['mobile', 'smartphone', 'Móvil'],
    ] as const
  ).filter(([k]) => platforms[k])
  if (lista.length === 0) return null
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--color-text-muted)]">
      <span className="sr-only">Funciona en:</span>
      {lista.map(([k, icono, texto]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <Icon name={icono} size={14} />
          {texto}
        </span>
      ))}
    </p>
  )
}
