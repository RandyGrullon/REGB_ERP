import {
  Badge,
  EmptyState,
  Icon,
  Mono,
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
import { TIPOS_ANULACION } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reportes DGII · REGB ERP' }

/**
 * Reportes 607 (ventas) y 608 (anulados) del periodo.
 *
 * Se declaran mensualmente. La pantalla existe para que el contador vea lo
 * que va a declarar ANTES de la fecha limite, no el dia 20 corriendo: lo
 * que se declara mal se corrige con una rectificativa, y una rectificativa
 * llama la atencion.
 *
 * Las ventas de caja y las facturas a credito salen juntas: el 607 declara
 * las ventas del periodo, no un tipo de documento.
 */

interface Fila607 {
  origen: string
  rnc_comprador: string | null
  tipo_identificacion: string
  ncf: string
  ncf_type: string
  fecha_comprobante: string
  monto_facturado: string
  itbis_facturado: string
  total: string
}

interface Fila608 {
  origen: string
  ncf: string
  ncf_type: string
  fecha_comprobante: string
  /** Codigo DGII. Nulo si nadie clasifico la anulacion. */
  motivo: string | null
  explicacion: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `20260803` → `3 ago 2026`. La DGII pide el crudo; la pantalla, legible. */
function fecha(yyyymmdd: string): string {
  const iso = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const ID_LABEL: Record<string, string> = { '1': 'RNC', '2': 'Cedula', '3': 'Sin identificar' }

/**
 * Descarga del reporte.
 *
 * Sale CSV y no el TXT de la Oficina Virtual: ese layout lo fija una norma
 * que cambia, y un archivo mal formado no falla aqui — falla el dia 20 en
 * la ventanilla. El contador abre el CSV, lo revisa y lo carga donde ya
 * trabaja.
 */
function Descargar({
  reporte,
  periodo,
  qs,
  vacio,
}: {
  reporte: '607' | '608'
  periodo: string
  qs: string
  vacio: boolean
}) {
  const sep = qs === '' ? '?' : '&'
  return (
    <a
      href={`/api/dgii/${reporte}${qs}${sep}periodo=${periodo}`}
      download
      aria-disabled={vacio}
      title={
        vacio ? 'No hay nada que descargar en este periodo' : 'Descarga en CSV para tu contador'
      }
      className={`flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] ${
        vacio
          ? 'pointer-events-none opacity-40'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <Icon name="download" size={16} />
      Descargar CSV
    </a>
  )
}

/**
 * Archivo .TXT de envio.
 *
 * Se ofrece aparte y con aviso: el layout sale de la Norma General 07-2018
 * pero NO se ha comparado con un archivo real ya aceptado por la DGII.
 * Hasta que eso pase, el CSV es el camino recomendado y este es el que
 * hay que verificar antes del primer envio.
 */
function DescargarTxt({
  reporte,
  periodo,
  qs,
  vacio,
}: {
  reporte: '607' | '608'
  periodo: string
  qs: string
  vacio: boolean
}) {
  const sep = qs === '' ? '?' : '&'
  return (
    <a
      href={`/api/dgii/${reporte}${qs}${sep}periodo=${periodo}&formato=txt`}
      download
      aria-disabled={vacio}
      title="Formato de la Norma General 07-2018. Verificalo antes de tu primer envio."
      className={`flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--color-semantic-warning)] px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] ${
        vacio
          ? 'pointer-events-none opacity-40'
          : 'text-[var(--color-semantic-text-warning)] hover:bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)]'
      }`}
    >
      <Icon name="draft" size={16} />
      TXT de envio
    </a>
  )
}

export default async function DgiiPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { periodo?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'ar', 'ar.export')

  // Por defecto el mes corriente, que es el que se esta armando.
  const hoy = new Date()
  const periodoActual = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const periodo = /^\d{6}$/.test(params.periodo ?? '') ? params.periodo! : periodoActual

  const [ventas, anulados, periodos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const v = await tx<Fila607[]>`
      select origen, rnc_comprador, tipo_identificacion, ncf, ncf_type,
             fecha_comprobante, monto_facturado::text, itbis_facturado::text, total::text
      from public.dgii_607
      where tenant_id = ${ctx.tenantId} and periodo = ${periodo}
      order by ncf`

    const a = await tx<Fila608[]>`
      select origen, ncf, ncf_type, fecha_comprobante, motivo, explicacion
      from public.dgii_608
      where tenant_id = ${ctx.tenantId} and periodo = ${periodo}
      order by ncf`

    // Solo los periodos con movimiento: un desplegable con 12 meses vacios
    // no ayuda a nadie.
    const p = await tx<{ periodo: string }[]>`
      select periodo from public.dgii_607 where tenant_id = ${ctx.tenantId}
      union
      select periodo from public.dgii_608 where tenant_id = ${ctx.tenantId}
      order by periodo desc`
    return [v, a, p] as const
  })

  const totalVentas = ventas.reduce((s, f) => s + Number(f.total), 0)
  const totalItbis = ventas.reduce((s, f) => s + Number(f.itbis_facturado), 0)
  const sinClasificar = anulados.filter((a) => a.motivo === null).length
  const qs = ctx.demoQs

  const legible = (p: string) =>
    new Date(`${p.slice(0, 4)}-${p.slice(4, 6)}-01T12:00:00`).toLocaleDateString('es-DO', {
      month: 'long',
      year: 'numeric',
    })

  const opciones = periodos.some((p) => p.periodo === periodo)
    ? periodos
    : [{ periodo }, ...periodos]

  return (
    <Shell {...shell} activePath="/cobrar/dgii">
      <div className="space-y-5">
        <PageHeader
          icon="account_balance"
          title="Reportes DGII"
          description="Lo que vas a declarar este periodo: 607 de ventas y 608 de comprobantes anulados."
          crumbs={[{ label: 'Por cobrar', href: `/cobrar${qs}` }, { label: 'Reportes DGII' }]}
        />

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            Periodo
            <select
              name="periodo"
              defaultValue={periodo}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
            >
              {opciones.map((p) => (
                <option key={p.periodo} value={p.periodo}>
                  {legible(p.periodo)}
                </option>
              ))}
            </select>
          </label>
          <ToolbarActions hasFilters={periodo !== periodoActual} clearHref={`/cobrar/dgii${qs}`} />
        </Toolbar>

        <section aria-label="Resumen del periodo" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Comprobantes" value={String(ventas.length)} hint="en el 607" />
          <StatCard label="Ventas" value={`RD$ ${money(totalVentas)}`} hint="con ITBIS" />
          <StatCard label="ITBIS facturado" value={`RD$ ${money(totalItbis)}`} hint="a declarar" />
          <StatCard label="Anulados" value={String(anulados.length)} hint="en el 608" />
        </section>

        <div
          className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-sm"
          role="note"
        >
          <Icon name="info" size={20} className="shrink-0 text-[var(--color-text-muted)]" />
          <p className="text-[var(--color-text-secondary)]">
            Esto es lo que se declara, no el envio. La transmision del e-CF a la DGII llega con el
            modulo de facturacion electronica. Un NCF anulado se{' '}
            <strong className="text-[var(--color-text-primary)]">declara en el 608</strong>, nunca
            se omite: para la DGII un hueco en la secuencia es una alerta.
          </p>
        </div>

        <div
          role="note"
          className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-semantic-warning)] p-3 text-sm"
        >
          <Icon
            name="draft"
            size={20}
            className="shrink-0 text-[var(--color-semantic-text-warning)]"
          />
          <p className="text-[var(--color-text-secondary)]">
            El <strong className="text-[var(--color-text-primary)]">TXT de envio</strong> sigue el
            formato de la Norma General 07-2018, pero{' '}
            <strong className="text-[var(--color-text-primary)]">
              todavia no se ha comparado con un archivo tuyo ya aceptado
            </strong>{' '}
            por la DGII. Antes de tu primer envio, abrelo al lado de uno que hayas subido bien y
            avisanos si algo no cuadra. Mientras tanto, el CSV es el camino seguro: lo revisa tu
            contador antes de subir nada.
          </p>
        </div>

        <section aria-labelledby="t607" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="t607" className="text-sm font-semibold text-[var(--color-text-primary)]">
              607 · Ventas del periodo
            </h2>
            <span className="flex gap-2">
              <DescargarTxt reporte="607" periodo={periodo} qs={qs} vacio={ventas.length === 0} />
              <Descargar reporte="607" periodo={periodo} qs={qs} vacio={ventas.length === 0} />
            </span>
          </div>
          {ventas.length === 0 ? (
            <EmptyState
              icon="receipt_long"
              title="Sin comprobantes en este periodo"
              description="Cuando emitas facturas o vendas en caja con NCF, apareceran aqui."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>NCF</TH>
                  <TH>Origen</TH>
                  <TH>Identificacion del comprador</TH>
                  <TH>Fecha</TH>
                  <TH numeric>Facturado</TH>
                  <TH numeric>ITBIS</TH>
                  <TH numeric>Total</TH>
                </TR>
              </THead>
              <TBody>
                {ventas.map((f) => (
                  <TR key={f.ncf}>
                    <TD>
                      <Mono>{f.ncf}</Mono>
                    </TD>
                    <TD>
                      <Badge tone="neutral" dot={false}>
                        {f.origen}
                      </Badge>
                    </TD>
                    <TD>
                      {f.rnc_comprador ? (
                        <>
                          <Mono>{f.rnc_comprador}</Mono>{' '}
                          <span className="text-xs text-[var(--color-text-secondary)]">
                            {ID_LABEL[f.tipo_identificacion]}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">
                          Consumidor final
                        </span>
                      )}
                    </TD>
                    <TD>{fecha(f.fecha_comprobante)}</TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(f.monto_facturado))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(f.itbis_facturado))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{money(Number(f.total))}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>

        {sinClasificar > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-semantic-danger)] bg-[color-mix(in_srgb,var(--color-semantic-danger)_10%,transparent)] p-3 text-sm"
          >
            <Icon
              name="error"
              size={20}
              filled
              className="shrink-0 text-[var(--color-semantic-text-danger)]"
            />
            <p className="text-[var(--color-text-secondary)]">
              Hay <strong className="text-[var(--color-text-primary)]">{sinClasificar}</strong>{' '}
              anulacion{sinClasificar === 1 ? '' : 'es'} sin el motivo que pide la DGII. Son
              anteriores a que el sistema lo pidiera, y{' '}
              <strong className="text-[var(--color-text-primary)]">
                el archivo del 608 no se genera
              </strong>{' '}
              hasta clasificarlas: entregar una con el motivo equivocado es peor que no entregarla.
            </p>
          </div>
        )}

        <section aria-labelledby="t608" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="t608" className="text-sm font-semibold text-[var(--color-text-primary)]">
              608 · Comprobantes anulados
            </h2>
            <span className="flex gap-2">
              <DescargarTxt reporte="608" periodo={periodo} qs={qs} vacio={anulados.length === 0} />
              <Descargar reporte="608" periodo={periodo} qs={qs} vacio={anulados.length === 0} />
            </span>
          </div>
          {anulados.length === 0 ? (
            <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
              Ninguno en este periodo. Es lo normal y lo deseable.
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>NCF</TH>
                  <TH>Origen</TH>
                  <TH>Fecha</TH>
                  <TH>Motivo DGII</TH>
                  <TH>Explicacion</TH>
                </TR>
              </THead>
              <TBody>
                {anulados.map((f) => (
                  <TR key={f.ncf}>
                    <TD>
                      <Mono>{f.ncf}</Mono>
                    </TD>
                    <TD>
                      <Badge tone="neutral" dot={false}>
                        {f.origen}
                      </Badge>
                    </TD>
                    <TD>{fecha(f.fecha_comprobante)}</TD>
                    <TD>
                      {f.motivo ? (
                        <>
                          <Mono>{f.motivo}</Mono>{' '}
                          <span className="text-xs text-[var(--color-text-secondary)]">
                            {TIPOS_ANULACION[f.motivo]}
                          </span>
                        </>
                      ) : (
                        <Badge tone="danger">sin clasificar</Badge>
                      )}
                    </TD>
                    <TD>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {f.explicacion}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>
      </div>
    </Shell>
  )
}
