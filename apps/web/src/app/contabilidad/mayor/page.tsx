import { Badge, Icon, Mono, PageHeader, StatCard, TBody, TD, TH, THead, TR, Table } from '@regb/ui'
import { accountBalance, buildTrialBalance, type AccountType } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { TIPO_CUENTA } from '../estados'
import { empresasContables, filasBalanza, type FilaBalanza } from '../consultas'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mayor · REGB ERP' }

interface MovimientoRow {
  entry_id: string
  number: string
  entry_date: string
  description: string
  memo: string | null
  debit: string
  credit: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Mayor (modulo 16): todos los movimientos YA CONTABILIZADOS de una cuenta, con saldo acumulado. */
export default async function MayorPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { cuenta?: string; empresa?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'accounting')
  const cuentaId = /^[0-9a-f-]{36}$/.test(params.cuenta ?? '') ? params.cuenta! : ''

  const [cuentas, cuenta, movimientos, resumen, empresas] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const cs = await tx<{ id: string; code: string; name: string; type: string }[]>`
        select id, code, name, type from public.accounts
        where tenant_id = ${ctx.tenantId} and is_active order by code`
      // Con varias empresas, el mayor es de una -la principal por defecto-,
      // igual que la balanza de la que se llega aquí.
      const es = await empresasContables(tx, ctx.tenantId)
      const elegida =
        es.length > 1 ? (es.find((x) => x.id === params.empresa) ?? es[0]!).id : null

      // Sin cuenta elegida, en vez de una pantalla vacía: las cuentas con
      // movimiento y su saldo, para entrar a la que interese.
      if (!cuentaId) {
        const r = await filasBalanza(tx, ctx.tenantId, null, elegida)
        return [cs, null, [], r, es] as const
      }

      const [c] = await tx<{ id: string; code: string; name: string; type: string }[]>`
        select id, code, name, type from public.accounts
        where id = ${cuentaId} and tenant_id = ${ctx.tenantId}`
      if (!c) return [cs, null, [], [] as FilaBalanza[], es] as const

      const m = await tx<MovimientoRow[]>`
        select e.id as entry_id, e.number, e.entry_date::text, e.description, l.memo,
               l.debit::text, l.credit::text
        from public.journal_entry_lines l
        join public.journal_entries e on e.id = l.entry_id
        where l.account_id = ${cuentaId} and l.tenant_id = ${ctx.tenantId} and e.status = 'posted'
          and (${elegida}::uuid is null
               or coalesce(e.company_id,
                           (select co.id from public.companies co
                             where co.tenant_id = e.tenant_id and co.is_default
                               and co.deleted_at is null limit 1)) = ${elegida}::uuid)
        order by e.entry_date, e.number`
      return [cs, c, m, [] as FilaBalanza[], es] as const
    },
  )
  const empresa =
    empresas.length > 1 ? (empresas.find((x) => x.id === params.empresa) ?? empresas[0]!) : null
  const conMovimiento = buildTrialBalance(resumen).rows

  const qs = ctx.demoQs
  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  let acumulado = 0
  const conSaldo = cuenta
    ? movimientos.map((m) => {
        acumulado += accountBalance(cuenta.type as AccountType, Number(m.debit), Number(m.credit))
        return { ...m, saldo: acumulado }
      })
    : []

  return (
    <Shell {...shell} activePath="/contabilidad">
      <div className="space-y-5">
        <PageHeader
          icon="menu_book"
          title="Mayor"
          description="Todo lo ya contabilizado de una cuenta, con saldo acumulado."
          crumbs={[{ label: 'Contabilidad', href: `/contabilidad${qs}` }, { label: 'Mayor' }]}
          {...(empresa ? { meta: <Badge tone="neutral" dot={false}>{empresa.nombre}</Badge> } : {})}
        />

        <form method="get" className="flex flex-wrap items-end gap-3">
          {qs && (
            <>
              <input type="hidden" name="tenant" value={ctx.tenantSlug} />
              <input type="hidden" name="rol" value={ctx.roleName} />
            </>
          )}
          {empresa && !empresa.principal && (
            <input type="hidden" name="empresa" value={empresa.id} />
          )}
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            Cuenta
            <select
              name="cuenta"
              defaultValue={cuentaId}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
            >
              <option value="">Elige una cuenta…</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
            <Icon name="search" size={18} />
            Ver
          </BotonEnvio>
        </form>

        {!cuenta ? (
          conMovimiento.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
              Todavía no hay ningún asiento contabilizado. Cuando lo haya, aquí verás cada cuenta
              con su saldo.
            </p>
          ) : (
            <section aria-labelledby="con-movimiento" className="space-y-2">
              <h2
                id="con-movimiento"
                className="text-sm font-semibold text-[var(--color-text-primary)]"
              >
                Cuentas con movimiento
              </h2>
              <Table className="min-w-[520px]">
                <THead>
                  <TR>
                    <TH>Cuenta</TH>
                    <TH>Tipo</TH>
                    <TH numeric>Saldo</TH>
                  </TR>
                </THead>
                <TBody>
                  {conMovimiento.map((r) => (
                    <TR key={r.accountId}>
                      <TD>
                        <a
                          href={`/contabilidad/mayor?cuenta=${r.accountId}${empresa && !empresa.principal ? `&empresa=${empresa.id}` : ''}${qs.replace('?', '&')}`}
                          className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                        >
                          <Mono>{r.accountCode}</Mono> {r.accountName}
                        </a>
                      </TD>
                      <TD>{TIPO_CUENTA[r.type] ?? r.type}</TD>
                      <TD numeric>
                        <span className="tabular font-semibold">{money(r.balance)}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <p className="text-xs text-[var(--color-text-muted)]">
                Elige una cuenta arriba, o toca una de la lista, para ver cada movimiento con su
                saldo acumulado.
              </p>
            </section>
          )
        ) : (
          <>
            <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatCard label="Cuenta" value={cuenta.code} hint={cuenta.name} />
              <StatCard label="Tipo" value={TIPO_CUENTA[cuenta.type] ?? cuenta.type} />
              <StatCard
                label="Saldo actual"
                value={`RD$ ${money(acumulado)}`}
                hint={acumulado < 0 ? 'al revés de lo normal' : 'saldo normal de la cuenta'}
              />
            </section>

            {movimientos.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                Esta cuenta todavía no tiene movimientos contabilizados.
              </p>
            ) : (
              <Table className="min-w-[680px]">
                <THead>
                  <TR>
                    <TH>Asiento</TH>
                    <TH>Fecha</TH>
                    <TH>Descripción</TH>
                    <TH numeric>Débito</TH>
                    <TH numeric>Crédito</TH>
                    <TH numeric>Saldo acumulado</TH>
                  </TR>
                </THead>
                <TBody>
                  {conSaldo.map((m, i) => (
                    <TR key={i}>
                      <TD className="whitespace-nowrap">
                        <a
                          href={`/contabilidad/${m.entry_id}${qs}`}
                          className="text-[var(--color-text-link)] hover:underline"
                        >
                          <Mono>{m.number}</Mono>
                        </a>
                      </TD>
                      <TD className="whitespace-nowrap">{fecha(m.entry_date)}</TD>

                      <TD className="text-[var(--color-text-secondary)]">
                        {m.description}
                        {m.memo && (
                          <span className="block text-xs text-[var(--color-text-muted)]">
                            {m.memo}
                          </span>
                        )}
                      </TD>
                      <TD numeric>
                        <span className="tabular">
                          {Number(m.debit) > 0 ? money(Number(m.debit)) : '—'}
                        </span>
                      </TD>
                      <TD numeric>
                        <span className="tabular">
                          {Number(m.credit) > 0 ? money(Number(m.credit)) : '—'}
                        </span>
                      </TD>
                      <TD numeric>
                        <span className="tabular font-semibold">{money(m.saldo)}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}
