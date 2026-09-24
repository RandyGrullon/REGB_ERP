import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  PageHeader,
  StatCard,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { procesarPeriodoForm } from '../actions'
import { calcularNomina, ErrorNomina, type NominaCalculada } from '../calculo'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Procesar nómina · REGB ERP' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PeriodoDraft {
  id: string
  period_start: string
  period_end: string
  pay_date: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Procesar nomina (modulo 62): previsualiza el periodo mas antiguo en
 * borrador con EXACTAMENTE el calculo que va a guardar procesarPeriodo()
 * (calculo.ts): dias pagados, reembolsos, TSS con sus dos topes, ISR,
 * prestamos y neto.
 */
export default async function ProcesarNominaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { period?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'payroll', 'payroll.run')
  // «Procesar» en la fila de un borrador trae su id; sin id (o si ya no es
  // borrador), el mas antiguo en borrador, como antes.
  const elegido = params.period && UUID.test(params.period) ? params.period : null

  const { periodo, calculo, problema } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [p] = await tx<PeriodoDraft[]>`
      select id, period_start::text, period_end::text, pay_date::text
      from public.payroll_periods
      where tenant_id = ${ctx.tenantId} and status = 'draft'
      order by (id = ${elegido ?? '00000000-0000-0000-0000-000000000000'}::uuid) desc, period_end
      limit 1`
    if (!p) return { periodo: null, calculo: null, problema: null }
    try {
      return { periodo: p, calculo: await calcularNomina(tx, ctx.tenantId, p), problema: null }
    } catch (e) {
      if (e instanceof ErrorNomina) return { periodo: p, calculo: null, problema: e.message }
      throw e
    }
  })

  const puedeProcesar = exigir(ctx, 'payroll', 'payroll.run').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const lineas = calculo?.lineas ?? []
  const totalNeto = lineas.reduce((a, l) => a + l.neto, 0)
  const vigencia = calculo?.params.vigencia

  return (
    <Shell {...shell} activePath="/payroll">
      <div className="space-y-5">
        <PageHeader
          icon="calculate"
          title="Procesar nómina"
          description="Lo que le toca a cada empleado en el periodo: su parte del mes, TSS, ISR, préstamos y reembolsos. Revísalo y confírmalo; después de procesar, el periodo queda fijo."
          crumbs={[{ label: 'Nómina', href: `/payroll${qs}` }, { label: 'Procesar' }]}
        />

        {!periodo ? (
          <EmptyState
            icon="calculate"
            title="No hay ningún periodo en borrador"
            description="Crea uno desde la pantalla de Nómina antes de procesar."
          />
        ) : (
          <>
            <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Periodo"
                value={`${fecha(periodo.period_start)} – ${fecha(periodo.period_end)}`}
              />
              <StatCard label="Parte del mes" value={calculo ? fraccionEnPalabras(calculo) : '—'} />
              <StatCard label="Empleados" value={String(lineas.length)} />
              <StatCard label="Neto proyectado" value={`RD$ ${money(totalNeto)}`} />
            </section>

            {problema ? (
              <Card>
                <CardBody className="flex items-start gap-3 text-sm">
                  <Icon
                    name="error"
                    size={20}
                    className="text-[var(--color-semantic-text-danger)]"
                  />
                  <div className="space-y-1">
                    <p className="font-semibold text-[var(--color-text-primary)]">
                      Este período no se puede procesar
                    </p>
                    <p className="text-[var(--color-text-secondary)]">{problema}</p>
                  </div>
                </CardBody>
              </Card>
            ) : lineas.length === 0 ? (
              <EmptyState
                icon="check_circle"
                title="No hay a quien pagarle en este periodo"
                description="Nadie estuvo contratado esos dias, o todos ya tienen su linea."
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Vista previa</CardTitle>
                </CardHeader>
                <CardBody className="space-y-4">
                  {vigencia && (
                    <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      <span>
                        Tasas vigentes desde {fecha(vigencia.desde)} · tope SFS RD${' '}
                        {money(calculo!.params.sfsCap)} · tope AFP RD${' '}
                        {money(calculo!.params.afpCap)}
                      </span>
                      <Badge tone={vigencia.verificado ? 'success' : 'warning'}>
                        {vigencia.verificado ? 'Verificadas' : 'Por confirmar'}
                      </Badge>
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                          <th className="py-2 pr-3">Empleado</th>
                          <th className="py-2 pr-3 text-right">Días</th>
                          <th className="py-2 pr-3 text-right">Bruto</th>
                          <th className="py-2 pr-3 text-right">Reembolsos</th>
                          <th className="py-2 pr-3 text-right">TSS</th>
                          <th className="py-2 pr-3 text-right">ISR</th>
                          <th className="py-2 pr-3 text-right">Préstamos</th>
                          <th className="py-2 text-right">Neto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineas.map((l) => (
                          <tr key={l.employeeId} className="border-b border-[var(--color-border)]">
                            <td className="py-2 pr-3 text-[var(--color-text-primary)]">
                              {l.nombre}
                              {!l.completo && l.dias > 0 && (
                                <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                                  prorrateado
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-right tabular">{l.dias}</td>
                            <td className="py-2 pr-3 text-right tabular">{money(l.bruto)}</td>
                            <td className="py-2 pr-3 text-right tabular">{money(l.reembolsos)}</td>
                            <td className="py-2 pr-3 text-right tabular text-[var(--color-semantic-text-warning)]">
                              {money(l.tss)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular text-[var(--color-semantic-text-warning)]">
                              {money(l.isr)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular">{money(l.otros)}</td>
                            <td className="py-2 text-right tabular font-semibold">
                              {money(l.neto)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {puedeProcesar && (
                    <form action={procesarPeriodoForm}>
                      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                      <input type="hidden" name="periodId" value={periodo.id} />
                      <BotonEnvio
                        title="Calcula y guarda estas lineas. El periodo queda fijo despues de procesar."
                        className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        <Icon name="check" size={18} />
                        Procesar período
                      </BotonEnvio>
                    </form>
                  )}
                </CardBody>
              </Card>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}

function fraccionEnPalabras(c: NominaCalculada): string {
  const f = c.fraccionPeriodo
  if (f === 1) return 'Un mes'
  if (f === 0.5) return 'Media (quincena)'
  return `${Math.round(f * 30)} de 30 días`
}
