import Link from 'next/link'
import { Badge, Card } from '@regb/ui'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/provider-guard'
import { TierBadge } from '@/components/ControlBits'
import { moverEtapa } from './actions'
import type { TenantTier } from '@regb/core'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Onboarding · REGB Control' }

const STAGES = [
  { id: 'sold', label: 'Vendido' },
  { id: 'migration', label: 'Migracion' },
  { id: 'config', label: 'Configuracion' },
  { id: 'training', label: 'Capacitacion' },
  { id: 'live', label: 'En vivo 🎉' },
] as const

interface Row {
  tenant_id: string
  slug: string
  legal_name: string
  tier: TenantTier
  stage: string
  target_go_live: string | null
  blockers: string | null
}

/**
 * Kanban de onboarding (S17): cada cliente nuevo recorre
 * vendido → migracion → configuracion → capacitacion → en vivo.
 *
 * Los clientes sin fila se registran en 'sold' al cargar (idempotente):
 * ningun cliente puede existir fuera del tablero.
 */
export default async function OnboardingPage() {
  await requireProvider()
  const sql = db()

  await sql`
    insert into regb.onboarding (tenant_id, stage)
    select t.id, case when t.go_live_at is not null then 'live' else 'sold' end
    from regb.tenants t
    where t.status <> 'archived'
      and not exists (select 1 from regb.onboarding o where o.tenant_id = t.id)`

  const rows = await sql<Row[]>`
    select o.tenant_id, t.slug, t.legal_name, t.tier, o.stage,
           o.target_go_live::text, o.blockers
    from regb.onboarding o
    join regb.tenants t on t.id = o.tenant_id
    where t.status <> 'archived'
    order by t.legal_name`

  return (
    <div className="space-y-4">
      <nav aria-label="Miga de pan" className="text-sm text-[var(--color-text-muted)]">
        <Link href="/control" className="text-[var(--color-text-link)] hover:underline">
          Clientes
        </Link>{' '}
        › Onboarding
      </nav>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {STAGES.map((stage, si) => {
          const cards = rows.filter((r) => r.stage === stage.id)
          return (
            <section
              key={stage.id}
              aria-label={stage.label}
              className="rounded-[var(--radius-lg)] bg-[var(--color-surface-deep)] p-2"
            >
              <h2 className="flex items-center justify-between px-2 py-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                {stage.label}
                <Badge dot={false}>{cards.length}</Badge>
              </h2>
              <div className="mt-1 space-y-2">
                {cards.map((c) => (
                  <Card key={c.tenant_id} className="p-3">
                    <Link
                      href={`/control/${c.slug}`}
                      className="text-sm font-medium text-[var(--color-text-primary)] hover:underline"
                    >
                      {c.legal_name}
                    </Link>
                    <div className="mt-1.5 flex items-center gap-2">
                      <TierBadge tier={c.tier} />
                      {c.blockers && (
                        <Badge tone="warning" dot={false} title={c.blockers}>
                          bloqueado
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex justify-between">
                      <form action={moverEtapa}>
                        <input type="hidden" name="tenantId" value={c.tenant_id} />
                        <input type="hidden" name="direction" value="prev" />
                        <BotonEnvio
                          
                          disabled={si === 0}
                          aria-label={`Retroceder ${c.legal_name}`}
                          className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] disabled:opacity-30">
                          ←
                        </BotonEnvio>
                      </form>
                      <form action={moverEtapa}>
                        <input type="hidden" name="tenantId" value={c.tenant_id} />
                        <input type="hidden" name="direction" value="next" />
                        <BotonEnvio
                          
                          disabled={si === STAGES.length - 1}
                          aria-label={`Avanzar ${c.legal_name}`}
                          className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] disabled:opacity-30">
                          →
                        </BotonEnvio>
                      </form>
                    </div>
                  </Card>
                ))}
                {cards.length === 0 && (
                  <p className="px-2 py-4 text-center text-xs text-[var(--color-text-muted)]">—</p>
                )}
              </div>
            </section>
          )
        })}
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        Llegar a &quot;En vivo&quot; fija el go-live del cliente. Ningun cliente existe fuera del
        tablero: los nuevos entran solos en &quot;Vendido&quot;.
      </p>
    </div>
  )
}
