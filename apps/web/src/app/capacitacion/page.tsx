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
import { nivelPromedioCompetencia } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  asignarNivelCompetenciaForm,
  crearCompetenciaForm,
  crearCursoForm,
  emitirCertificadoForm,
  inscribirEmpleadoForm,
  registrarNotaForm,
} from './actions'
import { ESTADO_INSCRIPCION } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Capacitacion · REGB ERP' }

interface EmpleadoOption {
  id: string
  name: string
}

interface CursoOption {
  id: string
  title: string
  passing_score: number
}

interface InscripcionRow {
  id: string
  course_title: string
  employee_name: string
  status: string
  score: number | null
  tiene_certificado: boolean
}

interface CompetenciaRow {
  id: string
  name: string
}

interface NivelCompetenciaRow {
  competency_name: string
  employee_name: string
  level: number
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

const badgeTono = (estado: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (estado === 'completed') return 'success'
  if (estado === 'enrolled') return 'warning'
  if (estado === 'failed') return 'danger'
  return 'neutral'
}

/** Capacitacion / LMS (modulo 67): cursos, notas contra el minimo real, certificados y matriz de competencias. */
export default async function CapacitacionPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'training')

  const { empleados, cursos, inscripciones, competencias, niveles } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const e = await tx<EmpleadoOption[]>`
        select id, first_name || ' ' || last_name as name from public.employees
        where tenant_id = ${ctx.tenantId} and status = 'active' order by last_name`

      const c = await tx<CursoOption[]>`
        select id, title, passing_score from public.training_courses
        where tenant_id = ${ctx.tenantId} and status = 'active' order by title`

      const i = await tx<InscripcionRow[]>`
        select en.id, co.title as course_title, em.first_name || ' ' || em.last_name as employee_name,
               en.status, en.score, (cert.id is not null) as tiene_certificado
        from public.training_enrollments en
        join public.training_courses co on co.id = en.course_id
        join public.employees em on em.id = en.employee_id
        left join public.training_certificates cert on cert.enrollment_id = en.id
        where en.tenant_id = ${ctx.tenantId}
        order by en.enrolled_at desc`

      const comp = await tx<CompetenciaRow[]>`
        select id, name from public.training_competencies where tenant_id = ${ctx.tenantId} order by name`

      const niv = await tx<NivelCompetenciaRow[]>`
        select tc.name as competency_name, e.first_name || ' ' || e.last_name as employee_name, tec.level
        from public.training_employee_competencies tec
        join public.training_competencies tc on tc.id = tec.competency_id
        join public.employees e on e.id = tec.employee_id
        where tec.tenant_id = ${ctx.tenantId}
        order by tc.name, e.last_name`

      return { empleados: e, cursos: c, inscripciones: i, competencias: comp, niveles: niv }
    },
  )

  const nivelesPorCompetencia = new Map<string, number[]>()
  for (const n of niveles) {
    const lista = nivelesPorCompetencia.get(n.competency_name) ?? []
    lista.push(n.level)
    nivelesPorCompetencia.set(n.competency_name, lista)
  }

  const enCurso = inscripciones.filter((i) => i.status === 'enrolled').length
  const puedeCursos = exigir(ctx, 'training', 'training.manage-courses').ok
  const puedeInscripciones = exigir(ctx, 'training', 'training.manage-enrollments').ok
  const puedeCompetencias = exigir(ctx, 'training', 'training.manage-competencies').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/capacitacion">
      <div className="space-y-5">
        <PageHeader
          icon="school"
          title="Capacitacion"
          description="Una nota aprueba contra el minimo real de ese curso -nunca un 70% fijo para todos-."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Inscripciones en curso" value={String(enCurso)} />
          <StatCard label="Cursos activos" value={String(cursos.length)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Inscripciones</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {inscripciones.length === 0 ? (
              <EmptyState icon="school" title="Todavia no hay ninguna inscripcion" description="" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Empleado</TH>
                    <TH>Curso</TH>
                    <TH numeric>Nota</TH>
                    <TH>Estado</TH>
                    <TH>Certificado</TH>
                    {puedeInscripciones && (
                      <TH>
                        <span className="sr-only">Accion</span>
                      </TH>
                    )}
                  </TR>
                </THead>
                <TBody>
                  {inscripciones.map((i) => (
                    <TR key={i.id}>
                      <TD className="text-[var(--color-text-primary)]">{i.employee_name}</TD>
                      <TD>{i.course_title}</TD>
                      <TD numeric>
                        <span className="tabular">{i.score ?? '—'}</span>
                      </TD>
                      <TD>
                        <Badge tone={badgeTono(i.status)}>{ESTADO_INSCRIPCION[i.status] ?? i.status}</Badge>
                      </TD>
                      <TD>
                        {i.tiene_certificado ? (
                          <Badge tone="success">Emitido</Badge>
                        ) : i.status === 'completed' ? (
                          '—'
                        ) : (
                          'N/A'
                        )}
                      </TD>
                      {puedeInscripciones && (
                        <TD>
                          {i.status === 'enrolled' && (
                            <form action={registrarNotaForm} className="flex items-center gap-1.5">
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="enrollmentId" value={i.id} />
                              <input
                                name="score"
                                aria-label={`Nota de ${i.employee_name} en ${i.course_title}`}
                                placeholder="Nota"
                                inputMode="numeric"
                                className={`tabular w-16 ${claseInput}`}
                              />
                              <button
                                type="submit"
                                className="flex h-9 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                              >
                                <Icon name="check" size={14} />
                                Registrar
                              </button>
                            </form>
                          )}
                          {i.status === 'completed' && !i.tiene_certificado && (
                            <form action={emitirCertificadoForm} className="flex items-center gap-1.5">
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="enrollmentId" value={i.id} />
                              <input
                                type="date"
                                name="expiresAt"
                                aria-label={`Fecha de vencimiento del certificado de ${i.employee_name}`}
                                className={claseInput}
                              />
                              <button
                                type="submit"
                                className="flex h-9 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                              >
                                <Icon name="workspace_premium" size={14} />
                                Emitir certificado
                              </button>
                            </form>
                          )}
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeInscripciones && cursos.length > 0 && empleados.length > 0 && (
              <form action={inscribirEmpleadoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Empleado
                  <select name="employeeId" required className={claseInput}>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Curso
                  <select name="courseId" required className={claseInput}>
                    {cursos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} (min. {c.passing_score})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  <Icon name="send" size={14} />
                  Inscribir
                </button>
              </form>
            )}
          </CardBody>
        </Card>

        {puedeCursos && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo curso</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearCursoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Titulo
                  <input name="title" required className={claseInput} />
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input name="description" className={claseInput} />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Horas
                  <input name="durationHours" inputMode="decimal" className={`tabular ${claseInput}`} />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Minimo para aprobar
                  <input name="passingScore" defaultValue="70" inputMode="numeric" className={`tabular ${claseInput}`} />
                </label>
                <button
                  type="submit"
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                >
                  <Icon name="add" size={14} />
                  Publicar curso
                </button>
              </form>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Matriz de competencias</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {niveles.length === 0 ? (
              <EmptyState icon="workspace_premium" title="Todavia no hay ninguna competencia evaluada" description="" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Competencia</TH>
                    <TH>Empleado</TH>
                    <TH numeric>Nivel</TH>
                    <TH numeric>Promedio del equipo</TH>
                  </TR>
                </THead>
                <TBody>
                  {niveles.map((n, idx) => (
                    <TR key={idx}>
                      <TD className="text-[var(--color-text-primary)]">{n.competency_name}</TD>
                      <TD>{n.employee_name}</TD>
                      <TD numeric>
                        <span className="tabular">{n.level} / 5</span>
                      </TD>
                      <TD numeric>
                        <span className="tabular font-semibold text-[var(--color-text-primary)]">
                          {nivelPromedioCompetencia(nivelesPorCompetencia.get(n.competency_name) ?? [])} / 5
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeCompetencias && (
              <div className="flex flex-wrap gap-6">
                <form action={crearCompetenciaForm} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Nueva competencia
                    <input name="name" required className={claseInput} />
                  </label>
                  <button
                    type="submit"
                    className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                  >
                    <Icon name="add" size={14} />
                    Agregar
                  </button>
                </form>

                {competencias.length > 0 && empleados.length > 0 && (
                  <form action={asignarNivelCompetenciaForm} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                    <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                    <label className="flex min-w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Empleado
                      <select name="employeeId" required className={claseInput}>
                        {empleados.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Competencia
                      <select name="competencyId" required className={claseInput}>
                        {competencias.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex w-20 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Nivel (1-5)
                      <input name="level" inputMode="numeric" required className={`tabular ${claseInput}`} />
                    </label>
                    <button
                      type="submit"
                      className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                    >
                      <Icon name="save" size={14} />
                      Evaluar
                    </button>
                  </form>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
