import { Badge, Card, CardBody, CardHeader, CardTitle, Mono, PageHeader, StatCard } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearEmpresaForm, editarEmpresaForm, marcarPrincipalForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Empresas · REGB ERP' }

interface CompanyRow {
  id: string
  legal_name: string
  trade_name: string | null
  tax_id: string | null
  currency: string
  is_default: boolean
  address: string | null
  phone: string | null
  email: string | null
  branch_count: string
}

/** Multi-empresa (S9): varias razones sociales (RNC) bajo la misma cuenta. */
export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'orgs')

  const companies = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<CompanyRow[]>`
      select c.id, c.legal_name, c.trade_name, c.tax_id, c.currency, c.is_default,
             c.address, c.phone, c.email,
             (select count(*) from public.branches b
               where b.company_id = c.id and b.deleted_at is null) as branch_count
      from public.companies c
      where c.tenant_id = ${ctx.tenantId} and c.deleted_at is null
      order by c.is_default desc, c.legal_name`,
  )

  const puedeCrear = exigir(ctx, 'orgs', 'orgs.create').ok
  const puedeEditar = exigir(ctx, 'orgs', 'orgs.edit').ok
  const qs = ctx.demoQs

  const campo =
    'h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'
  const etiqueta = 'flex flex-col gap-1 text-xs font-semibold text-[var(--color-text-muted)]'

  /** Lo que se ve de una empresa, se pueda editar o no. */
  const pie = (c: CompanyRow) => (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
      {c.is_default && <Badge tone="brand">Principal</Badge>}
      <span>Moneda {c.currency}</span>
      <span aria-hidden>·</span>
      <span>
        {Number(c.branch_count)} {Number(c.branch_count) === 1 ? 'sucursal' : 'sucursales'}
      </span>
    </div>
  )

  return (
    <Shell {...shell} activePath="/empresas">
      <div className="space-y-5">
        <PageHeader
          icon="apartment"
          title="Empresas"
          description="Cada razón social (RNC) factura por separado; la configuración se hereda de la principal."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Empresas" value={String(companies.length)} hint="razones sociales" />
          <StatCard
            label="Sucursales"
            value={String(companies.reduce((a, c) => a + Number(c.branch_count), 0))}
            hint="en total"
          />
          <StatCard
            label="Tu plan"
            value={shell.data.tenant.tier.toUpperCase()}
            hint={
              shell.data.tenant.tier === 'pyme'
                ? 'incluye 1 empresa'
                : shell.data.tenant.tier === 'mediano'
                  ? 'incluye 3 empresas'
                  : 'empresas ilimitadas'
            }
          />
        </section>

        {/* Una tarjeta por empresa y no una tabla: son pocas, y lo que se
            edita (razón social, RNC, dirección, teléfono, correo) no cabía
            en una fila; en el teléfono quedaba un formulario de 900 px
            dentro de una tabla con barra de desplazamiento. */}
        <ul className="grid gap-3 xl:grid-cols-2" aria-label="Tus empresas">
          {companies.map((c) => (
            <li key={c.id}>
              <Card className="h-full">
                <CardHeader className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{c.trade_name || c.legal_name}</CardTitle>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      {c.trade_name && c.trade_name !== c.legal_name ? `${c.legal_name} · ` : ''}
                      RNC {c.tax_id ? <Mono>{c.tax_id}</Mono> : 'sin registrar'}
                    </p>
                  </div>
                  {!c.is_default && puedeEditar && (
                    <form action={marcarPrincipalForm}>
                      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                      <input type="hidden" name="id" value={c.id} />
                      <BotonEnvio className="inline-flex h-11 items-center rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] md:h-9">
                        Hacer principal
                      </BotonEnvio>
                    </form>
                  )}
                </CardHeader>
                <CardBody className="space-y-3">
                  {puedeEditar ? (
                    <form action={editarEmpresaForm} className="grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                      <input type="hidden" name="id" value={c.id} />
                      <label className={`${etiqueta} sm:col-span-2`}>
                        Razón social
                        <input
                          name="legal"
                          required
                          minLength={3}
                          defaultValue={c.legal_name}
                          className={campo}
                        />
                      </label>
                      <label className={etiqueta}>
                        RNC
                        <input
                          name="rnc"
                          defaultValue={c.tax_id ?? ''}
                          placeholder="1-31-12345-6"
                          className={campo}
                        />
                      </label>
                      <label className={etiqueta}>
                        Teléfono
                        <input
                          name="phone"
                          defaultValue={c.phone ?? ''}
                          placeholder="809-555-0101"
                          inputMode="tel"
                          className={campo}
                        />
                      </label>
                      {/* Lo que sale en el ticket y en la factura. Antes no había dónde
                          escribirlo aunque la base lo guardaba. */}
                      <label className={`${etiqueta} sm:col-span-2`}>
                        Dirección (sale en tus tickets y facturas)
                        <input
                          name="address"
                          defaultValue={c.address ?? ''}
                          placeholder="Av. 27 de Febrero #123, Santo Domingo"
                          className={campo}
                        />
                      </label>
                      <label className={`${etiqueta} sm:col-span-2`}>
                        Correo
                        <input
                          name="email"
                          type="email"
                          defaultValue={c.email ?? ''}
                          placeholder="facturacion@tuempresa.do"
                          className={campo}
                        />
                      </label>
                      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
                        {pie(c)}
                        <BotonEnvio className="h-11 rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] md:h-10">
                          Guardar cambios
                        </BotonEnvio>
                      </div>
                    </form>
                  ) : (
                    <>
                      <dl className="grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-[var(--color-text-muted)]">Dirección</dt>
                          <dd className="text-[var(--color-text-primary)]">{c.address ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-[var(--color-text-muted)]">Teléfono</dt>
                          <dd className="text-[var(--color-text-primary)]">{c.phone ?? '—'}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs text-[var(--color-text-muted)]">Correo</dt>
                          <dd className="text-[var(--color-text-primary)]">{c.email ?? '—'}</dd>
                        </div>
                      </dl>
                      {pie(c)}
                    </>
                  )}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>

        {puedeCrear && (
          <Card data-tour="empresa-nueva">
            <CardHeader>
              <CardTitle>Agregar empresa</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearEmpresaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Razón social
                  <input
                    name="legal"
                    required
                    minLength={3}
                    placeholder="Mi Segunda Empresa SRL"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-44 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  RNC
                  <input
                    name="rnc"
                    placeholder="1-31-12345-6"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Moneda
                  <select
                    name="currency"
                    defaultValue="DOP"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    <option value="DOP">DOP</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </label>
                <BotonEnvio className="h-10 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  Agregar
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Tu plan{' '}
                {shell.data.tenant.tier === 'pyme'
                  ? 'PYME incluye 1 empresa'
                  : shell.data.tenant.tier === 'mediano'
                    ? 'MEDIANO incluye 3 empresas'
                    : 'GRANDE incluye empresas ilimitadas'}
                . Si necesitas más, te cotizamos las adicionales.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
