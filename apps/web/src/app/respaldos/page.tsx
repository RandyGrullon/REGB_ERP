import { Badge, EmptyState, Table, THead, TBody, TR, TH, TD } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearRespaldo } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Respaldos · REGB ERP' }

interface BackupRow {
  id: string
  kind: string
  size_bytes: number
  created_by_name: string | null
  created_at: string
}

/** Respaldos (S11): tu informacion es tuya, llevatela cuando quieras. */
export default async function RespaldosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'backup')

  const backups = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<BackupRow[]>`
      select b.id, b.kind, b.size_bytes,
             p.display_name as created_by_name, b.created_at::text
      from public.backups b
      left join public.user_profiles p
        on p.tenant_id = b.tenant_id and p.user_id = b.created_by
      where b.tenant_id = ${ctx.tenantId}
      order by b.created_at desc
      limit 50`,
  )

  const puedeCrear = exigir(ctx, 'backup', 'backup.create').ok
  const puedeExportar = exigir(ctx, 'backup', 'backup.export').ok
  const fecha = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Shell {...shell} activePath="/respaldos">
      <div className="max-w-3xl space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Respaldos</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Un snapshot de tus datos en JSON, descargable. Se genera bajo tus propios permisos: el
              respaldo no puede contener lo que tu no ves.
            </p>
          </div>
          {puedeCrear && (
            <form action={crearRespaldo}>
              <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
              <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
              <button
                type="submit"
                className="h-10 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
              >
                Crear respaldo ahora
              </button>
            </form>
          )}
        </div>

        {backups.length === 0 ? (
          <EmptyState
            icon="💾"
            title="Todavia no hay respaldos"
            description='Pulsa "Crear respaldo ahora". En produccion ademas se genera uno automatico cada noche.'
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Tipo</TH>
                <TH numeric>Tamano</TH>
                <TH>Creado por</TH>
                <TH>
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {backups.map((b) => (
                <TR key={b.id}>
                  <TD className="font-medium text-[var(--color-text-primary)]">
                    {fecha(b.created_at)}
                  </TD>
                  <TD>
                    <Badge tone={b.kind === 'manual' ? 'info' : 'neutral'}>
                      {b.kind === 'manual' ? 'Manual' : 'Programado'}
                    </Badge>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{(b.size_bytes / 1024).toFixed(1)} KB</span>
                  </TD>
                  <TD>{b.created_by_name ?? '—'}</TD>
                  <TD>
                    {puedeExportar && (
                      <a
                        href={`/respaldos/${b.id}/descargar${ctx.demoQs}`}
                        className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                      >
                        Descargar JSON
                      </a>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}
