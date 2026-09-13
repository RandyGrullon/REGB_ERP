import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
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
} from '@regb/ui'
import { NCF_LABELS, sequenceHealth, type NcfType } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { registrarSecuenciaForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Comprobantes fiscales · REGB ERP' }

interface SeqRow {
  id: string
  ncf_type: NcfType
  range_from: number
  range_to: number
  next_number: number
  expires_on: string
  authorization_ref: string | null
  is_active: boolean
  emitidos: string
}

const inputCls =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

/**
 * Secuencias NCF (base fiscal DGII).
 *
 * Lo primero que configura un cliente dominicano: sin una autorizacion
 * cargada no puede emitir una sola factura valida. La pantalla insiste en
 * lo que de verdad duele —cuantos quedan y cuando vence— porque pedirle a
 * la DGII una autorizacion nueva toma dias y quedarse sin NCF detiene el
 * negocio.
 */
export default async function NcfPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'ar')

  const secuencias = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<SeqRow[]>`
      select s.id, s.ncf_type, s.range_from, s.range_to, s.next_number,
             s.expires_on::text, s.authorization_ref, s.is_active,
             (select count(*) from public.customer_invoices i
               where i.tenant_id = s.tenant_id and i.ncf_type = s.ncf_type)::text as emitidos
      from public.ncf_sequences s
      where s.tenant_id = ${ctx.tenantId}
      order by s.is_active desc, s.ncf_type`,
  )

  const puedeGestionar = exigir(ctx, 'ar', 'ar.invoice.create').ok
  const qs = ctx.demoQs
  const hoy = new Date()

  const salud = secuencias.map((s) => ({
    fila: s,
    h: sequenceHealth(
      {
        tipo: s.ncf_type,
        desde: s.range_from,
        hasta: s.range_to,
        proximo: s.next_number,
        vence: new Date(`${s.expires_on}T12:00:00`),
      },
      hoy,
    ),
  }))

  const activas = salud.filter((s) => s.fila.is_active)
  const enRiesgo = activas.filter((s) => s.h.agotada || s.h.vencida || s.h.porAgotarse)

  const fecha = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  return (
    <Shell {...shell} activePath="/cobrar/ncf">
      <div className="space-y-5">
        <PageHeader
          icon="verified"
          title="Comprobantes fiscales (NCF)"
          description="Los rangos que te autorizo la DGII. Sin una secuencia vigente no puedes emitir una factura valida."
          crumbs={[{ label: 'Por cobrar', href: `/cobrar${qs}` }, { label: 'Comprobantes' }]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Secuencias activas" value={String(activas.length)} hint="por tipo" />
          <StatCard
            label="NCF disponibles"
            value={String(activas.reduce((a, s) => a + s.h.restantes, 0))}
            hint="antes de pedir mas"
          />
          <StatCard
            label="Requieren atencion"
            value={String(enRiesgo.length)}
            hint="agotadas, vencidas o por agotarse"
          />
        </section>

        {enRiesgo.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_12%,transparent)] p-4 text-sm"
          >
            <Icon
              name="warning"
              size={20}
              filled
              className="shrink-0 text-[var(--color-semantic-text-warning)]"
            />
            <p className="text-[var(--color-text-secondary)]">
              Hay {enRiesgo.length} secuencia{enRiesgo.length === 1 ? '' : 's'} que necesita
              atencion. Pedirle a la DGII una autorizacion nueva toma dias:{' '}
              <strong className="text-[var(--color-text-primary)]">gestionala ahora</strong>, no
              cuando se acabe. Quedarte sin NCF significa no poder facturar.
            </p>
          </div>
        )}

        {secuencias.length === 0 ? (
          <EmptyState
            icon="verified"
            title="Todavia no has cargado ninguna autorizacion"
            description="Registra abajo el rango que te dio la DGII. Es lo primero: sin esto no se puede emitir factura."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Tipo</TH>
                <TH>Rango autorizado</TH>
                <TH numeric>Proximo</TH>
                <TH numeric>Quedan</TH>
                <TH>Vence</TH>
                <TH>Autorizacion</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {salud.map(({ fila: s, h }) => (
                <TR key={s.id} className={s.is_active ? '' : 'opacity-50'}>
                  <TD>
                    <Mono>{s.ncf_type}</Mono>{' '}
                    <span className="text-[var(--color-text-secondary)]">
                      {NCF_LABELS[s.ncf_type]}
                    </span>
                  </TD>
                  <TD>
                    <span className="tabular text-xs">
                      {s.range_from} – {s.range_to}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{s.next_number}</span>
                  </TD>
                  <TD numeric>
                    <span
                      className={`tabular font-semibold ${
                        h.restantes === 0
                          ? 'text-[var(--color-semantic-text-danger)]'
                          : h.porAgotarse
                            ? 'text-[var(--color-semantic-text-warning)]'
                            : ''
                      }`}
                    >
                      {h.restantes}
                    </span>
                  </TD>
                  <TD>{fecha(s.expires_on)}</TD>
                  <TD>{s.authorization_ref ? <Mono>{s.authorization_ref}</Mono> : '—'}</TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      {!s.is_active ? (
                        <Badge tone="neutral">archivada</Badge>
                      ) : h.agotada ? (
                        <Badge tone="danger">agotada</Badge>
                      ) : h.vencida ? (
                        <Badge tone="danger">vencida</Badge>
                      ) : h.porAgotarse ? (
                        <Badge tone="warning">por agotarse</Badge>
                      ) : (
                        <Badge tone="success">vigente</Badge>
                      )}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card data-tour="ncf-autorizacion">
            <CardHeader>
              <CardTitle>Registrar autorizacion de la DGII</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={registrarSecuenciaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-56 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo de comprobante
                  <select name="ncfType" required defaultValue="B02" className={inputCls}>
                    {(Object.keys(NCF_LABELS) as NcfType[]).map((t) => (
                      <option key={t} value={t}>
                        {t} — {NCF_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Desde
                  <input
                    name="rangeFrom"
                    required
                    inputMode="numeric"
                    defaultValue="1"
                    className={inputCls}
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Hasta
                  <input
                    name="rangeTo"
                    required
                    inputMode="numeric"
                    placeholder="1000"
                    className={inputCls}
                  />
                </label>
                <label className="flex w-44 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Vence
                  <input name="expiresOn" required type="date" className={inputCls} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  No. de autorizacion
                  <input name="authRef" placeholder="AUT-2026-001" className={inputCls} />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Registrar
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Registrar una secuencia nueva del mismo tipo archiva la anterior; su historial de
                comprobantes emitidos se conserva para la auditoria. Un NCF consumido nunca vuelve,
                ni aunque se anule la factura: la DGII espera verlo reportado como anulado en el
                608, no desaparecido.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
