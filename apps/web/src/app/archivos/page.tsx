import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { enviarAPapelera, restaurarArchivo, subirArchivo } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Archivos · REGB ERP' }

interface FileRow {
  id: string
  name: string
  mime: string
  size_bytes: number
  uploaded_by_name: string | null
  deleted_at: string | null
  created_at: string
}

function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Archivos (S11): gestor documental con papelera. Nada se borra fisico. */
export default async function ArchivosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { papelera?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'files')
  const enPapelera = params.papelera === '1'

  const files = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<FileRow[]>`
      select f.id, f.name, f.mime, f.size_bytes,
             p.display_name as uploaded_by_name,
             f.deleted_at::text, f.created_at::text
      from public.files f
      left join public.user_profiles p
        on p.tenant_id = f.tenant_id and p.user_id = f.uploaded_by
      where f.tenant_id = ${ctx.tenantId}
        and (f.deleted_at is null) = ${!enPapelera}
      order by f.created_at desc
      limit 200`,
  )

  const puedeCrear = exigir(ctx, 'files', 'files.create').ok
  const puedeBorrar = exigir(ctx, 'files', 'files.delete').ok
  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <Shell {...shell} activePath="/archivos">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Archivos</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {enPapelera
                ? 'Papelera: nada se borra de verdad, todo se puede restaurar.'
                : 'Documentos del negocio: contratos, cedulas, facturas escaneadas.'}
            </p>
          </div>
          <a
            href={
              enPapelera
                ? `/archivos${ctx.demoQs}`
                : `/archivos${ctx.demoQs}${ctx.demoQs ? '&' : '?'}papelera=1`
            }
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
          >
            {enPapelera ? '← Volver a archivos' : '🗑 Papelera'}
          </a>
        </div>

        {files.length === 0 ? (
          <EmptyState
            icon={enPapelera ? '🗑' : '📁'}
            title={enPapelera ? 'La papelera esta vacia' : 'Todavia no hay archivos'}
            description={
              enPapelera
                ? 'Lo que envies a la papelera aparece aqui, listo para restaurar.'
                : 'Sube el primero con el formulario de abajo.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Nombre</TH>
                <TH>Tipo</TH>
                <TH numeric>Tamano</TH>
                <TH>Subido por</TH>
                <TH>Fecha</TH>
                <TH>
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {files.map((f) => (
                <TR key={f.id}>
                  <TD className="font-medium text-[var(--color-text-primary)]">
                    {enPapelera ? (
                      f.name
                    ) : (
                      <a
                        href={`/archivos/${f.id}/descargar${ctx.demoQs}`}
                        className="text-[var(--color-text-link)] hover:underline"
                      >
                        {f.name}
                      </a>
                    )}
                  </TD>
                  <TD>
                    <Badge tone="neutral" dot={false}>
                      {f.mime.split('/')[1] ?? f.mime}
                    </Badge>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{tamano(f.size_bytes)}</span>
                  </TD>
                  <TD>{f.uploaded_by_name ?? '—'}</TD>
                  <TD>{fecha(f.created_at)}</TD>
                  <TD>
                    {puedeBorrar && (
                      <form
                        action={enPapelera ? restaurarArchivo : enviarAPapelera}
                        className="inline"
                      >
                        <input
                          type="hidden"
                          name="tenant"
                          value={ctx.demoQs ? ctx.tenantSlug : ''}
                        />
                        <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                        <input type="hidden" name="id" value={f.id} />
                        <button
                          type="submit"
                          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                        >
                          {enPapelera ? 'Restaurar' : 'A papelera'}
                        </button>
                      </form>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeCrear && !enPapelera && (
          <Card>
            <CardHeader>
              <CardTitle>Subir archivo</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={subirArchivo} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                <input
                  type="file"
                  name="archivo"
                  required
                  className="text-sm text-[var(--color-text-secondary)] file:mr-3 file:rounded-[var(--radius-md)] file:border-0 file:bg-[var(--color-surface-raised)] file:px-3 file:py-2 file:text-sm file:text-[var(--color-text-primary)]"
                />
                <button
                  type="submit"
                  className="h-10 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  Subir
                </button>
                <p className="w-full text-xs text-[var(--color-text-muted)]">
                  Hasta 512 KB por archivo en desarrollo; en produccion el binario vive en Supabase
                  Storage sin este limite.
                </p>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
