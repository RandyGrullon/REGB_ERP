import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
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
import { PRODUCT_COLUMNS, type ImportError } from '@regb/core'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { deshacerImportacion, importarProductos } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Importar · REGB ERP' }

interface BatchRow {
  id: string
  file_name: string
  total_rows: number
  inserted: number
  rejected: number
  errors: ImportError[]
  undone_at: string | null
  created_at: string
  created_by_name: string | null
}

/** Importar (S12): CSV con mapeo automatico, validacion previa y deshacer. */
export default async function ImportarPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'imports')

  const batches = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<BatchRow[]>`
      select b.id, b.file_name, b.total_rows, b.inserted, b.rejected, b.errors,
             b.undone_at::text, b.created_at::text, p.display_name as created_by_name
      from public.import_batches b
      left join public.user_profiles p
        on p.tenant_id = b.tenant_id and p.user_id = b.created_by
      where b.tenant_id = ${ctx.tenantId}
      order by b.created_at desc
      limit 25`,
  )

  const puedeImportar =
    exigir(ctx, 'imports', 'imports.create').ok && exigir(ctx, 'products', 'products.create').ok
  const puedeDeshacer =
    exigir(ctx, 'imports', 'imports.edit').ok && exigir(ctx, 'products', 'products.delete').ok

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Shell {...shell} activePath="/importar">
      <div className="space-y-5">
        <PageHeader
          icon="upload_file"
          title="Importar productos"
          description="Sube tu catalogo desde un CSV. Reconocemos los encabezados solos, validamos antes de guardar y toda importacion se puede deshacer."
          crumbs={[{ label: 'Catalogo', href: `/products${ctx.demoQs}` }, { label: 'Importar' }]}
        />

        {batches.length > 0 && (
          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="Importaciones" value={String(batches.length)} hint="en el historial" />
            <StatCard
              label="Filas cargadas"
              value={String(
                batches.filter((b) => !b.undone_at).reduce((a, b) => a + b.inserted, 0),
              )}
              hint="sin contar las deshechas"
            />
            <StatCard
              label="Rechazadas"
              value={String(batches.reduce((a, b) => a + b.rejected, 0))}
              hint="con su motivo"
            />
          </section>
        )}

        {puedeImportar && (
          <Card>
            <CardHeader>
              <CardTitle>Subir archivo CSV</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={importarProductos} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                <input
                  type="file"
                  name="archivo"
                  accept=".csv,text/csv"
                  required
                  className="text-sm text-[var(--color-text-secondary)] file:mr-3 file:rounded-[var(--radius-md)] file:border-0 file:bg-[var(--color-surface-raised)] file:px-3 file:py-2 file:text-sm file:text-[var(--color-text-primary)]"
                />
                <button
                  type="submit"
                  className="h-10 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  Importar
                </button>
              </form>

              <div className="mt-4 text-xs text-[var(--color-text-secondary)]">
                <p className="mb-1 font-medium text-[var(--color-text-primary)]">
                  Columnas que reconocemos (en cualquier orden, con o sin acentos):
                </p>
                <ul className="space-y-0.5">
                  {(Object.keys(PRODUCT_COLUMNS) as (keyof typeof PRODUCT_COLUMNS)[]).map((k) => (
                    <li key={k}>
                      <Mono>{k}</Mono> — {PRODUCT_COLUMNS[k].join(' · ')}
                      {(k === 'sku' || k === 'name') && (
                        <Badge tone="warning" dot={false} className="ml-2">
                          obligatoria
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </CardBody>
          </Card>
        )}

        <section aria-label="Historial de importaciones">
          <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
            Importaciones anteriores
          </h2>
          {batches.length === 0 ? (
            <EmptyState
              icon="upload_file"
              title="Todavia no has importado nada"
              description="Cuando subas un CSV veras aqui cuantas filas entraron, cuales fallaron y por que — con la opcion de deshacerlo todo."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Archivo</TH>
                  <TH>Cuando</TH>
                  <TH>Quien</TH>
                  <TH numeric>Filas</TH>
                  <TH numeric>Entraron</TH>
                  <TH numeric>Fallaron</TH>
                  <TH>
                    <span className="sr-only">Acciones</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {batches.map((b) => (
                  <TR key={b.id}>
                    <TD className="font-medium text-[var(--color-text-primary)]">
                      {b.file_name}
                      {b.undone_at && (
                        <Badge tone="neutral" dot={false} className="ml-2">
                          deshecha
                        </Badge>
                      )}
                    </TD>
                    <TD>{fecha(b.created_at)}</TD>
                    <TD>{b.created_by_name ?? '—'}</TD>
                    <TD numeric>
                      <span className="tabular">{b.total_rows}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-semantic-text-success)]">
                        {b.inserted}
                      </span>
                    </TD>
                    <TD numeric>
                      <span
                        className={`tabular ${b.rejected > 0 ? 'text-[var(--color-semantic-text-danger)]' : ''}`}
                      >
                        {b.rejected}
                      </span>
                    </TD>
                    <TD>
                      {!b.undone_at && b.inserted > 0 && puedeDeshacer && (
                        <form action={deshacerImportacion} className="inline">
                          <input
                            type="hidden"
                            name="tenant"
                            value={ctx.demoQs ? ctx.tenantSlug : ''}
                          />
                          <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                          <input type="hidden" name="batchId" value={b.id} />
                          <button
                            type="submit"
                            title={`Borra los ${b.inserted} productos que creo esta importacion. No toca ningun otro.`}
                            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                          >
                            Deshacer
                          </button>
                        </form>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          {batches.some((b) => b.errors.length > 0) && (
            <div className="mt-4 space-y-3">
              {batches
                .filter((b) => b.errors.length > 0)
                .slice(0, 3)
                .map((b) => (
                  <details
                    key={b.id}
                    className="rounded-[var(--radius-lg)] border border-[var(--color-border)]"
                  >
                    <summary className="cursor-pointer px-4 py-2 text-sm text-[var(--color-text-secondary)]">
                      {b.rejected} fila{b.rejected === 1 ? '' : 's'} rechazada
                      {b.rejected === 1 ? '' : 's'} en {b.file_name}
                    </summary>
                    <ul className="space-y-1 px-4 pb-3 text-xs text-[var(--color-text-secondary)]">
                      {b.errors.slice(0, 20).map((e, i) => (
                        <li key={i}>
                          {e.row > 0 ? `Linea ${e.row}` : 'Encabezado'} · <Mono>{e.column}</Mono> —{' '}
                          {e.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
            </div>
          )}
        </section>
      </div>
    </Shell>
  )
}
