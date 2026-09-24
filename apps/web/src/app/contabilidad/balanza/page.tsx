import {
  Badge,
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
import { buildTrialBalance } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { filasBalanza } from '../consultas'
import { TIPO_CUENTA } from '../estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Balanza de comprobacion · REGB ERP' }

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Balanza de comprobacion (modulo 16): solo suma lo YA CONTABILIZADO — un
 * borrador todavia no es un hecho contable, y meterlo aqui haria que la
 * balanza "cuadrara" con numeros que ni siquiera se decidieron del todo.
 */
export default async function BalanzaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { hasta?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'accounting')
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(params.hasta ?? '') ? params.hasta! : null

  const filas = await asUser(ctx.userId, ctx.tenantId, (tx) =>
    filasBalanza(tx, ctx.tenantId, hasta),
  )
  const inactivas = new Set(filas.filter((f) => !f.isActive).map((f) => f.accountId))
  const balanza = buildTrialBalance(filas)

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/contabilidad">
      <div className="space-y-5">
        <PageHeader
          icon="balance"
          title="Balanza de comprobacion"
          description={
            hasta
              ? `Lo contabilizado con fecha hasta el ${new Date(`${hasta}T12:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })}. Un borrador todavía no es un hecho contable.`
              : 'Solo lo ya contabilizado. Un borrador todavía no es un hecho contable.'
          }
          crumbs={[{ label: 'Contabilidad', href: `/contabilidad${qs}` }, { label: 'Balanza' }]}
        />

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            Al día
            <input
              type="date"
              name="hasta"
              defaultValue={hasta ?? ''}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
            />
          </label>
          <ToolbarActions hasFilters={hasta !== null} clearHref={`/contabilidad/balanza${qs}`} />
        </Toolbar>

        <section aria-label="Totales" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Total debito" value={`RD$ ${money(balanza.totalDebit)}`} />
          <StatCard label="Total credito" value={`RD$ ${money(balanza.totalCredit)}`} />
          <StatCard
            label="Estado"
            value={balanza.balanced ? 'Cuadra' : 'No cuadra'}
            hint={
              balanza.balanced
                ? 'debito = crédito'
                : 'algun asiento entro sin pasar por Contabilizar'
            }
          />
        </section>

        {!balanza.balanced && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-semantic-danger)] bg-[color-mix(in_srgb,var(--color-semantic-danger)_10%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-text-danger)]"
          >
            <Icon name="error" size={18} />
            La balanza no cuadra. Esto no debería pasar nunca si todo se contabilizo con
            &ldquo;Contabilizar&rdquo; — avisale a soporte: algun asiento entro por otro camino.
          </p>
        )}

        {balanza.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
            Todavía no hay ningún asiento contabilizado.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cuenta</TH>
                <TH>Tipo</TH>
                <TH numeric>Debito</TH>
                <TH numeric>Crédito</TH>
                <TH numeric>Saldo</TH>
              </TR>
            </THead>
            <TBody>
              {balanza.rows.map((r) => (
                <TR key={r.accountId}>
                  <TD>
                    <a
                      href={`/contabilidad/mayor?cuenta=${r.accountId}${qs.replace('?', '&')}`}
                      className="font-medium text-[var(--color-text-link)] hover:underline"
                    >
                      <Mono>{r.accountCode}</Mono> {r.accountName}
                    </a>
                    {inactivas.has(r.accountId) && (
                      <Badge
                        tone="neutral"
                        dot={false}
                        className="ml-1"
                        title="Desactivada, pero con saldo"
                      >
                        desactivada
                      </Badge>
                    )}
                  </TD>
                  <TD>{TIPO_CUENTA[r.type] ?? r.type}</TD>
                  <TD numeric>
                    <span className="tabular">{money(r.totalDebit)}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{money(r.totalCredit)}</span>
                  </TD>
                  <TD numeric>
                    <span
                      className={`tabular font-semibold ${r.balance < 0 ? 'text-[var(--color-semantic-text-danger)]' : ''}`}
                    >
                      {money(r.balance)}
                      {r.balance < 0 && (
                        <Badge
                          tone="danger"
                          dot={false}
                          className="ml-1"
                          title="Saldo al reves de lo normal"
                        >
                          al reves
                        </Badge>
                      )}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}
