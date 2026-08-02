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
import { alternarClienteForm, crearClienteForm } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Clientes · REGB ERP' }

interface CustomerRow {
  id: string
  name: string
  tax_id: string | null
  phone: string | null
  email: string | null
  payment_terms: number
  is_active: boolean
  pedidos: string
}

const inputCls =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

/** Clientes (S20). Los comparten pedidos, POS y cuentas por cobrar. */
export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { q?: string; inactivos?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'sales-orders')
  const q = (params.q ?? '').trim()
  const verInactivos = params.inactivos === '1'
  const hayFiltros = q !== '' || verInactivos

  const [customers, totales] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const c = await tx<CustomerRow[]>`
      select c.id, c.name, c.tax_id, c.phone, c.email, c.payment_terms, c.is_active,
             (select count(*) from public.sales_orders o
               where o.customer_id = c.id)::text as pedidos
      from public.customers c
      where c.tenant_id = ${ctx.tenantId}
        and (${verInactivos} or c.is_active)
        and (${q} = '' or c.name ilike ${'%' + q + '%'} or c.tax_id ilike ${'%' + q + '%'})
      order by c.is_active desc, c.name
      limit 300`
    const [t] = await tx<{ activos: string; credito: string }[]>`
      select count(*) filter (where is_active)                        as activos,
             count(*) filter (where is_active and payment_terms > 0)  as credito
      from public.customers where tenant_id = ${ctx.tenantId}`
    return [c, t] as const
  })

  const puedeGestionar = exigir(ctx, 'sales-orders', 'sales-orders.customers.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/pedidos/clientes">
      <div className="space-y-5">
        <PageHeader
          icon="contacts"
          title="Clientes"
          description="Los usan los pedidos, la caja y las cuentas por cobrar. Los dias de credito deciden cuando vence cada factura."
          crumbs={[{ label: 'Pedidos', href: `/pedidos${qs}` }, { label: 'Clientes' }]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Activos" value={String(totales?.activos ?? 0)} hint="pueden comprar" />
          <StatCard
            label="Con credito"
            value={String(totales?.credito ?? 0)}
            hint="no pagan de contado"
          />
          <StatCard
            label="Mostrando"
            value={String(customers.length)}
            hint={hayFiltros ? 'con los filtros' : 'sin filtrar'}
          />
        </section>

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <SearchField
            defaultValue={q}
            label="Nombre o RNC"
            placeholder="Ferreteria, 130-11111-1…"
          />
          <label className="flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" name="inactivos" value="1" defaultChecked={verInactivos} />
            Ver inactivos
          </label>
          <ToolbarActions hasFilters={hayFiltros} clearHref={`/pedidos/clientes${qs}`} />
        </Toolbar>

        {customers.length === 0 ? (
          <EmptyState
            icon={hayFiltros ? 'search_off' : 'contacts'}
            title={hayFiltros ? 'Ningun cliente coincide' : 'Todavia no hay clientes'}
            description={
              hayFiltros
                ? 'Prueba con otro nombre o RNC.'
                : 'Registra el primero abajo. Con el nombre basta para empezar a vender.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH>RNC / Cedula</TH>
                <TH>Contacto</TH>
                <TH numeric>Credito</TH>
                <TH numeric>Pedidos</TH>
                <TH>Estado</TH>
                {puedeGestionar && (
                  <TH>
                    <span className="sr-only">Acciones</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {customers.map((c) => (
                <TR key={c.id} className={c.is_active ? '' : 'opacity-50'}>
                  <TD className="font-medium text-[var(--color-text-primary)]">{c.name}</TD>
                  <TD>{c.tax_id ? <Mono>{c.tax_id}</Mono> : '—'}</TD>
                  <TD>
                    <span className="text-xs">
                      {c.phone ?? '—'}
                      {c.email && (
                        <>
                          <br />
                          {c.email}
                        </>
                      )}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">
                      {c.payment_terms === 0 ? 'contado' : `${c.payment_terms} d`}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{c.pedidos}</span>
                  </TD>
                  <TD>
                    <Badge tone={c.is_active ? 'success' : 'neutral'}>
                      {c.is_active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TD>
                  {puedeGestionar && (
                    <TD>
                      <form action={alternarClienteForm} className="inline">
                        <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                        <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                        <input type="hidden" name="id" value={c.id} />
                        <button
                          type="submit"
                          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
                        >
                          {c.is_active ? 'Desactivar' : 'Reactivar'}
                        </button>
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
              <CardTitle>Nuevo cliente</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearClienteForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre o razon social
                  <input
                    name="name"
                    required
                    minLength={2}
                    placeholder="Ferreteria El Martillo SRL"
                    className={inputCls}
                  />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  RNC / Cedula
                  <input name="taxId" placeholder="130-11111-1" className={inputCls} />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Telefono
                  <input name="phone" placeholder="809-555-0101" className={inputCls} />
                </label>
                <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Correo
                  <input
                    name="email"
                    type="email"
                    placeholder="compras@cliente.do"
                    className={inputCls}
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Dias de credito
                  <input
                    name="terms"
                    inputMode="numeric"
                    defaultValue="0"
                    title="0 = paga de contado"
                    className={inputCls}
                  />
                </label>
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  <Icon name="person_add" size={18} />
                  Registrar
                </button>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Los dias de credito deciden el vencimiento de la factura. 0 = contado.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
