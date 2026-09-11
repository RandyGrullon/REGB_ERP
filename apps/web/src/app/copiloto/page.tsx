import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { preguntarForm } from './actions'
import { FUENTE_LABEL_COPILOTO, PREGUNTAS_EJEMPLO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Copiloto IA · REGB ERP' }

interface Consulta {
  id: string
  question: string
  matched_key: string
  answer_summary: string | null
  created_at: string
}

/** Copiloto IA (modulo 90): nunca genera SQL libre -empareja tu pregunta con el catalogo fijo que ya usa bi-. */
export default async function CopilotoPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'ai-copilot')

  const consultas = await asUser(ctx.userId, ctx.tenantId, (tx) => tx<Consulta[]>`
    select id, question, matched_key, answer_summary, created_at::text
    from public.copilot_queries where tenant_id = ${ctx.tenantId}
    order by created_at desc limit 20`)

  const puedePreguntar = exigir(ctx, 'ai-copilot', 'ai-copilot.view').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/copiloto">
      <div className="space-y-5">
        <PageHeader
          icon="auto_awesome"
          title="Copiloto IA"
          description="Nunca genera una consulta libre: empareja tu pregunta con el mismo catalogo fijo de fuentes vetadas que usa BI & Reportes."
        />

        {puedePreguntar && (
          <Card>
            <CardHeader>
              <CardTitle>Preguntame algo</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={preguntarForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Pregunta
                  <input
                    name="question"
                    required
                    placeholder="¿Cuanto vendimos hoy?"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="send" size={14} />
                  Preguntar
                </BotonEnvio>
              </form>
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                Ejemplos: {PREGUNTAS_EJEMPLO.join(' · ')}
              </p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Historial</CardTitle>
          </CardHeader>
          <CardBody>
            {consultas.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">Todavia no le has preguntado nada.</p>
            ) : (
              <ul className="space-y-3">
                {consultas.map((c) => (
                  <li key={c.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                    <p className="text-xs font-medium text-[var(--color-text-primary)]">{c.question}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{c.answer_summary}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge tone={c.matched_key === 'no_match' ? 'neutral' : 'success'}>
                        {FUENTE_LABEL_COPILOTO[c.matched_key] ?? c.matched_key}
                      </Badge>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {new Date(c.created_at).toLocaleString('es-DO')}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lo que esto no hace</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)]">
              No usa un modelo de lenguaje real todavia -empareja tu pregunta con un catalogo fijo de
              preguntas ya vetadas por palabras clave, sin conexion a ningun proveedor de IA externo-.
              Por eso nunca puede ver datos de otro cliente: no existe ningun camino de codigo que acepte
              una consulta arbitraria.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
