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
             (select count(*) from public.branches b
               where b.company_id = c.id and b.deleted_at is null) as branch_count
      from public.companies c
      where c.tenant_id = ${ctx.tenantId} and c.deleted_at is null
      order by c.is_default desc, c.legal_name`,
  )

  const puedeCrear = exigir(ctx, 'orgs', 'orgs.create').ok
  const puedeEditar = exigir(ctx, 'orgs', 'orgs.edit').ok
  const qs = ctx.demoQs

  /** Columnas que se repiten sin importar si la fila es editable. */
  const colsComunes = (c: CompanyRow) => (
    <>
      <TD>{c.currency}</TD>
      <TD numeric>
        <span className="tabular">{c.branch_count}</span>
      </TD>
      <TD>
        {c.is_default ? (
          <Badge tone="brand">Principal</Badge>
        ) : puedeEditar ? (
          <form action={marcarPrincipalForm} className="inline">
            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
            <input type="hidden" name="id" value={c.id} />
            <BotonEnvio
              
              className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
              Hacer principal
            </BotonEnvio>
          </form>
        ) : (
          '—'
        )}
      </TD>
    </>
  )

  return (
    <Shell {...shell} activePath="/empresas">
      <div className="space-y-5">
        <PageHeader
          icon="apartment"
          title="Empresas"
          description="Cada razon social (RNC) factura por separado; la configuracion se hereda de la principal."
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

        <Table>
          <THead>
            <TR>
              <TH>Razon social y RNC</TH>
              <TH>Moneda</TH>
              <TH numeric>Sucursales</TH>
              <TH>Principal</TH>
            </TR>
          </THead>
          <TBody>
            {companies.map((c) =>
              puedeEditar ? (
                <TR key={c.id}>
                  <TD>
                    <form action={editarEmpresaForm} className="flex flex-wrap items-center gap-1.5">
                      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                      <input type="hidden" name="id" value={c.id} />
                      <input
                        name="legal"
                        required
                        minLength={3}
                        defaultValue={c.legal_name}
                        aria-label={`Razon social de ${c.legal_name}`}
                        className="h-8 min-w-48 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                      />
                      <input
                        name="rnc"
                        defaultValue={c.tax_id ?? ''}
                        placeholder="RNC"
                        aria-label={`RNC de ${c.legal_name}`}
                        className="h-8 w-36 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                      />
                      <BotonEnvio
                        
                        aria-label={`Guardar cambios de ${c.legal_name}`}
                        className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-brand-bright)] transition-colors hover:bg-[var(--color-brand-soft)]">
                        <Icon name="save" size={16} />
                      </BotonEnvio>
                    </form>
                  </TD>
                  {colsComunes(c)}
                </TR>
              ) : (
                <TR key={c.id}>
                  <TD className="font-medium text-[var(--color-text-primary)]">
                    {c.legal_name}
                    {c.tax_id && (
                      <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                        <Mono>{c.tax_id}</Mono>
                      </span>
                    )}
                  </TD>
                  {colsComunes(c)}
                </TR>
              ),
            )}
          </TBody>
        </Table>

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
                  Razon social
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
                <BotonEnvio
                  
                  className="h-10 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
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
                ; las adicionales se cotizan segun §6.2.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
