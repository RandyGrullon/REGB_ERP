import Link from 'next/link'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  Mono,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { cargarSalud } from '@/lib/control-datos'
import { requireProvider } from '@/lib/provider-guard'
import { despacharAhora } from '../solicitudes-actions'
import { TEMAS_ATENDIDOS } from '@/lib/despachador'
import { usd } from '@/components/ControlBits'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Salud · REGB Control' }

/**
 * Salud de la operacion: lo que hay que mirar cada manana.
 *
 * Ordenado por lo que le explota primero al cliente, no por lo que es mas
 * facil de medir. Un cliente sin NCF no puede facturar hoy; un respaldo
 * viejo solo duele el dia que hace falta, pero ese dia duele entero.
 */

const fecha = (iso: string | null) =>
  iso === null
    ? null
    : new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })

const diasDesde = (iso: string | null): number | null =>
  iso === null ? null : Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)

export default async function SaludPage() {
  await requireProvider()
  const s = await cargarSalud()

  const respaldosViejos = s.respaldos.filter((r) => {
    const d = diasDesde(r.ultimo)
    return d === null || d > 7
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <Icon name="monitor_heart" size={22} className="text-[var(--color-accent-plum)]" />
          Salud de la operacion
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Lo que hay que mirar cada manana, ordenado por lo que le explota primero al cliente.
        </p>
      </div>

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Clientes sin NCF"
          value={String(s.ncfEnRiesgo.filter((n) => n.motivo !== 'por agotarse').length)}
          hint="no pueden facturar"
        />
        <StatCard
          label="Respaldos atrasados"
          value={String(respaldosViejos.length)}
          hint="mas de 7 dias o ninguno"
        />
        <StatCard
          label="Eventos atascados"
          value={String(s.eventos.pendientes + s.eventos.muertos)}
          hint={`${s.eventos.muertos} descartados`}
        />
        <StatCard
          label="Por cobrar"
          value={usd(s.facturasProveedor.porCobrar)}
          hint={`${s.facturasProveedor.vencidas} vencidas`}
        />
      </section>

      {/* Lo mas urgente arriba: sin comprobante fiscal el negocio para. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Icon name="verified" size={18} className="text-[var(--color-text-muted)]" />
            Comprobantes fiscales en riesgo
          </CardTitle>
        </CardHeader>
        <CardBody>
          {s.ncfEnRiesgo.length === 0 ? (
            <p className="py-2 text-sm text-[var(--color-text-muted)]">
              Ningun cliente en riesgo. Todas las secuencias vigentes y con margen.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
                Pedirle a la DGII una autorizacion nueva toma dias. Un cliente que se queda sin NCF
                deja de facturar ese mismo dia — llamalo antes de que pase, no despues.
              </p>
              <Table>
                <THead>
                  <TR>
                    <TH>Cliente</TH>
                    <TH>Tipo</TH>
                    <TH numeric>Quedan</TH>
                    <TH>Vence</TH>
                    <TH>Estado</TH>
                  </TR>
                </THead>
                <TBody>
                  {s.ncfEnRiesgo.map((n, i) => (
                    <TR key={`${n.slug}-${n.tipo}-${i}`}>
                      <TD>
                        <Link
                          href={`/control/${n.slug}`}
                          className="text-[var(--color-text-link)] hover:underline"
                        >
                          {n.tenant}
                        </Link>
                      </TD>
                      <TD>
                        <Mono>{n.tipo}</Mono>
                      </TD>
                      <TD numeric>
                        <span className="tabular font-semibold">{n.restantes}</span>
                      </TD>
                      <TD>{fecha(`${n.vence}T12:00:00`)}</TD>
                      <TD>
                        <Badge tone={n.motivo === 'por agotarse' ? 'warning' : 'danger'}>
                          {n.motivo}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icon name="backup" size={18} className="text-[var(--color-text-muted)]" />
              Respaldos
            </CardTitle>
          </CardHeader>
          <CardBody>
            <Table>
              <THead>
                <TR>
                  <TH>Cliente</TH>
                  <TH>Ultimo</TH>
                  <TH numeric>Total</TH>
                </TR>
              </THead>
              <TBody>
                {s.respaldos.map((r) => {
                  const d = diasDesde(r.ultimo)
                  return (
                    <TR key={r.slug}>
                      <TD>{r.tenant}</TD>
                      <TD>
                        {r.ultimo === null ? (
                          <span className="text-[var(--color-semantic-text-danger)]">nunca</span>
                        ) : (
                          <span
                            className={
                              (d ?? 0) > 7
                                ? 'text-[var(--color-semantic-text-warning)]'
                                : 'text-[var(--color-text-secondary)]'
                            }
                          >
                            {fecha(r.ultimo)}
                          </span>
                        )}
                      </TD>
                      <TD numeric>
                        <span className="tabular">{r.total}</span>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icon name="bolt" size={18} className="text-[var(--color-text-muted)]" />
              Bus de eventos
            </CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-secondary)]">Pendientes</dt>
                <dd className="tabular font-semibold">{s.eventos.pendientes}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-secondary)]">Con reintentos</dt>
                <dd className="tabular font-semibold text-[var(--color-semantic-text-warning)]">
                  {s.eventos.fallidos}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-secondary)]">Descartados</dt>
                <dd className="tabular font-semibold text-[var(--color-semantic-text-danger)]">
                  {s.eventos.muertos}
                </dd>
              </div>
            </dl>

            {s.ultimosErrores.length > 0 && (
              <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                <p className="mb-1 text-xs font-semibold text-[var(--color-text-primary)]">
                  Ultimos errores
                </p>
                <ul className="space-y-1">
                  {s.ultimosErrores.map((e, i) => (
                    <li key={i} className="text-xs text-[var(--color-text-secondary)]">
                      <Mono>{e.topic}</Mono> · {e.tenant ?? 'sin cliente'} ·{' '}
                      <span className="text-[var(--color-semantic-text-danger)]">
                        {e.error.slice(0, 80)}
                      </span>{' '}
                      ({e.intentos} intentos)
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <form action={despacharAhora} className="mt-3">
              <BotonEnvio
                
                className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                <Icon name="play_arrow" size={16} />
                Despachar ahora
              </BotonEnvio>
            </form>

            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              El bus atiende {TEMAS_ATENDIDOS.length} temas; los que nadie escucha se cierran en vez
              de reintentarse para siempre — un outbox lleno de eventos que nadie quiere parece una
              averia. <Mono>event_outbox</Mono> sigue siendo la unica senal de error que persiste:
              si algo falla fuera del bus, no queda rastro.
            </p>
          </CardBody>
        </Card>
      </div>

      {s.impersonacionesAbiertas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icon
                name="visibility"
                size={18}
                filled
                className="text-[var(--color-semantic-text-danger)]"
              />
              Sesiones de impersonacion abiertas
            </CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-2 text-sm text-[var(--color-text-secondary)]">
              Alguien esta operando dentro de un cliente ahora mismo. Cerrarlas al terminar no es
              formalidad: mientras esten abiertas, ese usuario ve datos que no son suyos.
            </p>
            <Table>
              <THead>
                <TR>
                  <TH>Cliente</TH>
                  <TH>Quien</TH>
                  <TH>Desde</TH>
                  <TH>Razon</TH>
                </TR>
              </THead>
              <TBody>
                {s.impersonacionesAbiertas.map((im, i) => (
                  <TR key={i}>
                    <TD>{im.tenant}</TD>
                    <TD>{im.usuario}</TD>
                    <TD>{new Date(im.desde).toLocaleString('es-DO')}</TD>
                    <TD>
                      <span className="text-xs">{im.razon}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
