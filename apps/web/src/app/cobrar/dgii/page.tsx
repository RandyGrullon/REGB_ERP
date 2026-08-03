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
  motivo: string
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
      select origen, ncf, ncf_type, fecha_comprobante, motivo
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
          <ToolbarActions
            hasFilters={periodo !== periodoActual}
            clearHref={`/cobrar/dgii${qs}`}
          />
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

        <section aria-labelledby="t607" className="space-y-2">
          <h2 id="t607" className="text-sm font-semibold text-[var(--color-text-primary)]">
            607 · Ventas del periodo
          </h2>
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

        <section aria-labelledby="t608" className="space-y-2">
          <h2 id="t608" className="text-sm font-semibold text-[var(--color-text-primary)]">
            608 · Comprobantes anulados
          </h2>
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
                  <TH>Motivo</TH>
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
                    <TD>{f.motivo}</TD>
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
