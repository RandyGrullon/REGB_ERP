import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  FilterSelect,
  Icon,
  PageHeader,
  SearchField,
  StatCard,
  Toolbar,
  ToolbarActions,
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

/**
 * Icono y color segun el tipo de archivo. Reconocer un PDF de un vistazo
 * ahorra mas tiempo que leer su nombre completo.
 */
function pinta(mime: string, name: string): { icon: string; tone: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (mime.startsWith('image/')) return { icon: 'image', tone: 'var(--color-semantic-info)' }
  if (mime === 'application/pdf' || ext === 'pdf')
    return { icon: 'picture_as_pdf', tone: 'var(--color-semantic-danger)' }
  if (['xlsx', 'xls', 'csv'].includes(ext) || mime.includes('spreadsheet'))
    return { icon: 'table', tone: 'var(--color-semantic-success)' }
  if (['doc', 'docx'].includes(ext) || mime.includes('word'))
    return { icon: 'description', tone: 'var(--color-semantic-info)' }
  if (['zip', 'rar', '7z'].includes(ext))
    return { icon: 'folder_zip', tone: 'var(--color-accent-sand)' }
  if (mime.startsWith('text/')) return { icon: 'article', tone: 'var(--color-text-muted)' }
  return { icon: 'draft', tone: 'var(--color-text-muted)' }
}

const TIPOS: { value: string; label: string }[] = [
  { value: '', label: 'Todos los tipos' },
  { value: 'image', label: 'Imagenes' },
  { value: 'pdf', label: 'PDF' },
  { value: 'sheet', label: 'Hojas de calculo' },
  { value: 'doc', label: 'Documentos' },
  { value: 'otro', label: 'Otros' },
]

/** Archivos (S11): gestor documental con papelera. Nada se borra fisico. */
export default async function ArchivosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { papelera?: string; q?: string; tipo?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'files')
  const enPapelera = params.papelera === '1'
  const q = (params.q ?? '').trim()
  const tipo = params.tipo ?? ''

  const [files, totales] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const f = await tx<FileRow[]>`
      select f.id, f.name, f.mime, f.size_bytes,
             p.display_name as uploaded_by_name,
             f.deleted_at::text, f.created_at::text
      from public.files f
      left join public.user_profiles p
        on p.tenant_id = f.tenant_id and p.user_id = f.uploaded_by
      where f.tenant_id = ${ctx.tenantId}
        and (f.deleted_at is null) = ${!enPapelera}
        and (${q} = '' or f.name ilike ${'%' + q + '%'})
        and (${tipo} = ''
             or (${tipo} = 'image'  and f.mime like 'image/%')
             or (${tipo} = 'pdf'    and f.mime = 'application/pdf')
             or (${tipo} = 'sheet'  and (f.mime like '%spreadsheet%' or f.name ilike '%.csv'
                                         or f.name ilike '%.xlsx' or f.name ilike '%.xls'))
             or (${tipo} = 'doc'    and (f.mime like '%word%' or f.name ilike '%.doc'
                                         or f.name ilike '%.docx'))
             or (${tipo} = 'otro'   and f.mime not like 'image/%' and f.mime <> 'application/pdf'
                                     and f.mime not like '%spreadsheet%' and f.mime not like '%word%'))
      order by f.created_at desc
      limit 200`

    const [t] = await tx<{ activos: string; papelera: string; bytes: string }[]>`
      select
        count(*) filter (where deleted_at is null)     as activos,
        count(*) filter (where deleted_at is not null) as papelera,
        coalesce(sum(size_bytes) filter (where deleted_at is null), 0)::text as bytes
      from public.files where tenant_id = ${ctx.tenantId}`
    return [f, t] as const
  })

  const puedeCrear = exigir(ctx, 'files', 'files.create').ok
  const puedeBorrar = exigir(ctx, 'files', 'files.delete').ok
  const qs = ctx.demoQs
  const sep = qs ? '&' : '?'
  const hayFiltros = q !== '' || tipo !== ''

  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })

  const hiddenFields: Record<string, string> = {
    ...(qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}),
    ...(enPapelera ? { papelera: '1' } : {}),
  }

  return (
    <Shell {...shell} activePath="/archivos">
      <div className="space-y-5">
        <PageHeader
          icon={enPapelera ? 'delete' : 'folder_open'}
          title={enPapelera ? 'Papelera' : 'Archivos'}
          description={
            enPapelera
              ? 'Nada se borra de verdad. Lo que esta aqui se puede restaurar cuando quieras.'
              : 'Documentos del negocio: contratos, cedulas, facturas escaneadas.'
          }
          crumbs={
            enPapelera
              ? [{ label: 'Archivos', href: `/archivos${qs}` }, { label: 'Papelera' }]
              : undefined
          }
          actions={
            <a
              href={enPapelera ? `/archivos${qs}` : `/archivos${qs}${sep}papelera=1`}
              className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <Icon name={enPapelera ? 'arrow_back' : 'delete'} size={18} />
              {enPapelera ? 'Volver a archivos' : `Papelera (${totales?.papelera ?? 0})`}
            </a>
          }
        />

        {!enPapelera && (
          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="Archivos" value={String(totales?.activos ?? 0)} hint="guardados" />
            <StatCard label="Espacio" value={tamano(Number(totales?.bytes ?? 0))} hint="en uso" />
            <StatCard
              label="En papelera"
              value={String(totales?.papelera ?? 0)}
              hint="recuperables"
            />
          </section>
        )}

        <Toolbar hidden={hiddenFields}>
          <SearchField defaultValue={q} placeholder="Nombre del archivo…" />
          <FilterSelect label="Tipo" name="tipo" defaultValue={tipo}>
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </FilterSelect>
          <ToolbarActions
            hasFilters={hayFiltros}
            clearHref={`/archivos${qs}${enPapelera ? `${sep}papelera=1` : ''}`}
          />
        </Toolbar>

        {files.length === 0 ? (
          <EmptyState
            icon={hayFiltros ? 'search_off' : enPapelera ? 'delete' : 'folder_open'}
            title={
              hayFiltros
                ? 'Ningun archivo coincide'
                : enPapelera
                  ? 'La papelera esta vacia'
                  : 'Todavia no hay archivos'
            }
            description={
              hayFiltros
                ? 'Prueba con otro nombre o quita el filtro de tipo.'
                : enPapelera
                  ? 'Lo que envies a la papelera aparece aqui, listo para restaurar.'
                  : 'Sube el primero con el formulario de abajo. Contratos, cedulas, cotizaciones: todo junto y buscable.'
            }
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {files.map((f) => {
              const p = pinta(f.mime, f.name)
              return (
                <li
                  key={f.id}
                  className="group flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-overlay)]"
                >
                  <span
                    aria-hidden
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)]"
                    style={{ background: `color-mix(in srgb, ${p.tone} 16%, transparent)` }}
                  >
                    <Icon name={p.icon} size={22} style={{ color: p.tone }} />
                  </span>

                  <div className="min-w-0 flex-1">
                    {enPapelera ? (
                      <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                        {f.name}
                      </p>
                    ) : (
                      <a
                        href={`/archivos/${f.id}/descargar${qs}`}
                        title={f.name}
                        className="block truncate text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        {f.name}
                      </a>
                    )}
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-text-muted)]">
                      <span className="tabular">{tamano(f.size_bytes)}</span>
                      <span aria-hidden>·</span>
                      <span>{fecha(f.created_at)}</span>
                      {f.uploaded_by_name && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate">{f.uploaded_by_name}</span>
                        </>
                      )}
                    </p>
                    {enPapelera && f.deleted_at && (
                      <Badge tone="neutral" dot={false} className="mt-1.5">
                        eliminado {fecha(f.deleted_at)}
                      </Badge>
                    )}
                  </div>

                  {puedeBorrar && (
                    <form
                      action={enPapelera ? restaurarArchivo : enviarAPapelera}
                      className="shrink-0"
                    >
                      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                      <input type="hidden" name="id" value={f.id} />
                      <button
                        type="submit"
                        title={enPapelera ? 'Restaurar' : 'Enviar a la papelera'}
                        aria-label={
                          enPapelera ? `Restaurar ${f.name}` : `Enviar ${f.name} a la papelera`
                        }
                        className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        <Icon name={enPapelera ? 'restore_from_trash' : 'delete'} size={18} />
                      </button>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {puedeCrear && !enPapelera && (
          <Card>
            <CardBody className="pt-4">
              <form action={subirArchivo} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <span
                  aria-hidden
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-lg)] bg-[var(--color-brand-soft)]"
                >
                  <Icon
                    name="cloud_upload"
                    size={22}
                    className="text-[var(--color-brand-bright)]"
                  />
                </span>
                <input
                  type="file"
                  name="archivo"
                  required
                  aria-label="Archivo a subir"
                  className="min-w-52 flex-1 text-sm text-[var(--color-text-secondary)] file:mr-3 file:rounded-[var(--radius-md)] file:border-0 file:bg-[var(--color-surface-overlay)] file:px-3 file:py-2 file:text-sm file:text-[var(--color-text-primary)] hover:file:bg-[var(--color-surface-raised)]"
                />
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  Subir
                </button>
                <p className="w-full text-xs text-[var(--color-text-muted)]">
                  Hasta 512 KB por archivo en desarrollo; en produccion el binario vive en Supabase
                  Storage sin ese limite.
                </p>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
