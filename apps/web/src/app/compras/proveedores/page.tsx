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
import { formatTaxId } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { alternarProveedorForm, crearProveedorForm } from '../actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Proveedores · REGB ERP' }

interface SupplierRow {
  id: string
  name: string
  tax_id: string | null
  phone: string | null
  email: string | null
  payment_terms: number
  is_active: boolean
  ordenes: string
}

const inputCls =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

/** Proveedores (modulo 45). Ficha minima: nombre, RNC y dias de credito. */
export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { q?: string; inactivos?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'purchase-orders', 'purchase-orders.suppliers.manage')
  const q = (params.q ?? '').trim()
  const verInactivos = params.inactivos === '1'
  const hayFiltros = q !== '' || verInactivos

  const [suppliers, totales] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const s = await tx<SupplierRow[]>`
      select s.id, s.name, s.tax_id, s.phone, s.email, s.payment_terms, s.is_active,
             (select count(*) from public.purchase_orders o
               where o.supplier_id = s.id)::text as ordenes
      from public.suppliers s
      where s.tenant_id = ${ctx.tenantId}
        and (${verInactivos} or s.is_active)
        and (${q} = '' or s.name ilike ${'%' + q + '%'} or s.tax_id ilike ${'%' + q + '%'})
      order by s.is_active desc, s.name
      limit 300`
    const [t] = await tx<{ activos: string; credito: string }[]>`
      select count(*) filter (where is_active)                        as activos,
             count(*) filter (where is_active and payment_terms > 0)  as credito
      from public.suppliers where tenant_id = ${ctx.tenantId}`
    return [s, t] as const
  })

  const puedeGestionar = exigir(ctx, 'purchase-orders', 'purchase-orders.suppliers.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/compras/proveedores">
      <div className="space-y-5">
        <PageHeader
          icon="local_shipping"
          title="Proveedores"
          description="A quien le compras. Los usa cada orden de compra."
          crumbs={[{ label: 'Compras', href: `/compras${qs}` }, { label: 'Proveedores' }]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Activos" value={String(totales?.activos ?? 0)} />
          <StatCard label="Con credito" value={String(totales?.credito ?? 0)} hint="dias > 0" />
          <StatCard label="Mostrados" value={String(suppliers.length)} />
        </section>

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <SearchField defaultValue={q} label="Nombre o RNC" placeholder="Distribuidora…" />
          <label className="flex h-10 items-end gap-1.5 pb-2 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              name="inactivos"
              value="1"
              defaultChecked={verInactivos}
              className="h-4 w-4"
            />
            Ver inactivos
          </label>
          <ToolbarActions hasFilters={hayFiltros} clearHref={`/compras/proveedores${qs}`} />
        </Toolbar>

        {suppliers.length === 0 ? (
          <EmptyState
            icon={hayFiltros ? 'search_off' : 'local_shipping'}
            title={hayFiltros ? 'Ningun proveedor coincide' : 'Todavia no hay proveedores'}
            description={
              hayFiltros ? 'Prueba con otro nombre.' : 'Registra el primero en el formulario de abajo.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Nombre</TH>
                <TH>RNC</TH>
                <TH>Telefono</TH>
                <TH numeric>Dias credito</TH>
                <TH numeric>Ordenes</TH>
                <TH>Estado</TH>
                {puedeGestionar && (
                  <TH>
                    <span className="sr-only">Acciones</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {suppliers.map((s) => (
                <TR key={s.id} className={s.is_active ? '' : 'opacity-50'}>
                  <TD className="font-medium text-[var(--color-text-primary)]">{s.name}</TD>
                  <TD>{s.tax_id ? <Mono>{formatTaxId(s.tax_id)}</Mono> : '—'}</TD>
                  <TD>{s.phone ?? '—'}</TD>
                  <TD numeric>
                    <span className="tabular">{s.payment_terms}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{s.ordenes}</span>
                  </TD>
                  <TD>
                    <Badge tone={s.is_active ? 'success' : 'neutral'}>
                      {s.is_active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TD>
                  {puedeGestionar && (
                    <TD>
                      <form action={alternarProveedorForm}>
                        <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                        <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                        <input type="hidden" name="id" value={s.id} />
                        <BotonEnvio
                          
                          className="rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]">
                          {s.is_active ? 'Desactivar' : 'Activar'}
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
              <CardTitle>Registrar proveedor</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearProveedorForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input name="name" required className={inputCls} />
                </label>
                <label className="flex w-44 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  RNC / Cedula
                  <input
                    name="taxId"
                    placeholder="130-11111-1"
                    inputMode="numeric"
                    pattern="[\d\s-]{9,13}"
                    title="RNC de 9 digitos o cedula de 11. Opcional."
                    className={inputCls}
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Telefono
                  <input name="phone" placeholder="809-555-0101" className={inputCls} />
                </label>
                <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Correo
                  <input name="email" type="email" className={inputCls} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Dias credito
                  <input name="terms" inputMode="numeric" defaultValue="0" className={inputCls} />
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
