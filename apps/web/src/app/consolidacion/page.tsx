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
import { BotonEnvio } from '@/components/BotonEnvio'
import {
  agregarEmpresaForm,
  crearGrupoForm,
  generarCorridaForm,
  quitarEmpresaForm,
} from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Consolidación · REGB ERP' }

interface GrupoRow {
  id: string
  name: string
  presentation_currency: string
  is_active: boolean
}

interface MiembroRow {
  id: string
  group_id: string
  company_id: string
  nombre: string
  is_parent: boolean
}

interface CorridaRow {
  id: string
  group_id: string
  group_name: string
  period_start: string
  period_end: string
  status: string
  eliminaciones: string
}

interface EmpresaRow {
  id: string
  nombre: string
  currency: string
}

const fecha = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

const ESTADO_CORRIDA: Record<string, { label: string; tone: 'neutral' | 'success' }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  closed: { label: 'Cerrada', tone: 'success' },
}

/**
 * Consolidacion (modulo 28): que empresas se suman juntas y que periodos
 * ya se consolidaron. La hoja de trabajo vive en la corrida, no aqui.
 */
export default async function ConsolidacionPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'consolidation')

  const [grupos, miembros, corridas, empresas] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const g = await tx<GrupoRow[]>`
        select id, name, presentation_currency, is_active
        from public.consolidation_groups
        where tenant_id = ${ctx.tenantId}
        order by is_active desc, name`

      const m = await tx<MiembroRow[]>`
        select gm.id, gm.group_id, gm.company_id, gm.is_parent,
               coalesce(c.trade_name, c.legal_name) as nombre
        from public.consolidation_group_members gm
        join public.companies c on c.id = gm.company_id
        where gm.tenant_id = ${ctx.tenantId}
        order by gm.is_parent desc, nombre`

      const r = await tx<CorridaRow[]>`
        select cr.id, cr.group_id, g.name as group_name,
               cr.period_start::text, cr.period_end::text, cr.status,
               (select count(*) from public.consolidation_eliminations e
                 where e.run_id = cr.id)::text as eliminaciones
        from public.consolidation_runs cr
        join public.consolidation_groups g on g.id = cr.group_id
        where cr.tenant_id = ${ctx.tenantId}
        order by cr.period_end desc, cr.created_at desc
        limit 50`

      const e = await tx<EmpresaRow[]>`
        select id, coalesce(trade_name, legal_name) as nombre, currency
        from public.companies
        where tenant_id = ${ctx.tenantId} and deleted_at is null
        order by is_default desc, nombre`

      return [g, m, r, e] as const
    },
  )

  const puedeGestionar = exigir(ctx, 'consolidation', 'consolidation.group.manage').ok
  const puedeGenerar = exigir(ctx, 'consolidation', 'consolidation.run.create').ok
  const qs = ctx.demoQs

  const gruposListos = grupos.filter(
    (g) => g.is_active && miembros.filter((m) => m.group_id === g.id).length >= 2,
  )

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'
  const claseBotonPrimario =
    'flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'
  const claseBotonSecundario =
    'flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]'

  return (
    <Shell {...shell} activePath="/consolidacion">
      <div className="space-y-5">
        <PageHeader
          icon="layers"
          title="Consolidacion"
          description="Suma tus empresas en un solo estado de grupo, quitando lo que se venden y se deben entre ellas."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Grupos" value={String(grupos.length)} />
          <StatCard label="Empresas en grupos" value={String(miembros.length)} />
          <StatCard label="Corridas" value={String(corridas.length)} />
          <StatCard
            label="Cerradas"
            value={String(corridas.filter((c) => c.status === 'closed').length)}
            hint="una corrida cerrada ya no se toca"
          />
        </section>

        {grupos.length === 0 ? (
          <EmptyState
            icon="layers"
            title="Todavia no hay ningun grupo de consolidacion"
            description="Un grupo son las empresas que se reportan juntas. Registralo abajo, metele al menos dos empresas -una marcada como matriz- y despues genera la corrida del periodo."
          />
        ) : (
          <div className="space-y-4">
            {grupos.map((g) => {
              const suyos = miembros.filter((m) => m.group_id === g.id)
              const disponibles = empresas.filter(
                (e) =>
                  e.currency === g.presentation_currency &&
                  !suyos.some((m) => m.company_id === e.id),
              )
              return (
                <Card key={g.id}>
                  <CardHeader>
                    <CardTitle>
                      {g.name}
                      <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                        presenta en {g.presentation_currency}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardBody>
                    {suyos.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Este grupo todavía no tiene empresas.
                      </p>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {suyos.map((m) => (
                          <li
                            key={m.id}
                            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
                          >
                            {m.nombre}
                            {m.is_parent && <Badge tone="brand">Matriz</Badge>}
                            {puedeGestionar && (
                              <form action={quitarEmpresaForm}>
                                <input
                                  type="hidden"
                                  name="tenant"
                                  value={qs ? ctx.tenantSlug : ''}
                                />
                                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                                <input type="hidden" name="memberId" value={m.id} />
                                <BotonEnvio
                                  aria-label={`Sacar ${m.nombre} del grupo`}
                                  className="flex items-center text-[var(--color-text-muted)] hover:text-[var(--color-semantic-text-danger)]"
                                >
                                  <Icon name="close" size={16} />
                                </BotonEnvio>
                              </form>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {puedeGestionar && (
                      <form
                        action={agregarEmpresaForm}
                        className="mt-3 flex flex-wrap items-end gap-3"
                      >
                        <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                        <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                        <input type="hidden" name="groupId" value={g.id} />
                        <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                          Agregar empresa
                          <select name="companyId" required className={claseInput}>
                            {disponibles.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.nombre}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 pb-2.5 text-xs text-[var(--color-text-muted)]">
                          <input type="checkbox" name="isParent" className="h-4 w-4" />
                          Es la matriz
                        </label>
                        <BotonEnvio
                          disabled={disponibles.length === 0}
                          className={claseBotonSecundario}
                        >
                          <Icon name="add" size={18} />
                          Agregar
                        </BotonEnvio>
                        {disponibles.length === 0 && (
                          <p className="w-full text-xs text-[var(--color-text-muted)]">
                            No queda ninguna empresa en {g.presentation_currency} fuera del grupo.
                            Una empresa en otra moneda no entra: esta consolidacion no traduce
                            moneda.
                          </p>
                        )}
                      </form>
                    )}
                  </CardBody>
                </Card>
              )
            })}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Corridas</CardTitle>
          </CardHeader>
          <CardBody>
            {corridas.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Todavía no se ha consolidado ningún período.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Grupo</TH>
                    <TH>Período</TH>
                    <TH>Estado</TH>
                    <TH numeric>Eliminaciones</TH>
                  </TR>
                </THead>
                <TBody>
                  {corridas.map((c) => {
                    const estado = ESTADO_CORRIDA[c.status] ?? { label: c.status, tone: 'neutral' }
                    return (
                      <TR key={c.id}>
                        <TD>
                          <a
                            href={`/consolidacion/${c.id}${qs}`}
                            className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                          >
                            {c.group_name}
                          </a>
                        </TD>
                        <TD>
                          {fecha(c.period_start)} — {fecha(c.period_end)}
                        </TD>
                        <TD>
                          <Badge tone={estado.tone}>{estado.label}</Badge>
                        </TD>
                        <TD numeric>
                          <span className="tabular">{c.eliminaciones}</span>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {puedeGenerar && gruposListos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Consolidar un período</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={generarCorridaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Grupo
                  <select name="groupId" required className={claseInput}>
                    {gruposListos.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Desde
                  <input name="periodStart" type="date" required className={claseInput} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Hasta
                  <input name="periodEnd" type="date" required className={claseInput} />
                </label>
                <BotonEnvio className={claseBotonPrimario}>
                  <Icon name="layers" size={18} />
                  Generar corrida
                </BotonEnvio>
                <p className="w-full text-xs text-[var(--color-text-muted)]">
                  La corrida congela una foto de los saldos por empresa y cuenta, acumulados hasta
                  la fecha de <strong>Hasta</strong>: <strong>Desde</strong> etiqueta el periodo que
                  se reporta, no recorta la foto. Es a proposito -una deuda entre dos empresas del
                  grupo nacida antes seguiria viva y hay que poder eliminarla-. Un asiento con fecha
                  atrasada que entre después no cambia un consolidado ya generado.
                </p>
              </form>
            </CardBody>
          </Card>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar grupo de consolidación</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearGrupoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    minLength={2}
                    placeholder="Grupo Rodriguez"
                    className={claseInput}
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Moneda
                  <input
                    name="presentationCurrency"
                    defaultValue="DOP"
                    maxLength={3}
                    className={claseInput}
                  />
                </label>
                <BotonEnvio className={claseBotonPrimario}>
                  <Icon name="add" size={18} />
                  Registrar
                </BotonEnvio>
                <p className="w-full text-xs text-[var(--color-text-muted)]">
                  Todas las empresas del grupo tienen que llevar esta misma moneda: el consolidado
                  no las convierte, y sumar pesos con dolares no seria un estado, seria un número.
                </p>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
