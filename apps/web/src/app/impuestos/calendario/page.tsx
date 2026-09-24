import {
  Badge,
  Icon,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Toolbar,
  ToolbarActions,
} from '@regb/ui'
import {
  calendarioFiscal,
  periodoFiscal,
  type Formulario,
  type ObligacionFiscal,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { PUERTAS_VENTAS_DGII, primeraPuerta } from '@/lib/fiscal'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { BotonEnvio } from '@/components/BotonEnvio'
import { registrarInformativoForm } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Calendario fiscal · REGB ERP' }

interface FilingEstado {
  form: string
  period: string
  status: string
}

const legible = (p: string) =>
  new Date(`${p.slice(0, 4)}-${p.slice(4, 6)}-01T12:00:00`).toLocaleDateString('es-DO', {
    month: 'long',
    year: 'numeric',
  })

const fechaLarga = (d: Date) =>
  d.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'long' })

/** El periodo siguiente a `AAAAMM`, rodando de diciembre a enero. */
function siguientePeriodo(p: string): string {
  const anio = Number(p.slice(0, 4))
  const mes = Number(p.slice(4, 6))
  const d = new Date(anio, mes, 1)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

const QUE_ES: Record<Formulario, string> = {
  'IR-17': 'Retenciones de ISR del mes',
  '606': 'Compras de bienes y servicios',
  '607': 'Ventas de bienes y servicios',
  '608': 'Comprobantes anulados',
  'IT-1': 'Declaracion y pago del ITBIS',
}

const claseInput =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

/**
 * Calendario fiscal (modulo 24): que vence, cuando, y si ya se entrego.
 *
 * NO rehace los formatos 606/607/608 -ya existen en /cobrar/dgii y, para
 * quien solo tiene caja, en /pos/dgii-: los ENLAZA. El estado sale de tax_filings, que es donde alguien anota que ya
 * subio el archivo, porque la DGII no le avisa al sistema.
 *
 * El vencimiento solo corre de sabado o domingo al lunes. Los feriados que
 * se trasladan por ley no se conocen aqui: mejor un vencimiento un dia
 * antes de tiempo que uno inventado.
 */
export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { periodo?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'taxes')

  // Por defecto el mes anterior: es el que se esta declarando ahora mismo.
  // Contado en RD, no con el mes del servidor (UTC).
  const hoy = new Date()
  const actual = periodoFiscal(hoy)
  const periodoDefecto = periodoFiscal(
    new Date(Date.UTC(Number(actual.slice(0, 4)), Number(actual.slice(4, 6)) - 2, 15)),
  )
  const periodo = /^[0-9]{6}$/.test(params.periodo ?? '') ? params.periodo! : periodoDefecto
  const siguiente = siguientePeriodo(periodo)

  const estados = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<FilingEstado[]>`
      select form, period, status
      from public.tax_filings
      where tenant_id = ${ctx.tenantId} and period in (${periodo}, ${siguiente})`,
  )

  const estadoDe = (o: ObligacionFiscal) =>
    estados.find((e) => e.form === o.form && e.period === o.periodo)?.status ?? 'pending'

  const puedeRegistrar = exigir(ctx, 'taxes', 'taxes.filing.close').ok
  // La pantalla de reportes que ESTE rol puede abrir: Por cobrar o la Caja
  // (0129). Un colmado sin `ar` tambien declara su 607.
  const reportes = primeraPuerta(ctx, PUERTAS_VENTAS_DGII)
  const qs = ctx.demoQs
  const sep = qs === '' ? '?' : '&'

  const bloques = [periodo, siguiente].map((p) => ({
    periodo: p,
    obligaciones: calendarioFiscal(p, hoy),
  }))

  const pendientes = bloques.flatMap((b) => b.obligaciones.filter((o) => estadoDe(o) === 'pending'))
  const vencidas = pendientes.filter((o) => o.vencida)
  const proxima = pendientes
    .filter((o) => !o.vencida)
    .sort((a, b) => a.diasRestantes - b.diasRestantes)[0]

  return (
    <Shell {...shell} activePath="/impuestos/calendario">
      <div className="space-y-5">
        <PageHeader
          icon="event"
          title="Calendario fiscal"
          description="Que se le debe a la DGII este periodo y el que viene, con la fecha limite ya corrida al lunes cuando cae fin de semana."
          crumbs={[{ label: 'Impuestos', href: `/impuestos${qs}` }, { label: 'Calendario' }]}
        />

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            Periodo
            <input
              name="periodo"
              defaultValue={periodo}
              inputMode="numeric"
              pattern="[0-9]{6}"
              title="Periodo en formato AAAAMM, por ejemplo 202609"
              className={`tabular w-32 text-center ${claseInput}`}
            />
          </label>
          <ToolbarActions
            hasFilters={periodo !== periodoDefecto}
            clearHref={`/impuestos/calendario${qs}`}
          />
        </Toolbar>

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Lo proximo que vence"
            value={proxima ? proxima.form : 'nada pendiente'}
            {...(proxima
              ? {
                  hint: `${fechaLarga(proxima.vence)} · ${proxima.diasRestantes} dia${
                    proxima.diasRestantes === 1 ? '' : 's'
                  }`,
                }
              : {})}
          />
          <StatCard
            label="Pendientes"
            value={String(pendientes.length)}
            hint="en los dos periodos"
          />
          <StatCard label="Vencidas" value={String(vencidas.length)} hint="y sin anotar" />
        </section>

        <div
          className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-sm"
          role="note"
        >
          <Icon name="info" size={20} className="shrink-0 text-[var(--color-text-muted)]" />
          <p className="text-[var(--color-text-secondary)]">
            El sistema no se entera solo de que subiste un archivo: la DGII no le avisa a nadie. El
            estado de aqui es lo que{' '}
            <strong className="text-[var(--color-text-primary)]">tu</strong> anotas. Las fechas
            corren de fin de semana al lunes, pero{' '}
            <strong className="text-[var(--color-text-primary)]">no conocen los feriados</strong>:
            si el lunes es feriado, el plazo real puede ser un día más.
          </p>
        </div>

        {bloques.map((b) => (
          <section key={b.periodo} aria-labelledby={`p-${b.periodo}`} className="space-y-2">
            <h2
              id={`p-${b.periodo}`}
              className="text-sm font-semibold capitalize text-[var(--color-text-primary)]"
            >
              {legible(b.periodo)}
            </h2>
            <Table>
              <THead>
                <TR>
                  <TH>Formulario</TH>
                  <TH>Vence</TH>
                  <TH>Estado</TH>
                  <TH>&nbsp;</TH>
                </TR>
              </THead>
              <TBody>
                {b.obligaciones.map((o) => {
                  const estado = estadoDe(o)
                  const listo = estado !== 'pending'
                  const esInformativo = o.form !== 'IT-1'
                  return (
                    <TR key={`${b.periodo}-${o.form}`} className={listo ? 'opacity-60' : ''}>
                      <TD>
                        <span className="font-medium text-[var(--color-text-primary)]">
                          {o.form}
                        </span>
                        <span className="block text-xs text-[var(--color-text-muted)]">
                          {QUE_ES[o.form]}
                        </span>
                      </TD>
                      <TD>
                        <span className="text-sm text-[var(--color-text-secondary)]">
                          {fechaLarga(o.vence)}
                        </span>
                        <span className="block text-xs text-[var(--color-text-muted)]">
                          {o.vencida
                            ? `hace ${Math.abs(o.diasRestantes)} día${Math.abs(o.diasRestantes) === 1 ? '' : 's'}`
                            : `faltan ${o.diasRestantes} día${o.diasRestantes === 1 ? '' : 's'}`}
                        </span>
                      </TD>
                      <TD>
                        {listo ? (
                          <Badge tone="success" dot={false}>
                            {estado === 'paid' ? 'pagada' : 'presentada'}
                          </Badge>
                        ) : o.vencida ? (
                          <Badge tone="danger">vencida</Badge>
                        ) : (
                          <Badge tone="warning">pendiente</Badge>
                        )}
                      </TD>
                      <TD>
                        <span className="flex flex-wrap items-center gap-3">
                          {o.form === 'IT-1' ? (
                            <a
                              href={`/impuestos/liquidacion${qs}${sep}periodo=${b.periodo}`}
                              className="text-xs text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                            >
                              Ir a la liquidacion
                            </a>
                          ) : (
                            o.form !== 'IR-17' &&
                            reportes && (
                              <a
                                href={`${reportes.ruta}${qs}${sep}periodo=${b.periodo}`}
                                className="text-xs text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                              >
                                Descargar en Reportes DGII
                              </a>
                            )
                          )}
                          {puedeRegistrar && esInformativo && !listo && (
                            <form action={registrarInformativoForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="form" value={o.form} />
                              <input type="hidden" name="period" value={b.periodo} />
                              <BotonEnvio className="text-xs text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                                Ya lo presente
                              </BotonEnvio>
                            </form>
                          )}
                        </span>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </section>
        ))}
      </div>
    </Shell>
  )
}
