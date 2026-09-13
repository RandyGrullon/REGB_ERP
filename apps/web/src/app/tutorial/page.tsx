import { Badge, Card, CardBody, StatCard } from '@regb/ui'
import { toursFor, type Tour } from '@regb/core'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { avanzarPaso, reiniciarTour, retomarTour, retrocederPaso, saltarTour } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tutorial · REGB ERP' }

interface ProgressRow {
  tour_id: string
  step: number
  completed: boolean
  skipped: boolean
  xp_awarded: number
}

const btnBase =
  'h-9 rounded-[var(--radius-md)] px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'
const btnSec = `${btnBase} border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)]`
const btnPri = `${btnBase} bg-[var(--color-brand)] font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]`

/**
 * Tutorial (S13): tours por modulo con progreso que se guarda.
 *
 * La puerta F2 exige que se complete, se salte y se retome bien. El
 * contenido vive en @regb/core/tours como datos, no aqui.
 */
export default async function TutorialPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'tour')

  const rows = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<ProgressRow[]>`
      select tour_id, step, completed, skipped, xp_awarded
      from public.tour_progress
      where tenant_id = ${ctx.tenantId} and user_id = ${ctx.userId}`,
  )

  const progreso = new Map(rows.map((r) => [r.tour_id, r]))
  const tours = toursFor(ctx.licensedModules)
  const puedeEditar = exigir(ctx, 'tour', 'tour.edit').ok

  const completados = tours.filter((t) => progreso.get(t.id)?.completed).length
  const xpTotal = rows.reduce((a, r) => a + r.xp_awarded, 0)
  const xpPosible = tours.reduce((a, t) => a + t.xp, 0)

  const campos = (tour: Tour, step: number) => (
    <>
      <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
      <input type="hidden" name="tourId" value={tour.id} />
      <input type="hidden" name="step" value={step} />
    </>
  )

  return (
    <Shell {...shell} activePath="/tutorial">
      <div className="max-w-3xl space-y-5">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Tutorial</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Guias cortas dentro del propio ERP. Puedes saltar cualquiera y retomarla cuando quieras.
          </p>
        </div>

        <section aria-label="Progreso" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            label="Completados"
            value={`${completados}/${tours.length}`}
            hint="guias terminadas"
          />
          <StatCard label="Puntos" value={`${xpTotal}`} hint={`de ${xpPosible} posibles`} />
          <StatCard
            label="Disponibles"
            value={String(tours.length)}
            hint="segun tus modulos activos"
          />
        </section>

        <div className="space-y-4">
          {tours.map((tour) => {
            const p = progreso.get(tour.id)
            const step = Math.min(p?.step ?? 0, tour.steps.length - 1)
            const completado = p?.completed ?? false
            const saltado = p?.skipped ?? false
            const paso = tour.steps[step]

            return (
              <Card key={tour.id}>
                <CardBody className="pt-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h2 className="flex flex-wrap items-center gap-2 font-semibold text-[var(--color-text-primary)]">
                        {tour.title}
                        {completado && <Badge tone="success">Completado</Badge>}
                        {saltado && !completado && <Badge tone="neutral">Saltado</Badge>}
                      </h2>
                      <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
                        {tour.summary}
                      </p>
                    </div>
                    <Badge tone="brand" dot={false}>
                      {tour.xp} pts
                    </Badge>
                  </div>

                  {/* Barra de progreso */}
                  <div
                    className="mt-3 flex gap-1"
                    role="progressbar"
                    aria-valuenow={completado ? tour.steps.length : step}
                    aria-valuemin={0}
                    aria-valuemax={tour.steps.length}
                    aria-label={`Progreso de ${tour.title}`}
                  >
                    {tour.steps.map((_, i) => (
                      <span
                        key={i}
                        className="h-1 flex-1 rounded-full"
                        style={{
                          background:
                            completado || i < step
                              ? 'var(--color-brand)'
                              : i === step && !saltado
                                ? 'var(--color-brand-bright)'
                                : 'var(--color-surface-overlay)',
                        }}
                      />
                    ))}
                  </div>

                  {completado ? (
                    <div className="mt-3 flex items-center gap-2">
                      <p className="flex-1 text-sm text-[var(--color-text-secondary)]">
                        Terminaste esta guia. Puedes repasarla cuando quieras.
                      </p>
                      {puedeEditar && (
                        <form action={reiniciarTour}>
                          {campos(tour, 0)}
                          <BotonEnvio  className={btnSec}>
                            Repasar
                          </BotonEnvio>
                        </form>
                      )}
                    </div>
                  ) : saltado ? (
                    <div className="mt-3 flex items-center gap-2">
                      <p className="flex-1 text-sm text-[var(--color-text-secondary)]">
                        La saltaste en el paso {step + 1} de {tour.steps.length}.
                      </p>
                      {puedeEditar && (
                        <form action={retomarTour}>
                          {campos(tour, step)}
                          <BotonEnvio  className={btnPri}>
                            Retomar
                          </BotonEnvio>
                        </form>
                      )}
                    </div>
                  ) : (
                    paso && (
                      <div className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-surface-overlay)] p-4">
                        <p className="text-xs text-[var(--color-text-muted)]">
                          Paso {step + 1} de {tour.steps.length}
                        </p>
                        <h3 className="mt-1 font-medium text-[var(--color-text-primary)]">
                          {paso.title}
                        </h3>
                        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                          {paso.body}
                        </p>
                        {paso.tip && (
                          <p className="mt-2 border-l-2 border-[var(--color-brand)] pl-3 text-xs text-[var(--color-text-secondary)]">
                            <strong>De quien ya paso por esto:</strong> {paso.tip}
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {paso.action && (
                            <a
                              /*
                                El tour y el paso viajan en la URL para
                                que la guia siga DENTRO de la pantalla de
                                destino. Antes se aterrizaba alli sin el
                                paso y habia que volver aqui para leer el
                                siguiente: un tutorial que obliga a salirse
                                de la pantalla no lo termina nadie.
                              */
                              href={`${paso.action.path}${ctx.demoQs === '' ? '?' : `${ctx.demoQs}&`}tour=${encodeURIComponent(tour.id)}&paso=${step + 1}`}
                              className={btnPri}
                            >
                              {paso.action.label}
                            </a>
                          )}
                          {puedeEditar && (
                            <>
                              {step > 0 && (
                                <form action={retrocederPaso}>
                                  {campos(tour, step)}
                                  <BotonEnvio  className={btnSec}>
                                    Atras
                                  </BotonEnvio>
                                </form>
                              )}
                              <form action={avanzarPaso}>
                                {campos(tour, step)}
                                <BotonEnvio  className={btnSec}>
                                  {step + 1 === tour.steps.length ? 'Terminar' : 'Siguiente'}
                                </BotonEnvio>
                              </form>
                              <form action={saltarTour} className="ml-auto">
                                {campos(tour, step)}
                                <BotonEnvio
                                  
                                  className="text-xs text-[var(--color-text-muted)] underline">
                                  Saltar esta guia
                                </BotonEnvio>
                              </form>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      </div>
    </Shell>
  )
}
