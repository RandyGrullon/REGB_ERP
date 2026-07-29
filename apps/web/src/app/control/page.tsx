import Link from 'next/link'
import { StatCard, Table, THead, TBody, TR, TH, TD } from '@regb/ui'
import { loadControlOverview } from '@/lib/control'
import { requireProvider } from '@/lib/provider-guard'
import { cycleLabel, StatusBadge, TierBadge, usd } from '@/components/ControlBits'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Clientes · REGB Control' }

const TIER_LABEL = { pyme: 'PYME', mediano: 'Mediano', grande: 'Grande' } as const

/**
 * Overview de REGB Control (§12.4): todos los clientes que pagan el ERP,
 * con su precio de instalacion y su mensualidad. Cada cifra la calcula
 * `@regb/billing` en el momento — no hay montos cableados.
 */
export default async function ControlOverviewPage() {
  await requireProvider()
  const { mrr, clients, byTier } = await loadControlOverview()

  const enPrueba = clients.reduce((a, c) => a + c.trialModules, 0)
  const modulosDePago = clients.reduce((a, c) => a + c.paidModules, 0)

  return (
    <div className="space-y-6">
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="MRR" value={usd(mrr)} hint="mensualidad de todos los clientes" />
        <StatCard label="ARR" value={usd(mrr * 12)} hint="anualizado" />
        <StatCard label="Clientes" value={String(clients.length)} hint="activos" />
        <StatCard
          label="Modulos de pago"
          value={String(modulosDePago)}
          hint={enPrueba > 0 ? `+ ${enPrueba} en prueba` : 'ninguno en prueba'}
        />
      </section>

      {byTier.length > 0 && (
        <section aria-label="MRR por tier" className="flex flex-wrap gap-3">
          {byTier.map((g) => (
            <div
              key={g.tier}
              className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"
            >
              <TierBadge tier={g.tier} />
              <span className="tabular text-sm font-semibold text-[var(--color-text-primary)]">
                {usd(g.mrr)}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                {g.count} {g.count === 1 ? 'cliente' : 'clientes'} ·{' '}
                {mrr > 0 ? Math.round((g.mrr / mrr) * 100) : 0}% del MRR
              </span>
            </div>
          ))}
        </section>
      )}

      <section aria-label="Clientes">
        <Table>
          <THead>
            <TR>
              <TH>Cliente</TH>
              <TH>Tier</TH>
              <TH>Estado</TH>
              <TH numeric>Salud</TH>
              <TH numeric>Modulos</TH>
              <TH>Ciclo</TH>
              <TH numeric>Instalacion</TH>
              <TH numeric>Mensualidad</TH>
            </TR>
          </THead>
          <TBody>
            {clients.map((c) => (
              <TR key={c.slug}>
                <TD>
                  <Link
                    href={`/control/${c.slug}`}
                    className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                  >
                    {c.legalName}
                  </Link>
                </TD>
                <TD>
                  <TierBadge tier={c.tier} />
                </TD>
                <TD>
                  <StatusBadge status={c.status} />
                </TD>
                <TD numeric>
                  <span className="tabular">{c.healthScore ?? '—'}</span>
                </TD>
                <TD numeric>
                  <span className="tabular">
                    {c.paidModules}
                    {c.trialModules > 0 && (
                      <span className="text-[var(--color-text-muted)]"> +{c.trialModules}🧪</span>
                    )}
                  </span>
                </TD>
                <TD>{cycleLabel(c.billingCycle)}</TD>
                <TD numeric>
                  <span className="tabular">{usd(c.installTotal)}</span>
                </TD>
                <TD numeric>
                  <span className="tabular font-semibold">{usd(c.monthlyTotal)}</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Cifras calculadas en vivo por el motor de precios (§6.4) a partir de los modulos activos
          de cada cliente. Tiers: {byTier.map((g) => TIER_LABEL[g.tier]).join(' · ')}.
        </p>
      </section>
    </div>
  )
}
