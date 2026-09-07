import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { publicarAnuncioForm } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Anuncios · REGB ERP' }

interface AnuncioRow {
  id: string
  title: string
  body: string
  published_at: string
}

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Santo_Domingo',
  })

/** Publicar anuncios para todo el equipo (modulo 70). */
export default async function AnunciosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'hr-portal')

  const anuncios = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<AnuncioRow[]>`
      select id, title, body, published_at::text from public.hr_announcements
      where tenant_id = ${ctx.tenantId} order by published_at desc`,
  )

  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/portal">
      <div className="space-y-5">
        <PageHeader
          icon="campaign"
          title="Anuncios"
          description="Lo que publicas aqui, todo el equipo lo ve en su portal."
          crumbs={[{ label: 'Mi portal', href: `/portal${qs}` }, { label: 'Anuncios' }]}
        />

        <Card>
          <CardHeader>
            <CardTitle>Publicar anuncio</CardTitle>
          </CardHeader>
          <CardBody>
            <form action={publicarAnuncioForm} className="space-y-3">
              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Titulo
                <input name="title" required className={claseInput} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Contenido
                <textarea name="body" required rows={3} className={`${claseInput} h-auto py-2`} />
              </label>
              <button
                type="submit"
                className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
              >
                <Icon name="campaign" size={18} />
                Publicar
              </button>
            </form>
          </CardBody>
        </Card>

        {anuncios.length === 0 ? (
          <EmptyState icon="campaign" title="Todavia no has publicado ningun anuncio" description="" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Titulo</TH>
                <TH>Contenido</TH>
                <TH>Publicado</TH>
              </TR>
            </THead>
            <TBody>
              {anuncios.map((a) => (
                <TR key={a.id}>
                  <TD className="text-[var(--color-text-primary)]">{a.title}</TD>
                  <TD className="max-w-96 truncate">{a.body}</TD>
                  <TD>{fechaHora(a.published_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}
