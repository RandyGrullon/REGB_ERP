import { notFound } from 'next/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader, StatCard } from '@regb/ui'
import { nivelPorPuntosDeVida, type EstadoReferido } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearReferidoForm, registrarPuntosForm, transicionarReferidoForm } from '../actions'
import { ESTADO_REFERIDO, NIVEL_FIDELIDAD } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface Transaccion {
  id: string
  points: number
  reason: string
  source_type: string
  created_at: string
}

interface Referido {
  id: string
  referred_name: string
  bonus_points: number
  status: EstadoReferido
}

interface ClienteOption {
  id: string
  name: string
}

const badgeNivel = (n: string): 'success' | 'warning' | 'neutral' => {
  if (n === 'oro') return 'success'
  if (n === 'plata') return 'warning'
  return 'neutral'
}
const badgeReferido = (s: string): 'success' | 'danger' | 'warning' => {
  if (s === 'completed') return 'success'
  if (s === 'expired') return 'danger'
  return 'warning'
}
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-8 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'

/** Monedero de un cliente (modulo 38): su saldo derivado, su historial y sus referidos. */
export default async function MonederoClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>
  searchParams: Promise<DemoParams>
}) {
  const { customerId } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'loyalty')

  const { cliente, transacciones, referidos, otrosClientes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [c] = await tx<{ id: string; name: string; saldo: string; vida: string }[]>`
      select id, name,
             public.loyalty_balance(id)::text as saldo,
             public.loyalty_lifetime_points(id)::text as vida
      from public.customers where id = ${customerId} and tenant_id = ${ctx.tenantId}`
    if (!c) return { cliente: null, transacciones: [], referidos: [], otrosClientes: [] }

    const t = await tx<Transaccion[]>`
      select id, points, reason, source_type, created_at::text
      from public.loyalty_transactions where tenant_id = ${ctx.tenantId} and customer_id = ${customerId}
      order by created_at desc limit 50`

    const r = await tx<Referido[]>`
      select lr.id, cr.name as referred_name, lr.bonus_points, lr.status
      from public.loyalty_referrals lr
      join public.customers cr on cr.id = lr.referred_customer_id
      where lr.tenant_id = ${ctx.tenantId} and lr.referrer_customer_id = ${customerId}
      order by lr.created_at desc`

    const oc = await tx<ClienteOption[]>`
      select id, name from public.customers
      where tenant_id = ${ctx.tenantId} and id != ${customerId}
      order by name limit 300`

    return {
      cliente: { id: c.id, name: c.name, saldo: Number(c.saldo), vida: Number(c.vida) },
      transacciones: t,
      referidos: r,
      otrosClientes: oc,
    }
  })

  if (!cliente) notFound()

  const nivel = nivelPorPuntosDeVida(cliente.vida)
  const puedeGestionar = exigir(ctx, 'loyalty', 'loyalty.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="customerId" value={cliente.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/fidelizacion">
      <div className="space-y-5">
        <PageHeader
          icon="redeem"
          title={cliente.name}
          crumbs={[{ label: 'Fidelizacion', href: `/fidelizacion${qs}` }, { label: cliente.name }]}
          actions={<Badge tone={badgeNivel(nivel)}>{NIVEL_FIDELIDAD[nivel]}</Badge>}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Saldo" value={String(cliente.saldo)} />
          <StatCard label="Puntos de por vida" value={String(cliente.vida)} />
        </section>

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar puntos</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={registrarPuntosForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Puntos (+/-)
                  <input
                    name="points"
                    required
                    inputMode="numeric"
                    placeholder="100 o -50"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Razon
                  <input
                    name="reason"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio  className={botonClase}>
                  <Icon name="add" size={14} />
                  Registrar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Historial</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-[var(--color-border)]">
              {transacciones.length === 0 && <li className="py-2 text-xs text-[var(--color-text-muted)]">Todavia no hay movimientos.</li>}
              {transacciones.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm text-[var(--color-text-primary)]">{t.reason}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {new Date(t.created_at).toLocaleString('es-DO')}
                    </p>
                  </div>
                  <span
                    className={`tabular text-sm font-medium ${t.points > 0 ? 'text-[var(--color-semantic-text-success)]' : 'text-[var(--color-semantic-text-danger)]'}`}
                  >
                    {t.points > 0 ? '+' : ''}
                    {t.points}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Referidos</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2">
              {referidos.length === 0 && <li className="text-xs text-[var(--color-text-muted)]">Todavia no ha referido a nadie.</li>}
              {referidos.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5">
                  <div>
                    <p className="text-sm text-[var(--color-text-primary)]">{r.referred_name}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">Bono: {r.bonus_points} puntos</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={badgeReferido(r.status)}>{ESTADO_REFERIDO[r.status] ?? r.status}</Badge>
                    {puedeGestionar && r.status === 'pending' && (
                      <>
                        <form action={transicionarReferidoForm}>
                          {campos}
                          <input type="hidden" name="referralId" value={r.id} />
                          <input type="hidden" name="siguiente" value="completed" />
                          <BotonEnvio  className={botonSecundarioClase}>
                            Completar
                          </BotonEnvio>
                        </form>
                        <form action={transicionarReferidoForm}>
                          {campos}
                          <input type="hidden" name="referralId" value={r.id} />
                          <input type="hidden" name="siguiente" value="expired" />
                          <BotonEnvio  className={botonSecundarioClase}>
                            Expirar
                          </BotonEnvio>
                        </form>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {puedeGestionar && (
              <form action={crearReferidoForm} className="mt-4 flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Referido a
                  <select
                    name="referredCustomerId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {otrosClientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Bono (puntos)
                  <input
                    name="bonusPoints"
                    required
                    inputMode="numeric"
                    defaultValue="100"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <BotonEnvio  className={botonClase}>
                  <Icon name="person_add" size={14} />
                  Referir
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
