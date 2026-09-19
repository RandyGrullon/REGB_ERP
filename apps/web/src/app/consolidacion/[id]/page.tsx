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
import {
  buildConsolidationWorksheet,
  eliminationImpact,
  type AccountType,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { BotonEnvio } from '@/components/BotonEnvio'
import { capturarEliminacionForm, cerrarCorridaForm, quitarEliminacionForm } from '../actions'

export const dynamic = 'force-dynamic'

interface CorridaHead {
  id: string
  group_id: string
  group_name: string
  presentation_currency: string
  period_start: string
  period_end: string
  status: string
  closed_at: string | null
}

interface MiembroRow {
  company_id: string
  nombre: string
  is_parent: boolean
}

interface CuentaRow {
  id: string
  code: string
  name: string
  type: AccountType
}

interface SaldoRow {
  company_id: string
  account_id: string
  total_debit: string
  total_credit: string
}

interface EliminacionRow {
  id: string
  from_nombre: string
  to_nombre: string
  debit_account_id: string
  credit_account_id: string
  debit_code: string
  credit_code: string
  amount: string
  kind: string
  description: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fecha = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

const TIPO_CUENTA: Record<string, string> = {
  asset: 'Activo',
  liability: 'Pasivo',
  equity: 'Patrimonio',
  revenue: 'Ingreso',
  expense: 'Gasto',
}

const TIPO_ELIMINACION: Record<string, string> = {
  revenue_expense: 'Venta entre empresas',
  receivable_payable: 'Deuda entre empresas',
  dividend: 'Dividendo',
  other: 'Otra',
}

/**
 * La corrida (modulo 28): la hoja de trabajo clasica -una columna por
 * empresa, una de eliminaciones, una consolidada-.
 *
 * El consolidado NO se lee de ninguna tabla: se deriva en vivo de la foto
 * congelada mas las eliminaciones, con buildConsolidationWorksheet(). Por
 * eso la hoja cambia en el momento en que se captura una eliminacion, sin
 * recalcular ni reguardar nada.
 */
export default async function CorridaConsolidacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'consolidation')

  const [head, miembros, cuentas, saldos, eliminaciones, sinEmpresa] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const [h] = await tx<CorridaHead[]>`
        select cr.id, cr.group_id, g.name as group_name, g.presentation_currency,
               cr.period_start::text, cr.period_end::text, cr.status, cr.closed_at::text
        from public.consolidation_runs cr
        join public.consolidation_groups g on g.id = cr.group_id
        where cr.id = ${id} and cr.tenant_id = ${ctx.tenantId}`
      if (!h) return [null, [], [], [], [], 0] as const

      // Las empresas salen de la FOTO de la corrida, no de la lista de
      // miembros de hoy.
      //
      // La foto (consolidation_run_balances) es inmutable por trigger,
      // pero si las columnas se sacaran de `consolidation_group_members`,
      // quitar una empresa del grupo reescribiria hacia atras un
      // consolidado ya cerrado y entregado. Y en silencio: como cada
      // asiento pertenece a UNA empresa y cada asiento cuadra, al perder
      // una columna entera la hoja sigue con debito = credito. Nada se
      // ve torcido; solo el total es otro.
      //
      // `is_parent` si se lee de la configuracion viva -es una etiqueta
      // de presentacion, no un numero-, con left join para que una
      // empresa que ya salio del grupo siga apareciendo en su corrida.
      const m = await tx<MiembroRow[]>`
        select b.company_id,
               coalesce(gm.is_parent, false) as is_parent,
               coalesce(c.trade_name, c.legal_name) as nombre
        from (
          select distinct company_id
          from public.consolidation_run_balances
          where run_id = ${h.id} and tenant_id = ${ctx.tenantId}
        ) b
        join public.companies c on c.id = b.company_id
        left join public.consolidation_group_members gm
          on gm.company_id = b.company_id
         and gm.group_id = ${h.group_id}
         and gm.tenant_id = ${ctx.tenantId}
        order by coalesce(gm.is_parent, false) desc, nombre`

      const a = await tx<CuentaRow[]>`
        select id, code, name, type from public.accounts
        where tenant_id = ${ctx.tenantId} and is_active
        order by code`

      const s = await tx<SaldoRow[]>`
        select company_id, account_id, total_debit::text, total_credit::text
        from public.consolidation_run_balances
        where run_id = ${id} and tenant_id = ${ctx.tenantId}`

      const e = await tx<EliminacionRow[]>`
        select el.id, el.amount::text, el.kind, el.description,
               el.debit_account_id, el.credit_account_id,
               coalesce(cf.trade_name, cf.legal_name) as from_nombre,
               coalesce(ct.trade_name, ct.legal_name) as to_nombre,
               ad.code as debit_code, ac.code as credit_code
        from public.consolidation_eliminations el
        join public.companies cf on cf.id = el.from_company_id
        join public.companies ct on ct.id = el.to_company_id
        join public.accounts ad on ad.id = el.debit_account_id
        join public.accounts ac on ac.id = el.credit_account_id
        where el.run_id = ${id} and el.tenant_id = ${ctx.tenantId}
        order by el.created_at`

      // Los asientos que nadie etiqueto. Se cuentan y se dicen: esconder
      // el supuesto -"todo lo sin empresa es de la principal"- es lo que
      // hace que un consolidado se entregue mal sin que nadie lo note.
      const [sin] = await tx<{ c: string }[]>`
        select count(*) as c from public.journal_entries
        where tenant_id = ${ctx.tenantId} and status = 'posted' and company_id is null
          and entry_date between ${h.period_start}::date and ${h.period_end}::date`

      return [h, m, a, s, e, Number(sin?.c ?? 0)] as const
    },
  )

  if (!head) notFound()

  const hoja = buildConsolidationWorksheet({
    companies: miembros.map((m) => ({ id: m.company_id, name: m.nombre })),
    accounts: cuentas,
    balances: saldos.map((s) => ({
      companyId: s.company_id,
      accountId: s.account_id,
      totalDebit: Number(s.total_debit),
      totalCredit: Number(s.total_credit),
    })),
    eliminations: eliminaciones.map((e) => ({
      debitAccountId: e.debit_account_id,
      creditAccountId: e.credit_account_id,
      amount: Number(e.amount),
    })),
  })

  const impacto = eliminationImpact(hoja)
  const abierta = head.status === 'draft'
  const puedeEliminar = abierta && exigir(ctx, 'consolidation', 'consolidation.elimination.create').ok
  const puedeCerrar = abierta && exigir(ctx, 'consolidation', 'consolidation.run.close').ok
  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/consolidacion">
      <div className="space-y-5">
        <PageHeader
          icon="layers"
          title={head.group_name}
          description={`${fecha(head.period_start)} — ${fecha(head.period_end)} · presenta en ${head.presentation_currency}`}
          crumbs={[
            { label: 'Consolidacion', href: `/consolidacion${qs}` },
            { label: head.group_name },
          ]}
        />

        <section aria-label="Lo que se elimino" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Ingreso que no era del grupo"
            value={`${head.presentation_currency} ${money(impacto.revenueRemoved)}`}
            hint="ventas de una empresa a otra de la familia"
          />
          <StatCard
            label="Activo que no era del grupo"
            value={`${head.presentation_currency} ${money(impacto.assetRemoved)}`}
            hint="lo que una le debe a la otra"
          />
          <StatCard
            label="Total consolidado"
            value={`${head.presentation_currency} ${money(hoja.totals.totalDebit)}`}
            hint={hoja.totals.balanced ? 'debito = credito' : 'la hoja no cuadra'}
          />
          <StatCard
            label="Estado"
            value={abierta ? 'Borrador' : 'Cerrada'}
            hint={
              abierta
                ? 'todavia se puede capturar y corregir'
                : `cerrada el ${head.closed_at ? fecha(head.closed_at) : '—'}`
            }
          />
        </section>

        {!hoja.totals.balanced && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-semantic-danger)] bg-[color-mix(in_srgb,var(--color-semantic-danger)_10%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-text-danger)]"
          >
            <Icon name="error" size={18} />
            La hoja consolidada no cuadra: debito {money(hoja.totals.totalDebit)} contra credito{' '}
            {money(hoja.totals.totalCredit)}. Si cada asiento cuadro al contabilizarse, esto no
            deberia pasar nunca.
          </p>
        )}

        {sinEmpresa > 0 && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-text-warning)]"
          >
            <Icon name="warning" size={18} />
            {sinEmpresa} asiento{sinEmpresa === 1 ? '' : 's'} contabilizado
            {sinEmpresa === 1 ? '' : 's'} de este periodo no dice
            {sinEmpresa === 1 ? '' : 'n'} a que empresa pertenece: se sumaron a la empresa
            principal.
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Hoja de trabajo</CardTitle>
          </CardHeader>
          <CardBody>
            {hoja.rows.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Esta corrida no encontro ningun asiento contabilizado en el periodo. Revisa las
                fechas, o que los asientos esten contabilizados y no en borrador.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Cuenta</TH>
                    <TH>Tipo</TH>
                    {miembros.map((m) => (
                      <TH key={m.company_id} numeric>
                        {m.nombre}
                      </TH>
                    ))}
                    <TH numeric>Combinado</TH>
                    <TH numeric>Elim. debito</TH>
                    <TH numeric>Elim. credito</TH>
                    <TH numeric>Consolidado</TH>
                  </TR>
                </THead>
                <TBody>
                  {hoja.rows.map((r) => (
                    <TR key={r.accountId}>
                      <TD>
                        <Mono>{r.accountCode}</Mono> {r.accountName}
                      </TD>
                      <TD>{TIPO_CUENTA[r.type] ?? r.type}</TD>
                      {miembros.map((m) => (
                        <TD key={m.company_id} numeric>
                          <span className="tabular">{money(r.porEmpresa[m.company_id] ?? 0)}</span>
                        </TD>
                      ))}
                      <TD numeric>
                        <span className="tabular">{money(r.combined)}</span>
                      </TD>
                      <TD numeric>
                        <span className="tabular text-[var(--color-text-muted)]">
                          {r.eliminationDebit === 0 ? '—' : money(r.eliminationDebit)}
                        </span>
                      </TD>
                      <TD numeric>
                        <span className="tabular text-[var(--color-text-muted)]">
                          {r.eliminationCredit === 0 ? '—' : money(r.eliminationCredit)}
                        </span>
                      </TD>
                      <TD numeric>
                        <span className="tabular font-semibold">{money(r.consolidated)}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Eliminaciones</CardTitle>
          </CardHeader>
          <CardBody>
            {eliminaciones.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Todavia no se ha eliminado nada. Sin eliminaciones, la columna consolidada es la
                simple suma de las empresas -y el grupo se declara mas grande de lo que es-.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Descripcion</TH>
                    <TH>Entre</TH>
                    <TH>Tipo</TH>
                    <TH>Cuentas</TH>
                    <TH numeric>Monto</TH>
                    {puedeEliminar && <TH>Quitar</TH>}
                  </TR>
                </THead>
                <TBody>
                  {eliminaciones.map((e) => (
                    <TR key={e.id}>
                      <TD className="text-[var(--color-text-primary)]">{e.description}</TD>
                      <TD>
                        {e.from_nombre} → {e.to_nombre}
                      </TD>
                      <TD>{TIPO_ELIMINACION[e.kind] ?? e.kind}</TD>
                      <TD>
                        <Mono>{e.debit_code}</Mono> / <Mono>{e.credit_code}</Mono>
                      </TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(e.amount))}</span>
                      </TD>
                      {puedeEliminar && (
                        <TD>
                          <form action={quitarEliminacionForm}>
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="runId" value={head.id} />
                            <input type="hidden" name="eliminationId" value={e.id} />
                            <BotonEnvio
                              aria-label={`Quitar la eliminacion ${e.description}`}
                              className="flex items-center text-[var(--color-text-muted)] hover:text-[var(--color-semantic-text-danger)]"
                            >
                              <Icon name="close" size={16} />
                            </BotonEnvio>
                          </form>
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {puedeEliminar && miembros.length >= 2 && cuentas.length >= 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Eliminar una operacion entre empresas</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={capturarEliminacionForm} className="space-y-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <input type="hidden" name="runId" value={head.id} />
                {miembros.map((m) => (
                  <input key={m.company_id} type="hidden" name="memberId" value={m.company_id} />
                ))}
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Desde
                    <select name="fromCompanyId" required className={claseInput}>
                      {miembros.map((m) => (
                        <option key={m.company_id} value={m.company_id}>
                          {m.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Hacia
                    <select name="toCompanyId" required className={claseInput}>
                      {miembros.map((m) => (
                        <option key={m.company_id} value={m.company_id}>
                          {m.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Tipo
                    <select name="kind" className={claseInput}>
                      <option value="revenue_expense">Venta entre empresas</option>
                      <option value="receivable_payable">Deuda entre empresas</option>
                      <option value="dividend">Dividendo</option>
                      <option value="other">Otra</option>
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Cuenta al debito
                    <select name="debitAccountId" required className={claseInput}>
                      {cuentas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} · {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Cuenta al credito
                    <select name="creditAccountId" required className={claseInput}>
                      {cuentas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} · {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Monto
                    <input
                      name="amount"
                      required
                      inputMode="decimal"
                      placeholder="0.00"
                      className={`tabular text-right ${claseInput}`}
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input
                    name="description"
                    required
                    minLength={3}
                    placeholder="Venta de mercancia de la matriz a la filial"
                    className={claseInput}
                  />
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="remove_circle" size={18} />
                  Eliminar del grupo
                </BotonEnvio>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Es un par: un mismo monto al debito de una cuenta y al credito de otra, asi la
                  consolidacion no se puede descuadrar. Un caso de tres patas se captura como dos
                  eliminaciones.
                </p>
              </form>
            </CardBody>
          </Card>
        )}

        {puedeCerrar && (
          <Card>
            <CardHeader>
              <CardTitle>Cerrar la corrida</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={cerrarCorridaForm} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <input type="hidden" name="runId" value={head.id} />
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  <Icon name="lock" size={18} />
                  Cerrar corrida
                </BotonEnvio>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Una vez cerrada no se edita ni se borra -ni ella, ni su foto de saldos, ni sus
                  eliminaciones-. Si hay que corregir, se genera otra corrida y quedan las dos.
                </p>
              </form>
            </CardBody>
          </Card>
        )}

        {!abierta && (
          <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <Badge tone="success">Cerrada</Badge>
            Este consolidado ya se entrego. Igual que un asiento contabilizado, no se corrige por
            encima: se hace otra corrida.
          </p>
        )}
      </div>
    </Shell>
  )
}
