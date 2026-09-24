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
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearPeriodoForm, eliminarPeriodoForm } from './actions'
import { ESTADO_PERIODO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nómina · REGB ERP' }

interface PeriodoRow {
  id: string
  period_start: string
  period_end: string
  pay_date: string
  status: string
  lineas: string
  total_neto: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Nomina (modulo 62): periodos, procesar y ver el desglose de cada quien. */
export default async function PayrollPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'payroll')

  const [periodos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const p = await tx<PeriodoRow[]>`
      select pp.id, pp.period_start::text, pp.period_end::text, pp.pay_date::text, pp.status,
             (select count(*) from public.payroll_lines l where l.period_id = pp.id)::text as lineas,
             coalesce((select sum(l.net_salary) from public.payroll_lines l
                        where l.period_id = pp.id), 0)::text as total_neto
      from public.payroll_periods pp
      where pp.tenant_id = ${ctx.tenantId}
      order by pp.period_end desc
      limit 100`
    return [p] as const
  })

  const puedeCrear = exigir(ctx, 'payroll', 'payroll.run').ok
  // Los volantes de todos piden exportar, como declara el manifest (0138).
  const puedeVerVolantes = exigir(ctx, 'payroll', 'payroll.export').ok
  const qs = ctx.demoQs
  const conQs = (ruta: string, extra?: string) =>
    `${ruta}${qs}${extra ? `${qs ? '&' : '?'}${extra}` : ''}`
  const hayBorrador = periodos.some((p) => p.status === 'draft')
  const claseBotonSecundario =
    'flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/payroll">
      <div className="space-y-5">
        <PageHeader
          icon="group"
          title="Nómina"
          description="Cada periodo paga su parte del mes: la quincena, medio salario. TSS e ISR con las tasas vigentes. Un periodo procesado queda fijo: se corrige con el siguiente."
          actions={
            <div className="flex flex-wrap gap-2">
              {puedeCrear && hayBorrador && (
                <a
                  href={conQs('/payroll/run')}
                  className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  <Icon name="calculate" size={18} />
                  Procesar nómina
                </a>
              )}
              {puedeVerVolantes && (
                <a href={conQs('/payroll/reports')} className={claseBotonSecundario}>
                  <Icon name="receipt_long" size={18} />
                  Ver volantes
                </a>
              )}
            </div>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Periodos" value={String(periodos.length)} />
          <StatCard
            label="Procesados"
            value={String(periodos.filter((p) => p.status !== 'draft').length)}
          />
          <StatCard
            label="Último neto procesado"
            value={`RD$ ${money(Number(periodos.find((p) => p.status !== 'draft')?.total_neto ?? 0))}`}
          />
        </section>

        {periodos.length === 0 ? (
          <EmptyState
            icon="group"
            title="Todavía no hay ningún periodo de nómina"
            description="Crea el primero abajo con sus fechas. Después, con «Procesar nómina», se calcula la TSS y el ISR de cada empleado."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Período</TH>
                <TH>Fecha de pago</TH>
                <TH numeric>Empleados</TH>
                <TH numeric>Total neto</TH>
                <TH>Estado</TH>
                {puedeCrear && (
                  <TH>
                    <span className="sr-only">Acciones</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {periodos.map((p) => {
                const e = ESTADO_PERIODO[p.status] ?? { label: p.status, tone: 'neutral' as const }
                return (
                  <TR key={p.id}>
                    <TD className="text-[var(--color-text-primary)]">
                      {fecha(p.period_start)} – {fecha(p.period_end)}
                    </TD>
                    <TD>{fecha(p.pay_date)}</TD>
                    <TD numeric>
                      <span className="tabular">{p.lineas}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{money(Number(p.total_neto))}</span>
                    </TD>
                    <TD>
                      <Badge tone={e.tone}>{e.label}</Badge>
                    </TD>
                    {puedeCrear && (
                      <TD>
                        {p.status === 'draft' ? (
                          <div className="flex flex-wrap gap-1.5">
                            <a
                              href={conQs('/payroll/run', `period=${p.id}`)}
                              className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-brand)] px-3 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                            >
                              <Icon name="calculate" size={14} />
                              Procesar
                            </a>
                            <form action={eliminarPeriodoForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="periodId" value={p.id} />
                              <BotonEnvio
                                title="Borra este borrador para crearlo con otras fechas. Un periodo procesado no se borra."
                                className="flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                              >
                                <Icon name="delete" size={14} />
                                Borrar
                              </BotonEnvio>
                            </form>
                          </div>
                        ) : puedeVerVolantes ? (
                          <a
                            href={conQs('/payroll/reports', `period=${p.id}`)}
                            className="text-xs text-[var(--color-text-link)] hover:underline"
                          >
                            Ver volantes
                          </a>
                        ) : null}
                      </TD>
                    )}
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeCrear && (
          <Card>
            <CardHeader>
              <CardTitle>Crear período</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearPeriodoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Desde
                  <input name="periodStart" type="date" required className={claseInput} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Hasta
                  <input name="periodEnd" type="date" required className={claseInput} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha de pago
                  <input name="payDate" type="date" required className={claseInput} />
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Crear
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Quincenal: del 1 al 15 y del 16 al fin de mes, medio salario cada una. Mensual: un
                salario. Un periodo no puede cruzarse con otro: el mismo dia no se paga dos veces.
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Después de crearlo, usa «Procesar» en su fila: primero ves lo que le toca a cada
                empleado y luego lo confirmas. Si te equivocaste de fechas, borra el borrador y
                créalo otra vez.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
