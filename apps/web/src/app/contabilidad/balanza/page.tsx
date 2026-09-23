import { Badge, Icon, Mono, PageHeader, StatCard, TBody, TD, TH, THead, TR, Table } from '@regb/ui'
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
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'accounting')

  const filas = await asUser(ctx.userId, ctx.tenantId, (tx) => filasBalanza(tx, ctx.tenantId))
  const inactivas = new Set(filas.filter((f) => !f.isActive).map((f) => f.accountId))
  const balanza = buildTrialBalance(filas)

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/contabilidad">
      <div className="space-y-5">
        <PageHeader
          icon="balance"
          title="Balanza de comprobacion"
          description="Solo lo ya contabilizado. Un borrador todavia no es un hecho contable."
          crumbs={[{ label: 'Contabilidad', href: `/contabilidad${qs}` }, { label: 'Balanza' }]}
        />

        <section aria-label="Totales" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Total debito" value={`RD$ ${money(balanza.totalDebit)}`} />
          <StatCard label="Total credito" value={`RD$ ${money(balanza.totalCredit)}`} />
          <StatCard
            label="Estado"
            value={balanza.balanced ? 'Cuadra' : 'No cuadra'}
            hint={
              balanza.balanced
                ? 'debito = credito'
                : 'algo se conto sin pasar por post_journal_entry()'
            }
          />
        </section>

        {!balanza.balanced && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-semantic-danger)] bg-[color-mix(in_srgb,var(--color-semantic-danger)_10%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-text-danger)]"
          >
            <Icon name="error" size={18} />
            La balanza no cuadra. Esto no deberia pasar nunca si todo se contabilizo con
            &ldquo;Contabilizar&rdquo; — revisa si algun asiento se insento por otro camino.
          </p>
        )}

        {balanza.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
            Todavia no hay ningun asiento contabilizado.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cuenta</TH>
                <TH>Tipo</TH>
                <TH numeric>Debito</TH>
                <TH numeric>Credito</TH>
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
                      <Badge tone="neutral" dot={false} className="ml-1" title="Desactivada, pero con saldo">
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
                        <Badge tone="danger" dot={false} className="ml-1" title="Saldo al reves de lo normal">
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
