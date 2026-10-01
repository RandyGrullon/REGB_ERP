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

  const consultas = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<Consulta[]>`
    select id, question, matched_key, answer_summary, created_at::text
    from public.copilot_queries where tenant_id = ${ctx.tenantId}
    order by created_at desc limit 20`,
  )

  const puedePreguntar = exigir(ctx, 'ai-copilot', 'ai-copilot.view').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/copiloto">
      <div className="space-y-5">
        <PageHeader
          icon="auto_awesome"
          title="Copiloto IA"
          description="Pregúntale con tus palabras por tus ventas, productos, facturas vencidas, prospectos o tickets. Contesta con los mismos reportes de BI y Reportes."
        />

        {puedePreguntar && (
          <Card>
            <CardHeader>
              <CardTitle>Pregúntame algo</CardTitle>
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
                    placeholder="¿Cuánto vendimos hoy?"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="send" size={14} />
                  Preguntar
                </BotonEnvio>
              </form>
              {/* Los ejemplos se pueden tocar: preguntan de una vez. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-[var(--color-text-muted)]">Prueba con:</span>
                {PREGUNTAS_EJEMPLO.map((q) => (
                  <form key={q} action={preguntarForm}>
                    <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                    <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                    <input type="hidden" name="question" value={q} />
                    <BotonEnvio className="inline-flex min-h-11 items-center rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] md:min-h-8">
                      {q}
                    </BotonEnvio>
                  </form>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Historial</CardTitle>
          </CardHeader>
          <CardBody>
            {consultas.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                Todavía no le has preguntado nada.
              </p>
            ) : (
              <ul className="space-y-3">
                {consultas.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
                  >
                    <p className="text-xs font-medium text-[var(--color-text-primary)]">
                      {c.question}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {c.answer_summary}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge tone={c.matched_key === 'no_match' ? 'neutral' : 'success'}>
                        {FUENTE_LABEL_COPILOTO[c.matched_key] ?? c.matched_key}
                      </Badge>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {new Date(c.created_at).toLocaleString('es-DO', {
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone: 'America/Santo_Domingo',
                        })}
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
              Todavía no usa un modelo de lenguaje: reconoce las palabras clave de tu pregunta y la
              contesta con uno de cinco reportes fijos, sin mandar nada a un proveedor de IA de
              afuera. Por eso nunca ve datos de otro negocio: no puede hacer ninguna consulta que no
              esté en esa lista.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
