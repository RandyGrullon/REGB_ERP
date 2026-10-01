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
import { ESTADO_VACANTE, ETAPA_APLICACION, FUENTE_CANDIDATO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reclutamiento · REGB ERP' }

interface VacanteRow {
  id: string
  title: string
  department: string | null
  status: string
  aplicaciones: string
  en_proceso: string
}

interface CandidatoRow {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  source: string
  vacante: string | null
  etapa: string | null
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

  const [vacantes, candidatos, totalCandidatos] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const v = await tx<VacanteRow[]>`
      select p.id, p.title, p.department, p.status,
             count(a.id)::text as aplicaciones,
             count(a.id) filter (where a.stage not in ('hired', 'rejected'))::text as en_proceso
      from public.recruiting_positions p
      left join public.recruiting_applications a on a.position_id = p.id
      where p.tenant_id = ${ctx.tenantId}
      group by p.id
      order by p.created_at desc`

      // Con su postulación más reciente: a qué vacante y en qué etapa va.
      const c = await tx<CandidatoRow[]>`
      select c.id, c.first_name, c.last_name, c.email, c.phone, c.source,
             ult.title as vacante, ult.stage as etapa
      from public.recruiting_candidates c
      left join lateral (
        select p.title, a.stage from public.recruiting_applications a
        join public.recruiting_positions p on p.id = a.position_id
        where a.candidate_id = c.id
        order by a.applied_at desc limit 1
      ) ult on true
      where c.tenant_id = ${ctx.tenantId} order by c.created_at desc limit 50`

      const [n] = await tx<{ total: string }[]>`
      select count(*)::text as total from public.recruiting_candidates
      where tenant_id = ${ctx.tenantId}`

      return [v, c, Number(n?.total ?? 0)] as const
    },
  )

  const abiertas = vacantes.filter((v) => v.status === 'open').length
  const enProceso = vacantes.reduce((a, v) => a + Number(v.en_proceso), 0)
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
          description="Las vacantes de la empresa y las personas que se postulan, desde que llegan hasta que se contratan. Abre una vacante para mover a sus candidatos de etapa y agendar entrevistas."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Vacantes abiertas" value={String(abiertas)} />
          <StatCard
            label="Candidatos en proceso"
            value={String(enProceso)}
            hint="ni contratados ni descartados"
          />
          <StatCard label="Candidatos registrados" value={String(totalCandidatos)} />
        </section>

        {vacantes.length === 0 ? (
          <EmptyState
            icon="work"
            title="Todavía no hay ninguna vacante"
            description="Una vacante es un puesto que quieres llenar. Créala abajo y después agrégale candidatos."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Vacante</TH>
                <TH>Departamento</TH>
                <TH numeric>Candidatos</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {vacantes.map((v) => (
                <TR key={v.id}>
                  <TD>
                    <a
                      href={`/reclutamiento/${v.id}${qs}`}
                      className="font-semibold text-[var(--color-text-link)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                    >
                      {v.title}
                    </a>
                  </TD>
                  <TD>{v.department ?? '—'}</TD>
                  <TD numeric>
                    <span className="tabular whitespace-nowrap">
                      {v.aplicaciones}
                      {Number(v.en_proceso) > 0 && (
                        <span className="text-[var(--color-text-muted)]">
                          {' '}
                          ({v.en_proceso} en proceso)
                        </span>
                      )}
                    </span>
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
                  Título
                  <input name="title" required className={claseInput} />
                </label>
                <label className="flex min-w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Departamento
                  <input name="department" className={claseInput} />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripción
                  <input name="description" className={claseInput} />
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={18} />
                  Crear vacante
                </BotonEnvio>
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
              <EmptyState
                icon="person"
                title="Todavía no hay ningún candidato"
                description="Registra aquí a quien te mande su currículum o te refieran. Después lo agregas a una vacante."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Nombre</TH>
                    <TH>Contacto</TH>
                    <TH>Fuente</TH>
                    <TH>Postulado a</TH>
                  </TR>
                </THead>
                <TBody>
                  {candidatos.map((c) => (
                    <TR key={c.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        {c.first_name} {c.last_name}
                      </TD>
                      <TD>
                        {c.email ?? '—'}
                        {c.phone && (
                          <span className="block text-xs text-[var(--color-text-muted)]">
                            {c.phone}
                          </span>
                        )}
                      </TD>
                      <TD>{FUENTE_CANDIDATO[c.source] ?? c.source}</TD>
                      <TD>
                        {c.vacante ? (
                          <>
                            {c.vacante}
                            <span className="block text-xs text-[var(--color-text-muted)]">
                              {ETAPA_APLICACION[c.etapa ?? ''] ?? c.etapa}
                            </span>
                          </>
                        ) : (
                          <span className="text-[var(--color-text-muted)]">Sin vacante</span>
                        )}
                      </TD>
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
                  Teléfono
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
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  <Icon name="person_add" size={18} />
                  Registrar candidato
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
