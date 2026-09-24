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
  unlabeledEntriesNotice,
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
  /** Congelados al generar la corrida, no leidos en vivo (0117). */
  unlabeled_entries: number
  unlabeled_amount: string
  unlabeled_included: boolean
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
  /** Una cuenta dormida sigue saliendo en la hoja si la corrida la toco. */
  is_active: boolean
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

  const [head, miembros, cuentas, saldos, eliminaciones] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const [h] = await tx<CorridaHead[]>`
        select cr.id, cr.group_id, g.name as group_name, g.presentation_currency,
               cr.period_start::text, cr.period_end::text, cr.status, cr.closed_at::text,
               cr.unlabeled_entries, cr.unlabeled_amount::text, cr.unlabeled_included
        from public.consolidation_runs cr
        join public.consolidation_groups g on g.id = cr.group_id
        where cr.id = ${id} and cr.tenant_id = ${ctx.tenantId}`
      if (!h) return [null, [], [], [], []] as const

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

      // Las cuentas de LA CORRIDA, no el catalogo activo de hoy. La
      // funcion (0117) devuelve las activas mas toda cuenta que esta
      // corrida haya tocado: desactivar una cuenta en /contabilidad es un
      // clic, y con el filtro `is_active` esa cuenta y su dinero
      // desaparecian de un consolidado ya cerrado y entregado -la hoja se
      // arma recorriendo las cuentas, una cuenta ausente no produce fila-.
      // Mismo motivo por el que las empresas salen de la foto.
      const a = await tx<CuentaRow[]>`
        select id, code, name, type, is_active
        from public.consolidation_run_accounts(${id}::uuid)`

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

      // Los asientos que nadie etiqueto NO se cuentan aqui: vienen en la
      // cabecera, congelados por consolidation_freeze() con la misma
      // ventana que la foto. Contarlos en vivo era el bug: la pantalla
      // miraba `between period_start and period_end` mientras la foto
      // sumaba todo lo anterior, asi que el aviso decia cero con asientos
      // sin etiquetar dentro del consolidado.
      return [h, m, a, s, e] as const
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
  const aviso = unlabeledEntriesNotice({
    entries: head.unlabeled_entries,
    montoTexto: `${head.presentation_currency} ${money(Number(head.unlabeled_amount))}`,
    parentInGroup: head.unlabeled_included,
  })
  // El formulario de captura si mira el catalogo de hoy: una eliminacion
  // NUEVA no deberia poder apuntar a una cuenta que el cliente ya dejo
  // dormida, aunque la hoja historica si la siga pintando.
  const cuentasActivas = cuentas.filter((c) => c.is_active)
  const abierta = head.status === 'draft'
  const puedeEliminar =
    abierta && exigir(ctx, 'consolidation', 'consolidation.elimination.create').ok
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

        <p className="text-xs text-[var(--color-text-muted)]">
          La foto de esta corrida es el ACUMULADO de todo lo contabilizado hasta el{' '}
          {fecha(head.period_end)}, no solo el movimiento entre las dos fechas. Es a proposito: una
          cuenta por cobrar entre dos empresas del grupo nacida antes valdria cero si la foto solo
          mirara el período, y no habria nada que eliminar. Mientras el sistema no tenga cierre
          anual, ingresos y gastos también salen acumulados.
        </p>

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
            label="Total debito consolidado"
            value={`${head.presentation_currency} ${money(hoja.totals.totalDebit)}`}
            hint={
              hoja.totals.balanced
                ? `crédito ${money(hoja.totals.totalCredit)}: cuadra`
                : `crédito ${money(hoja.totals.totalCredit)}: la hoja no cuadra`
            }
          />
          <StatCard
            label="Estado"
            value={abierta ? 'Borrador' : 'Cerrada'}
            hint={
              abierta
                ? 'todavía se puede capturar y corregir'
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
            debería pasar nunca.
          </p>
        )}

        {aviso && (
          <p
            role={aviso.tono === 'danger' ? 'alert' : 'status'}
            className={
              aviso.tono === 'danger'
                ? 'flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-semantic-danger)] bg-[color-mix(in_srgb,var(--color-semantic-danger)_10%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-text-danger)]'
                : 'flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-text-warning)]'
            }
          >
            <Icon name={aviso.tono === 'danger' ? 'error' : 'warning'} size={18} />
            {aviso.texto}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Hoja de trabajo</CardTitle>
          </CardHeader>
          <CardBody>
            {hoja.rows.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Esta corrida no encontro ningún asiento contabilizado en el período. Revisa las
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
                    <TH numeric>Elim. crédito</TH>
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
                Todavía no se ha eliminado nada. Sin eliminaciones, la columna consolidada es la
                simple suma de las empresas -y el grupo se declara más grande de lo que es-.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Descripción</TH>
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

        {puedeEliminar && miembros.length >= 2 && cuentasActivas.length >= 2 && (
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
                      {cuentasActivas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} · {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Cuenta al crédito
                    <select name="creditAccountId" required className={claseInput}>
                      {cuentasActivas.map((c) => (
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
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="remove_circle" size={18} />
                  Eliminar del grupo
                </BotonEnvio>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Es un par: un mismo monto al debito de una cuenta y al credito de otra, asi la
                  consolidación no se puede descuadrar. Un caso de tres patas se captura como dos
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
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
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
