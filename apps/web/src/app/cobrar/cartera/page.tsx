import {
  Badge,
  EmptyState,
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
import { buildAging, type AgingBucket, type OpenInvoice } from '@regb/operations'
import { asUser } from '@/lib/db'
import { politicaDeCredito } from '@/lib/credito'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { BotonEnvio } from '@/components/BotonEnvio'
import { guardarPoliticaDeCreditoForm } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cartera · REGB ERP' }

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const TRAMOS: { key: AgingBucket; label: string; tone: string }[] = [
  { key: 'current', label: 'Al día', tone: 'var(--color-semantic-success)' },
  { key: 'd1_30', label: '1 a 30 días', tone: 'var(--color-semantic-info)' },
  { key: 'd31_60', label: '31 a 60', tone: 'var(--color-semantic-warning)' },
  { key: 'd61_90', label: '61 a 90', tone: 'var(--color-accent-sand)' },
  { key: 'd90_plus', label: 'Más de 90', tone: 'var(--color-semantic-danger)' },
]

/**
 * Cartera por antiguedad (S22).
 *
 * El reporte que decide a quien llamar hoy. Los tramos y el corte por
 * cliente los calcula `buildAging` de @regb/operations — el mismo codigo
 * que usaran movil y escritorio en F5.
 */
export default async function CarteraPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'ar')

  const abiertas = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<
      {
        id: string
        number: string
        customer_id: string
        customer_name: string
        customer_phone: string | null
        due_date: string
        saldo: string
      }[]
    >`
      select i.id, i.number, i.customer_id, c.name as customer_name, c.phone as customer_phone,
             i.due_date::text, public.invoice_balance(i.id)::text as saldo
      from public.customer_invoices i
      join public.customers c on c.id = i.customer_id
      where i.tenant_id = ${ctx.tenantId}
        and i.status in ('open','partially_paid','overdue')
        and public.invoice_balance(i.id) > 0
      order by i.due_date`,
  )

  const hoy = new Date()
  const aging = buildAging(
    abiertas.map((f): OpenInvoice => ({
      customerId: f.customer_id,
      customerName: f.customer_name,
      dueDate: new Date(`${f.due_date}T12:00:00`),
      balanceDue: Number(f.saldo),
    })),
    hoy,
  )

  const politica = await asUser(ctx.userId, ctx.tenantId, (tx) =>
    politicaDeCredito(tx, ctx.tenantId),
  )
  const puedeFijarPolitica = exigir(ctx, 'ar', 'ar.credit.manage').ok

  const qs = ctx.demoQs
  // "A quien llamar" sin el telefono obligaba a salir a buscarlo.
  const telefonos = new Map(abiertas.map((f) => [f.customer_id, f.customer_phone]))
  const enlaceCls =
    'text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'
  const maximo = Math.max(...TRAMOS.map((t) => aging.byBucket[t.key]), 1)

  return (
    <Shell {...shell} activePath="/cobrar/cartera">
      <div className="space-y-5">
        <PageHeader
          icon="monitoring"
          title="Cartera por antiguedad"
          description="Cuanto te deben y desde hace cuanto. Lo de mas de 90 dias es lo que rara vez se cobra: llamalo hoy."
          crumbs={[{ label: 'Por cobrar', href: `/cobrar${qs}` }, { label: 'Cartera' }]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Total" value={`RD$ ${money(aging.total)}`} hint="por cobrar" />
          <StatCard label="Vencido" value={`RD$ ${money(aging.overdue)}`} hint="paso su fecha" />
          <StatCard
            label="Clientes"
            value={String(aging.byCustomer.length)}
            hint="con saldo abierto"
          />
        </section>

        <section
          aria-label="Politica de credito"
          className="flex flex-wrap items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Politica de crédito
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {politica === null
                ? 'No se bloquea por facturas vencidas: solo por el limite de cada cliente.'
                : `Un cliente con una factura vencida hace más de ${politica} días no recibe pedidos ni facturas a crédito nuevas sin una excepcion autorizada.`}
            </p>
          </div>
          {puedeFijarPolitica && (
            <form action={guardarPoliticaDeCreditoForm} className="flex items-center gap-2">
              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
              <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                Bloquear después de
                <input
                  name="overdueDays"
                  inputMode="numeric"
                  defaultValue={politica === null ? '' : String(politica)}
                  placeholder="no bloquear"
                  aria-describedby="politica-ayuda"
                  className="tabular h-9 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-right text-sm text-[var(--color-text-primary)]"
                />
                dias
              </label>
              <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                Guardar
              </BotonEnvio>
              <span id="politica-ayuda" className="sr-only">
                De 1 a 365 días. Vacio para no bloquear por vencidas.
              </span>
            </form>
          )}
        </section>

        {abiertas.length === 0 ? (
          <EmptyState
            icon="check_circle"
            title="Nadie te debe nada"
            description="Toda la cartera esta cobrada. Cuando emitas facturas a credito apareceran aqui repartidas por antiguedad."
          />
        ) : (
          <>
            {/* Barras por tramo: la forma de la cartera de un vistazo. */}
            <section
              aria-label="Antiguedad"
              className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4"
            >
              {TRAMOS.map((t) => {
                const v = aging.byBucket[t.key]
                const pct = aging.total > 0 ? (v / aging.total) * 100 : 0
                return (
                  <div key={t.key} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs text-[var(--color-text-secondary)]">
                      {t.label}
                    </span>
                    <span className="h-6 flex-1 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-overlay)]">
                      <span
                        className="block h-full rounded-[var(--radius-sm)] transition-all"
                        style={{ width: `${(v / maximo) * 100}%`, background: t.tone }}
                      />
                    </span>
                    <span className="tabular w-28 shrink-0 text-right text-sm font-semibold text-[var(--color-text-primary)]">
                      {money(v)}
                    </span>
                    <span className="tabular w-12 shrink-0 text-right text-xs text-[var(--color-text-muted)]">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                )
              })}
            </section>

            <section aria-label="Por cliente">
              <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
                A quien llamar
              </h2>
              <Table>
                <THead>
                  <TR>
                    <TH>Cliente</TH>
                    <TH numeric>Al día</TH>
                    <TH numeric>1-30</TH>
                    <TH numeric>31-60</TH>
                    <TH numeric>61-90</TH>
                    <TH numeric>+90</TH>
                    <TH numeric>Debe</TH>
                    <TH>Urgencia</TH>
                  </TR>
                </THead>
                <TBody>
                  {aging.byCustomer.map((c) => {
                    const vencido = c.total - c.buckets.current
                    return (
                      <TR key={c.customerId}>
                        <TD className="font-medium text-[var(--color-text-primary)]">
                          <a href={`/pedidos/clientes/${c.customerId}${qs}`} className={enlaceCls}>
                            {c.customerName}
                          </a>
                          {telefonos.get(c.customerId) && (
                            <a
                              href={`tel:${telefonos.get(c.customerId)!.replace(/[^\d+]/g, '')}`}
                              className="block text-[11px] font-normal text-[var(--color-text-muted)] hover:underline"
                            >
                              {telefonos.get(c.customerId)}
                            </a>
                          )}
                        </TD>
                        {TRAMOS.map((t) => (
                          <TD key={t.key} numeric>
                            <span
                              className="tabular"
                              style={c.buckets[t.key] > 0 ? { color: t.tone } : undefined}
                            >
                              {c.buckets[t.key] > 0 ? money(c.buckets[t.key]) : '—'}
                            </span>
                          </TD>
                        ))}
                        <TD numeric>
                          <span className="tabular font-semibold">{money(c.total)}</span>
                        </TD>
                        <TD>
                          {vencido === 0 ? (
                            <Badge tone="success">al día</Badge>
                          ) : c.buckets.d90_plus > 0 ? (
                            <Badge tone="danger">critico</Badge>
                          ) : (
                            <Badge tone="warning">atrasado</Badge>
                          )}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </section>

            <section aria-label="Facturas abiertas">
              <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
                Facturas abiertas ({abiertas.length})
              </h2>
              <Table>
                <THead>
                  <TR>
                    <TH>Factura</TH>
                    <TH>Cliente</TH>
                    <TH>Vence</TH>
                    <TH numeric>Saldo</TH>
                  </TR>
                </THead>
                <TBody>
                  {abiertas.map((f) => (
                    <TR key={f.id}>
                      <TD>
                        <a href={`/cobrar/${f.id}${qs}`} className={enlaceCls}>
                          <Mono>{f.number}</Mono>
                        </a>
                      </TD>
                      <TD>{f.customer_name}</TD>
                      <TD>
                        {new Date(`${f.due_date}T12:00:00`).toLocaleDateString('es-DO', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </TD>
                      <TD numeric>
                        <span className="tabular font-semibold">{money(Number(f.saldo))}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </section>
          </>
        )}
      </div>
    </Shell>
  )
}
