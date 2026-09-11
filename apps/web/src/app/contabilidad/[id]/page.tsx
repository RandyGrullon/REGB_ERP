import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
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
import { validateEntryLines } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ESTADOS } from '../estados'
import {
  agregarLineaForm,
  borrarAsientoForm,
  contabilizarAsientoForm,
  quitarLineaForm,
} from '../actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface EntryHead {
  id: string
  number: string
  entry_date: string
  description: string
  status: string
}

interface LineRow {
  id: string
  account_id: string
  account_code: string
  account_name: string
  debit: string
  credit: string
  memo: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Ficha del asiento: agregar/quitar lineas, contabilizar, borrar borrador. */
export default async function AsientoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'accounting')

  const [head, lines, cuentas] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<EntryHead[]>`
      select id, number, entry_date::text, description, status
      from public.journal_entries
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    if (!h) return [null, [], []] as const

    const l = await tx<LineRow[]>`
      select l.id, l.account_id, a.code as account_code, a.name as account_name,
             l.debit::text, l.credit::text, l.memo
      from public.journal_entry_lines l
      join public.accounts a on a.id = l.account_id
      where l.entry_id = ${id} and l.tenant_id = ${ctx.tenantId}
      order by a.code`

    const c =
      h.status === 'draft'
        ? await tx<{ id: string; code: string; name: string }[]>`
            select id, code, name from public.accounts
            where tenant_id = ${ctx.tenantId} and is_active order by code`
        : []

    return [h, l, c] as const
  })

  if (!head) notFound()

  const e = ESTADOS[head.status] ?? { label: head.status, tone: 'neutral' as const }
  const enBorrador = head.status === 'draft'
  const totalDebito = lines.reduce((a, l) => a + Number(l.debit), 0)
  const totalCredito = lines.reduce((a, l) => a + Number(l.credit), 0)
  const validacion = validateEntryLines(
    lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) })),
  )

  const puedeEditar = exigir(ctx, 'accounting', 'accounting.entry.create').ok
  const puedeContabilizar = exigir(ctx, 'accounting', 'accounting.entry.post').ok
  const puedeBorrar = exigir(ctx, 'accounting', 'accounting.entry.delete').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="entryId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/contabilidad">
      <div className="space-y-5">
        <PageHeader
          icon="account_balance"
          title={head.number}
          description={`${head.description} · ${fecha(head.entry_date)}`}
          crumbs={[{ label: 'Contabilidad', href: `/contabilidad${qs}` }, { label: head.number }]}
          meta={<Badge tone={e.tone}>{e.label}</Badge>}
          actions={
            <>
              {enBorrador && puedeContabilizar && (
                <form action={contabilizarAsientoForm}>
                  {campos}
                  <BotonEnvio
                    
                    disabled={!validacion.ok}
                    title={
                      validacion.ok
                        ? 'Deja el asiento inmutable: se corrige con uno inverso, no editando'
                        : validacion.error
                    }
                    className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] disabled:cursor-not-allowed disabled:opacity-40">
                    <Icon name="check_circle" size={18} />
                    Contabilizar
                  </BotonEnvio>
                </form>
              )}
              {enBorrador && puedeBorrar && (
                <form action={borrarAsientoForm}>
                  {campos}
                  <BotonEnvio
                    
                    title="Solo se puede borrar un borrador; nunca uno ya contabilizado"
                    className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-semantic-text-danger)] transition-colors hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                    <Icon name="delete" size={18} />
                    Borrar
                  </BotonEnvio>
                </form>
              )}
            </>
          }
        />

        <section aria-label="Totales" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Debito" value={`RD$ ${money(totalDebito)}`} />
          <StatCard label="Credito" value={`RD$ ${money(totalCredito)}`} />
          <StatCard
            label="Diferencia"
            value={`RD$ ${money(Math.abs(totalDebito - totalCredito))}`}
            hint={totalDebito === totalCredito ? 'cuadra' : 'no cuadra todavia'}
          />
        </section>

        {enBorrador && !validacion.ok && lines.length > 0 && (
          <p className="rounded-[var(--radius-md)] border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
            {validacion.error}
          </p>
        )}

        {lines.length === 0 ? (
          <Card>
            <CardBody className="py-8 text-center text-sm text-[var(--color-text-muted)]">
              Este asiento no tiene lineas todavia. Agrega al menos dos abajo.
            </CardBody>
          </Card>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cuenta</TH>
                <TH>Nota</TH>
                <TH numeric>Debito</TH>
                <TH numeric>Credito</TH>
                {enBorrador && puedeEditar && (
                  <TH>
                    <span className="sr-only">Acciones</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {lines.map((l) => (
                <TR key={l.id}>
                  <TD>
                    <Mono>{l.account_code}</Mono>{' '}
                    <span className="font-medium text-[var(--color-text-primary)]">
                      {l.account_name}
                    </span>
                  </TD>
                  <TD className="text-[var(--color-text-secondary)]">{l.memo ?? '—'}</TD>
                  <TD numeric>
                    <span className="tabular">
                      {Number(l.debit) > 0 ? money(Number(l.debit)) : '—'}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">
                      {Number(l.credit) > 0 ? money(Number(l.credit)) : '—'}
                    </span>
                  </TD>
                  {enBorrador && puedeEditar && (
                    <TD>
                      <form action={quitarLineaForm}>
                        {campos}
                        <input type="hidden" name="lineId" value={l.id} />
                        <BotonEnvio
                          
                          aria-label={`Quitar linea de ${l.account_name}`}
                          className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-semantic-text-danger)]">
                          <Icon name="delete" size={16} />
                        </BotonEnvio>
                      </form>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {enBorrador && puedeEditar && cuentas.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Agregar linea</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={agregarLineaForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cuenta
                  <select
                    name="accountId"
                    required
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {cuentas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Lado
                  <select
                    name="lado"
                    required
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    <option value="debit">Debito</option>
                    <option value="credit">Credito</option>
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nota (opcional)
                  <input
                    name="memo"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Agregar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        {enBorrador && cuentas.length === 0 && (
          <Card>
            <CardBody className="pt-4 text-sm text-[var(--color-text-secondary)]">
              Necesitas al menos una cuenta activa en el catalogo para agregar lineas.{' '}
              <a
                href={`/contabilidad/cuentas${qs}`}
                className="text-[var(--color-text-link)] hover:underline"
              >
                Ir al catalogo
              </a>
              .
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
