import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
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
import { crearCandidatoForm, crearVacanteForm } from './actions'
import { ESTADO_VACANTE, FUENTE_CANDIDATO } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reclutamiento · REGB ERP' }

interface VacanteRow {
  id: string
  title: string
  department: string | null
  status: string
  aplicaciones: string
}

interface CandidatoRow {
  id: string
  first_name: string
  last_name: string
  email: string | null
  source: string
}

const badgeTono = (estado: string): 'success' | 'warning' | 'neutral' => {
  if (estado === 'open') return 'success'
  if (estado === 'on_hold') return 'warning'
  return 'neutral'
}

/** Reclutamiento / ATS (modulo 65): vacantes, candidatos y su pipeline. */
export default async function ReclutamientoPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'recruiting')

  const [vacantes, candidatos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const v = await tx<VacanteRow[]>`
      select p.id, p.title, p.department, p.status,
             count(a.id)::text as aplicaciones
      from public.recruiting_positions p
      left join public.recruiting_applications a on a.position_id = p.id
      where p.tenant_id = ${ctx.tenantId}
      group by p.id
      order by p.created_at desc`

    const c = await tx<CandidatoRow[]>`
      select id, first_name, last_name, email, source from public.recruiting_candidates
      where tenant_id = ${ctx.tenantId} order by created_at desc limit 20`

    return [v, c] as const
  })

  const abiertas = vacantes.filter((v) => v.status === 'open').length
  const puedeGestionar = exigir(ctx, 'recruiting', 'recruiting.manage-positions').ok
  const puedeCandidatos = exigir(ctx, 'recruiting', 'recruiting.manage-candidates').ok
  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/reclutamiento">
      <div className="space-y-5">
        <PageHeader
          icon="person_add"
          title="Reclutamiento"
          description="Vacantes, candidatos y su pipeline -sin portal publico: los candidatos se registran a mano-."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Vacantes abiertas" value={String(abiertas)} />
          <StatCard label="Candidatos registrados" value={String(candidatos.length)} />
        </section>

        {vacantes.length === 0 ? (
          <EmptyState icon="work" title="Todavia no hay ninguna vacante" description="Registra la primera abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Vacante</TH>
                <TH>Departamento</TH>
                <TH numeric>Aplicaciones</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {vacantes.map((v) => (
                <TR key={v.id}>
                  <TD>
                    <a
                      href={`/reclutamiento/${v.id}${qs}`}
                      className="text-[var(--color-text-primary)] underline-offset-2 hover:underline"
                    >
                      {v.title}
                    </a>
                  </TD>
                  <TD>{v.department ?? '—'}</TD>
                  <TD numeric>
                    <span className="tabular">{v.aplicaciones}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeTono(v.status)}>{ESTADO_VACANTE[v.status] ?? v.status}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva vacante</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearVacanteForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Titulo
                  <input name="title" required className={claseInput} />
                </label>
                <label className="flex min-w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Departamento
                  <input name="department" className={claseInput} />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input name="description" className={claseInput} />
                </label>
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  <Icon name="send" size={18} />
                  Publicar
                </button>
              </form>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Candidatos</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {candidatos.length === 0 ? (
              <EmptyState icon="person" title="Todavia no hay ningun candidato" description="" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Nombre</TH>
                    <TH>Correo</TH>
                    <TH>Fuente</TH>
                  </TR>
                </THead>
                <TBody>
                  {candidatos.map((c) => (
                    <TR key={c.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        {c.first_name} {c.last_name}
                      </TD>
                      <TD>{c.email ?? '—'}</TD>
                      <TD>{FUENTE_CANDIDATO[c.source] ?? c.source}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeCandidatos && (
              <form action={crearCandidatoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input name="firstName" required className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Apellido
                  <input name="lastName" required className={claseInput} />
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Correo
                  <input name="email" type="email" className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Telefono
                  <input name="phone" className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fuente
                  <select name="source" required defaultValue="other" className={claseInput}>
                    {Object.entries(FUENTE_CANDIDATO).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                >
                  <Icon name="person_add" size={18} />
                  Registrar candidato
                </button>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
