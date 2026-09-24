import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { cerrarTurnoForm } from '../actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Turnos · REGB ERP' }

interface ShiftRow {
  id: string
  warehouse_name: string
  cashier_name: string | null
  opening_float: string
  counted_cash: string | null
  expected_cash: string | null
  variance: string | null
  status: string
  opened_at: string
  closed_at: string | null
  tickets: string
  esperado_ahora: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Turnos de caja (S21): apertura, cierre y arqueo. */
export default async function TurnosPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'pos', 'pos.shift.open')

  const shifts = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<ShiftRow[]>`
      select s.id, w.name as warehouse_name, up.display_name as cashier_name,
             s.opening_float::text, s.counted_cash::text, s.expected_cash::text,
             s.variance::text, s.status, s.opened_at::text, s.closed_at::text,
             (select count(*) from public.pos_sales sa
               where sa.shift_id = s.id and not sa.voided)::text as tickets,
             public.pos_expected_cash(s.id)::text as esperado_ahora
      from public.pos_shifts s
      join public.warehouses w on w.id = s.warehouse_id
      left join public.user_profiles up
        on up.tenant_id = s.tenant_id and up.user_id = s.cashier_id
      where s.tenant_id = ${ctx.tenantId}
      order by s.opened_at desc
      limit 50`,
  )

  const puedeCerrar = exigir(ctx, 'pos', 'pos.shift.close').ok
  const abierto = shifts.find((s) => s.status === 'open')
  const qs = ctx.demoQs

  const hora = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Shell {...shell} activePath="/pos/shifts">
      <div className="space-y-5">
        <PageHeader
          icon="schedule"
          title="Turnos de caja"
          description="Cada ticket pertenece a un turno. Al cerrar se cuenta el efectivo y se compara con lo que deberia haber."
          crumbs={[{ label: 'Caja', href: `/pos${qs}` }, { label: 'Turnos' }]}
        />

        {abierto && (
          <Card>
            <CardHeader>
              <CardTitle>
                Turno abierto en {abierto.warehouse_name} · desde {hora(abierto.opened_at)}
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatCard label="Tickets" value={abierto.tickets} hint="vigentes" />
                <StatCard
                  label="Fondo"
                  value={`RD$ ${money(Number(abierto.opening_float))}`}
                  hint="al abrir"
                />
                {/* Conteo a ciegas: lo esperado NO se enseña de entrada. La
                    misma pantalla pedia contar antes de mirar la cifra y la
                    ponia en grande al lado del campo. Quien quiera verla
                    -el dueño revisando a media tarde- la abre a proposito, y
                    al cerrar el turno la diferencia sale en la tabla. */}
                <details className="group rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                    <Icon name="visibility" size={16} />
                    Ver lo esperado
                  </summary>
                  <p className="tabular mt-2 text-2xl font-bold text-[var(--color-text-primary)]">
                    RD$ {money(Number(abierto.esperado_ahora))}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    fondo + efectivo cobrado. Si vas a contar, cuéntalo antes de abrir esto.
                  </p>
                </details>
              </section>

              {puedeCerrar ? (
                <form action={cerrarTurnoForm} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <input type="hidden" name="shiftId" value={abierto.id} />
                  <label className="flex w-44 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Efectivo contado
                    <input
                      name="countedCash"
                      required
                      inputMode="decimal"
                      placeholder="0.00"
                      className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-right text-sm text-[var(--color-text-primary)]"
                    />
                  </label>
                  <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Notas (opcional)
                    <input
                      name="notes"
                      placeholder="Faltaron 50 del vuelto de la manana"
                      className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                    />
                  </label>
                  <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                    <Icon name="lock_clock" size={18} />
                    Cerrar turno
                  </BotonEnvio>
                  <p className="w-full text-xs text-[var(--color-text-muted)]">
                    Cuenta los billetes ANTES de mirar lo esperado: si primero ves la cifra, ya no
                    estas contando, estas confirmando.
                  </p>
                </form>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">
                  Tu rol no puede cerrar la caja.
                </p>
              )}
            </CardBody>
          </Card>
        )}

        {shifts.length === 0 ? (
          <EmptyState
            icon="schedule"
            title="Todavia no hay turnos"
            description="Abre el primero desde la caja para empezar a vender."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Caja</TH>
                <TH>Cajero</TH>
                <TH>Abierto</TH>
                <TH>Cerrado</TH>
                <TH numeric>Tickets</TH>
                <TH numeric>Esperado</TH>
                <TH numeric>Contado</TH>
                <TH numeric>Diferencia</TH>
              </TR>
            </THead>
            <TBody>
              {shifts.map((s) => {
                const dif = s.variance !== null ? Number(s.variance) : null
                return (
                  <TR key={s.id}>
                    <TD className="font-medium text-[var(--color-text-primary)]">
                      {s.warehouse_name}
                      {s.status === 'open' && (
                        <Badge tone="info" className="ml-2">
                          abierto
                        </Badge>
                      )}
                    </TD>
                    <TD>{s.cashier_name ?? '—'}</TD>
                    <TD>{hora(s.opened_at)}</TD>
                    <TD>{s.closed_at ? hora(s.closed_at) : '—'}</TD>
                    <TD numeric>
                      <span className="tabular">{s.tickets}</span>
                    </TD>
                    <TD numeric>
                      {/* Mientras el turno siga abierto, lo esperado no se
                          enseña aqui tampoco: seria el mismo atajo para no
                          contar a ciegas que se quito de arriba. */}
                      <span className="tabular">
                        {s.expected_cash !== null ? money(Number(s.expected_cash)) : '—'}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">
                        {s.counted_cash !== null ? money(Number(s.counted_cash)) : '—'}
                      </span>
                    </TD>
                    <TD numeric>
                      {dif === null ? (
                        '—'
                      ) : (
                        <Badge tone={dif === 0 ? 'success' : dif < 0 ? 'danger' : 'warning'}>
                          {dif > 0 ? '+' : ''}
                          {money(dif)}
                        </Badge>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}
