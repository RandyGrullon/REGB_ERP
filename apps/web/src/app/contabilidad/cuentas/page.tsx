import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  Mono,
  PageHeader,
  SearchField,
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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { alternarCuentaForm, crearCuentaForm } from '../actions'
import { TIPO_CUENTA } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Catalogo de cuentas · REGB ERP' }

interface AccountRow {
  id: string
  code: string
  name: string
  type: string
  is_active: boolean
  lineas: string
}

const inputCls =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

/** Catalogo de cuentas (modulo 16). Lo que usa cada asiento. */
export default async function CuentasPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { q?: string; inactivas?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'accounting', 'accounting.accounts.manage')
  const q = (params.q ?? '').trim()
  const verInactivas = params.inactivas === '1'
  const hayFiltros = q !== '' || verInactivas

  const [cuentas, totales] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const c = await tx<AccountRow[]>`
      select a.id, a.code, a.name, a.type, a.is_active,
             (select count(*) from public.journal_entry_lines l
               where l.account_id = a.id)::text as lineas
      from public.accounts a
      where a.tenant_id = ${ctx.tenantId}
        and (${verInactivas} or a.is_active)
        and (${q} = '' or a.name ilike ${'%' + q + '%'} or a.code ilike ${'%' + q + '%'})
      order by a.code`
    const [t] = await tx<{ activas: string }[]>`
      select count(*) filter (where is_active) as activas
      from public.accounts where tenant_id = ${ctx.tenantId}`
    return [c, t] as const
  })

  const puedeGestionar = exigir(ctx, 'accounting', 'accounting.accounts.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/contabilidad/cuentas">
      <div className="space-y-5">
        <PageHeader
          icon="account_tree"
          title="Catalogo de cuentas"
          description="Lo que usa cada asiento. El tipo decide el saldo normal: activo y gasto son deudores, el resto acreedores."
          crumbs={[{ label: 'Contabilidad', href: `/contabilidad${qs}` }, { label: 'Cuentas' }]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Activas" value={String(totales?.activas ?? 0)} />
          <StatCard label="Mostradas" value={String(cuentas.length)} />
        </section>

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <SearchField defaultValue={q} label="Codigo o nombre" placeholder="1101, Caja…" />
          <label className="flex h-10 items-end gap-1.5 pb-2 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              name="inactivas"
              value="1"
              defaultChecked={verInactivas}
              className="h-4 w-4"
            />
            Ver inactivas
          </label>
          <ToolbarActions hasFilters={hayFiltros} clearHref={`/contabilidad/cuentas${qs}`} />
        </Toolbar>

        {cuentas.length === 0 ? (
          <EmptyState
            icon={hayFiltros ? 'search_off' : 'account_tree'}
            title={hayFiltros ? 'Ninguna cuenta coincide' : 'Todavia no hay cuentas'}
            description={
              hayFiltros
                ? 'Prueba con otro codigo o nombre.'
                : 'Registra la primera abajo. Necesitas al menos dos para armar un asiento.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Codigo</TH>
                <TH>Nombre</TH>
                <TH>Tipo</TH>
                <TH numeric>Movimientos</TH>
                <TH>Estado</TH>
                {puedeGestionar && (
                  <TH>
                    <span className="sr-only">Acciones</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {cuentas.map((c) => (
                <TR key={c.id} className={c.is_active ? '' : 'opacity-50'}>
                  <TD>
                    <Mono>{c.code}</Mono>
                  </TD>
                  <TD className="font-medium text-[var(--color-text-primary)]">{c.name}</TD>
                  <TD>{TIPO_CUENTA[c.type] ?? c.type}</TD>
                  <TD numeric>
                    <span className="tabular">{c.lineas}</span>
                  </TD>
                  <TD>
                    <Badge tone={c.is_active ? 'success' : 'neutral'}>
                      {c.is_active ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </TD>
                  {puedeGestionar && (
                    <TD>
                      <form action={alternarCuentaForm}>
                        <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                        <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                        <input type="hidden" name="id" value={c.id} />
                        <BotonEnvio
                          
                          className="rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]">
                          {c.is_active ? 'Desactivar' : 'Activar'}
                        </BotonEnvio>
                      </form>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar cuenta</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearCuentaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Codigo
                  <input name="code" required placeholder="1101" className={inputCls} />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input name="name" required minLength={2} placeholder="Caja" className={inputCls} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo
                  <select name="type" required className={inputCls}>
                    {Object.entries(TIPO_CUENTA).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Registrar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
