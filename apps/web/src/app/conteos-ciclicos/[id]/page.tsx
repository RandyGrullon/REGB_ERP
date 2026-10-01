import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  Mono,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { countVariance, varianceValue } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  aprobarConteoForm,
  enviarConteoForm,
  rechazarConteoForm,
  registrarLineaConteoForm,
} from '../actions'
import { ESTADO_CONTEO } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'
import { cantidad, cantidadConSigno, pesos, unirFrases } from '@/lib/cantidad'

export const dynamic = 'force-dynamic'

interface ConteoHead {
  id: string
  warehouse_name: string
  status: string
  notes: string | null
  started_at: string
  submitted_at: string | null
  approved_at: string | null
  iniciado_por: string | null
  aprobado_por: string | null
}

interface LineaRow {
  id: string
  product_id: string
  sku: string
  name: string
  unit: string
  system_qty: string
  counted_qty: string | null
  unit_cost: string
}

/** Detalle de un conteo ciclico (modulo 51): ciego mientras se cuenta, comparativo al pedir aprobacion. */
export default async function ConteoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'stock-counts')

  const { head, lineas } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<ConteoHead[]>`
      select cc.id, w.name as warehouse_name, cc.status, cc.notes, cc.started_at::text,
             cc.submitted_at::text, cc.approved_at::text,
             ui.display_name as iniciado_por, ua.display_name as aprobado_por
      from public.cycle_counts cc
      join public.warehouses w on w.id = cc.warehouse_id
      left join public.user_profiles ui on ui.tenant_id = cc.tenant_id and ui.user_id = cc.started_by
      left join public.user_profiles ua on ua.tenant_id = cc.tenant_id and ua.user_id = cc.approved_by
      where cc.id = ${id} and cc.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, lineas: [] }

    const l = await tx<LineaRow[]>`
      select l.id, l.product_id, p.sku, p.name, p.unit,
             l.system_qty::text, l.counted_qty::text, l.unit_cost::text
      from public.cycle_count_lines l
      join public.products p on p.id = l.product_id
      where l.count_id = ${id} and l.tenant_id = ${ctx.tenantId}
      order by p.name`

    return { head: h, lineas: l }
  })

  if (!head) notFound()

  const puedeContar = exigir(ctx, 'stock-counts', 'stock-counts.count').ok
  const puedeAprobar = exigir(ctx, 'stock-counts', 'stock-counts.approve').ok
  // El impacto en pesos es costo × diferencia: quien no ve costos
  // (el almacenista, 0109) cuenta sin ver cuánto vale.
  const veCosto = exigir(ctx, 'inventory', 'inventory.cost.view').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="countId" value={head.id} />
    </>
  )

  const contando = head.status === 'counting'
  const esperandoAprobacion = head.status === 'pending_approval'
  const todoContado = lineas.every((l) => l.counted_qty !== null)
  const contados = lineas.filter((l) => l.counted_qty !== null).length
  const impactoTotal = lineas.reduce((a, l) => {
    if (l.counted_qty === null) return a
    const d = countVariance(Number(l.counted_qty), Number(l.system_qty))
    return a + varianceValue(d, Number(l.unit_cost))
  }, 0)
  const fecha = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
  const historia = [
    `Iniciado el ${fecha(head.started_at)}${head.iniciado_por ? ` por ${head.iniciado_por}` : ''}`,
    head.submitted_at ? `enviado a aprobación el ${fecha(head.submitted_at)}` : null,
    head.approved_at
      ? `${head.status === 'rejected' ? 'rechazado' : 'aprobado'} el ${fecha(head.approved_at)}${head.aprobado_por ? ` por ${head.aprobado_por}` : ''}`
      : null,
  ].filter(Boolean)

  return (
    <Shell {...shell} activePath="/conteos-ciclicos">
      <div className="space-y-5">
        <PageHeader
          icon="checklist"
          title={`Conteo en ${head.warehouse_name}`}
          description={unirFrases([historia.join(' · '), head.notes])}
          crumbs={[
            { label: 'Conteos cíclicos', href: `/conteos-ciclicos${qs}` },
            { label: head.warehouse_name },
          ]}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  head.status === 'approved'
                    ? 'success'
                    : head.status === 'pending_approval'
                      ? 'warning'
                      : head.status === 'rejected'
                        ? 'danger'
                        : 'neutral'
                }
              >
                {ESTADO_CONTEO[head.status] ?? head.status}
              </Badge>
              {contando && puedeContar && (
                <form action={enviarConteoForm}>
                  {campos}
                  <BotonEnvio
                    disabled={!todoContado}
                    title={!todoContado ? 'Todavía hay productos sin contar' : ''}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] disabled:opacity-50"
                  >
                    <Icon name="send" size={14} />
                    Enviar a aprobación
                  </BotonEnvio>
                </form>
              )}
              {esperandoAprobacion && puedeAprobar && (
                <>
                  <form action={aprobarConteoForm}>
                    {campos}
                    <BotonEnvio className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--color-semantic-success)] px-3 text-xs font-medium text-white hover:opacity-90">
                      <Icon name="check" size={14} />
                      Aprobar y ajustar
                    </BotonEnvio>
                  </form>
                  <form action={rechazarConteoForm}>
                    {campos}
                    <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]">
                      <Icon name="close" size={14} />
                      Rechazar
                    </BotonEnvio>
                  </form>
                </>
              )}
            </div>
          }
        />

        {contando ? (
          <Card>
            <CardHeader>
              <CardTitle>
                Conteo ciego: anota lo que hay en el estante ({contados} de {lineas.length}{' '}
                contados)
              </CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    <TH numeric>Contado</TH>
                  </TR>
                </THead>
                <TBody>
                  {lineas.map((l) => (
                    <TR key={l.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        <Mono>{l.sku}</Mono> {l.name}
                      </TD>
                      <TD numeric>
                        {puedeContar ? (
                          <form
                            action={registrarLineaConteoForm}
                            className="inline-flex items-center gap-1"
                          >
                            {campos}
                            <input type="hidden" name="lineId" value={l.id} />
                            <input
                              name="counted"
                              defaultValue={
                                l.counted_qty !== null ? String(Number(l.counted_qty)) : ''
                              }
                              inputMode="decimal"
                              placeholder="—"
                              aria-label={`Cantidad contada de ${l.name}`}
                              className="h-9 w-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                            />
                            <BotonEnvio className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                              Guardar
                            </BotonEnvio>
                          </form>
                        ) : (
                          <span className="tabular">{cantidad(l.counted_qty)}</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH numeric>Sistema</TH>
                <TH numeric>Contado</TH>
                <TH numeric>Diferencia</TH>
                {veCosto && <TH numeric>Impacto</TH>}
              </TR>
            </THead>
            <TBody>
              {lineas.map((l) => {
                const diff =
                  l.counted_qty !== null
                    ? countVariance(Number(l.counted_qty), Number(l.system_qty))
                    : null
                const impacto = diff !== null ? varianceValue(diff, Number(l.unit_cost)) : null
                return (
                  <TR key={l.id}>
                    <TD className="text-[var(--color-text-primary)]">
                      <Mono>{l.sku}</Mono> {l.name}
                    </TD>
                    <TD numeric>
                      <span className="tabular">{cantidad(l.system_qty, l.unit)}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{cantidad(l.counted_qty)}</span>
                    </TD>
                    <TD numeric>
                      {diff !== null && (
                        <Badge
                          tone={diff === 0 ? 'success' : diff < 0 ? 'danger' : 'warning'}
                          dot={false}
                        >
                          {cantidadConSigno(diff)}
                        </Badge>
                      )}
                    </TD>
                    {veCosto && (
                      <TD numeric>
                        {impacto !== null && (
                          <span className="tabular whitespace-nowrap">{pesos(impacto)}</span>
                        )}
                      </TD>
                    )}
                  </TR>
                )
              })}
              {veCosto && (
                <TR>
                  <TD
                    colSpan={4}
                    className="text-right font-semibold text-[var(--color-text-primary)]"
                  >
                    {head.status === 'approved' ? 'Ajuste aplicado' : 'Ajuste si se aprueba'}
                  </TD>
                  <TD numeric>
                    <span className="tabular font-semibold text-[var(--color-text-primary)]">
                      {pesos(impactoTotal)}
                    </span>
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}
