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
import { listaVigente } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { asignarListaClienteForm, cambiarEstadoListaForm, crearListaForm } from './actions'
import { ALCANCE_LISTA, ESTADO_LISTA } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Listas de precio · REGB ERP' }

interface ListaRow {
  id: string
  name: string
  scope: string
  customer_name: string | null
  channel: string | null
  start_date: string
  end_date: string | null
  status: string
}

interface ClienteRow {
  id: string
  name: string
  price_list_id: string | null
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

/** Listas de precios (modulo 41): la mas especifica gana siempre, con vigencias reales. */
export default async function ListasPrecioPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'price-lists')

  const { listas, clientes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const l = await tx<ListaRow[]>`
      select pl.id, pl.name, pl.scope, c.name as customer_name, pl.channel,
             pl.start_date::text, pl.end_date::text, pl.status
      from public.price_lists pl
      left join public.customers c on c.id = pl.customer_id
      where pl.tenant_id = ${ctx.tenantId}
      order by pl.created_at desc`

    const cl = await tx<ClienteRow[]>`
      select id, name, price_list_id from public.customers
      where tenant_id = ${ctx.tenantId} and is_active order by name`

    return { listas: l, clientes: cl }
  })

  const hoy = new Date()
  const activas = listas.filter((l) =>
    listaVigente(
      {
        id: l.id,
        scope: l.scope as 'customer' | 'channel' | 'general',
        customerId: null,
        channel: l.channel,
        startDate: new Date(`${l.start_date}T00:00:00`),
        endDate: l.end_date ? new Date(`${l.end_date}T23:59:59`) : null,
        status: l.status,
      },
      hoy,
    ),
  ).length

  const puedeGestionar = exigir(ctx, 'price-lists', 'price-lists.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/listas-precio">
      <div className="space-y-5">
        <PageHeader
          icon="sell"
          title="Listas de precios"
          description="Los pedidos y las cotizaciones toman el precio de aqui solos. Si un cliente tiene una lista asignada, esa manda; si no, la mas especifica vigente hoy: la del cliente, luego la del canal, luego la general. Los precios son sin ITBIS."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Listas vigentes hoy" value={String(activas)} />
          <StatCard label="Listas totales" value={String(listas.length)} />
        </section>

        {listas.length === 0 ? (
          <EmptyState
            icon="sell"
            title="Todavia no hay ninguna lista"
            description="Crea la primera abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Nombre</TH>
                <TH>Alcance</TH>
                <TH>Vigencia</TH>
                <TH>Estado</TH>
                {puedeGestionar && (
                  <TH>
                    <span className="sr-only">Acción</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {listas.map((l) => {
                const vigente = listaVigente(
                  {
                    id: l.id,
                    scope: l.scope as 'customer' | 'channel' | 'general',
                    customerId: null,
                    channel: l.channel,
                    startDate: new Date(`${l.start_date}T00:00:00`),
                    endDate: l.end_date ? new Date(`${l.end_date}T23:59:59`) : null,
                    status: l.status,
                  },
                  hoy,
                )
                return (
                  <TR key={l.id}>
                    <TD>
                      <a
                        href={`/listas-precio/${l.id}${qs}`}
                        className="text-[var(--color-text-primary)] underline-offset-2 hover:underline"
                      >
                        {l.name}
                      </a>
                    </TD>
                    <TD>
                      {ALCANCE_LISTA[l.scope] ?? l.scope}
                      {l.customer_name ? ` · ${l.customer_name}` : ''}
                      {l.channel ? ` · ${l.channel}` : ''}
                    </TD>
                    <TD>
                      <Badge tone={vigente ? 'success' : 'neutral'}>
                        {vigente ? 'Vigente hoy' : 'Fuera de rango'}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge tone={l.status === 'active' ? 'success' : 'neutral'}>
                        {ESTADO_LISTA[l.status] ?? l.status}
                      </Badge>
                    </TD>
                    {puedeGestionar && (
                      <TD>
                        <form action={cambiarEstadoListaForm}>
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="listId" value={l.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={l.status === 'active' ? 'inactive' : 'active'}
                          />
                          <BotonEnvio className="flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                            {l.status === 'active' ? 'Desactivar' : 'Activar'}
                          </BotonEnvio>
                        </form>
                      </TD>
                    )}
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva lista</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearListaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input name="name" required className={claseInput} />
                </label>
                <label className="flex min-w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Alcance
                  <select name="scope" required defaultValue="general" className={claseInput}>
                    {Object.entries(ALCANCE_LISTA).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente (si es por cliente)
                  <select name="customerId" defaultValue="" className={claseInput}>
                    <option value="">—</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Canal (si es por canal)
                  <input name="channel" placeholder="mayoreo" className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Desde
                  <input type="date" name="startDate" required className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Hasta (opcional)
                  <input type="date" name="endDate" className={claseInput} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear lista
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        {puedeGestionar && clientes.length > 0 && listas.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Asignar lista a un cliente</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={asignarListaClienteForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente
                  <select name="customerId" required className={claseInput}>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Lista
                  <select name="listId" defaultValue="" className={claseInput}>
                    <option value="">Sin lista</option>
                    {listas.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  <Icon name="save" size={14} />
                  Asignar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
