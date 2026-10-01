import {
  Badge,
  FilterSelect,
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
import { opcionesDePeriodo } from '../periodos'
import { registrarInformativoForm } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Calendario fiscal · REGB ERP' }

interface FilingEstado {
  form: string
  period: string
  status: string
}

/** "agosto de 2026" → "Agosto de 2026": solo la primera letra, no cada palabra. */
const legible = (p: string) => {
  const t = new Date(`${p.slice(0, 4)}-${p.slice(4, 6)}-01T12:00:00`).toLocaleDateString('es-DO', {
    month: 'long',
    year: 'numeric',
  })
  return t.charAt(0).toUpperCase() + t.slice(1)
}

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
  'IT-1': 'Declaración y pago del ITBIS',
}

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
  // El selector de mes manda `AAAA-MM`; los enlaces de otras pantallas, `AAAAMM`.
  const pedido = (params.periodo ?? '').replace('-', '')
  const periodo = /^[0-9]{6}$/.test(pedido) ? pedido : periodoDefecto
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
          description="Qué se le debe a la DGII este período y el que viene, con la fecha límite ya corrida al lunes cuando cae en fin de semana."
          crumbs={[{ label: 'Impuestos', href: `/impuestos${qs}` }, { label: 'Calendario' }]}
        />

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <FilterSelect label="Período" name="periodo" defaultValue={periodo}>
            {opcionesDePeriodo(hoy, periodo).map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </FilterSelect>
          <ToolbarActions
            hasFilters={periodo !== periodoDefecto}
            clearHref={`/impuestos/calendario${qs}`}
          />
        </Toolbar>

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Lo próximo que vence"
            value={proxima ? proxima.form : 'nada pendiente'}
            {...(proxima
              ? {
                  hint: `${fechaLarga(proxima.vence)} · ${proxima.diasRestantes} día${
                    proxima.diasRestantes === 1 ? '' : 's'
                  }`,
                }
              : {})}
          />
          <StatCard
            label="Pendientes"
            value={String(pendientes.length)}
            hint="en los dos períodos"
          />
          <StatCard
            label="Vencidas"
            value={String(vencidas.length)}
            hint={vencidas.length === 0 ? 'todo al día' : 'y sin anotar como presentadas'}
          />
        </section>

        <div
          className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-sm"
          role="note"
        >
          <Icon name="info" size={20} className="shrink-0 text-[var(--color-text-muted)]" />
          <p className="text-[var(--color-text-secondary)]">
            El sistema no se entera solo de que subiste un archivo: la DGII no le avisa a nadie. El
            estado de aquí es lo que{' '}
            <strong className="text-[var(--color-text-primary)]">tú</strong> anotas. Las fechas
            corren de fin de semana al lunes, pero{' '}
            <strong className="text-[var(--color-text-primary)]">no conocen los feriados</strong>:
            si el lunes es feriado, el plazo real puede ser un día más.
          </p>
        </div>

        {bloques.map((b) => (
          <section key={b.periodo} aria-labelledby={`p-${b.periodo}`} className="space-y-2">
            <h2
              id={`p-${b.periodo}`}
              className="text-sm font-semibold text-[var(--color-text-primary)]"
            >
              {legible(b.periodo)}
            </h2>
            <Table className="md:min-w-[680px]">
              <THead>
                <TR>
                  <TH>Formulario</TH>
                  <TH>Vence</TH>
                  <TH className="hidden md:table-cell">Estado</TH>
                  <TH className="hidden md:table-cell">
                    <span className="sr-only">Acciones</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {b.obligaciones.map((o) => {
                  const estado = estadoDe(o)
                  const listo = estado !== 'pending'
                  const esInformativo = o.form !== 'IT-1'
                  const insignia = listo ? (
                    <Badge tone="success" dot={false}>
                      {estado === 'paid' ? 'Pagada' : 'Presentada'}
                    </Badge>
                  ) : o.vencida ? (
                    <Badge tone="danger">Vencida</Badge>
                  ) : (
                    <Badge tone="warning">Pendiente</Badge>
                  )
                  const acciones = (
                    <>
                      {o.form === 'IT-1' ? (
                        <a
                          href={`/impuestos/liquidacion${qs}${sep}periodo=${b.periodo}`}
                          className="text-xs text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                        >
                          Ir a la liquidación
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
                            Ya lo presenté
                          </BotonEnvio>
                        </form>
                      )}
                    </>
                  )
                  return (
                    <TR key={`${b.periodo}-${o.form}`} className={listo ? 'opacity-60' : ''}>
                      <TD>
                        <span className="font-medium text-[var(--color-text-primary)]">
                          {o.form}
                        </span>
                        <span className="block text-xs text-[var(--color-text-muted)]">
                          {QUE_ES[o.form]}
                        </span>
                        {/* En el teléfono, el estado y lo que sigue van aquí
                            mismo: dos columnas más no caben en 375 px. */}
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 md:hidden">
                          {insignia}
                          {acciones}
                        </span>
                      </TD>
                      <TD>
                        <span className="text-sm text-[var(--color-text-secondary)] md:whitespace-nowrap">
                          {fechaLarga(o.vence)}
                        </span>
                        <span className="block text-xs text-[var(--color-text-muted)]">
                          {o.vencida
                            ? `hace ${Math.abs(o.diasRestantes)} día${Math.abs(o.diasRestantes) === 1 ? '' : 's'}`
                            : `faltan ${o.diasRestantes} día${o.diasRestantes === 1 ? '' : 's'}`}
                        </span>
                      </TD>
                      <TD className="hidden md:table-cell">{insignia}</TD>
                      <TD className="hidden md:table-cell">
                        <span className="flex flex-wrap items-center gap-3">{acciones}</span>
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
