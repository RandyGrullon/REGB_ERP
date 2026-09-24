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
import { daysOverdue, formatTaxId, isValidTaxId } from '@regb/operations'
import { asUser } from '@/lib/db'
import { situacionDeCredito } from '@/lib/credito'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { BotonEnvio } from '@/components/BotonEnvio'
import { EstadoDeCredito } from '@/components/EstadoDeCredito'
import { crearPedidoForm, editarClienteForm } from '../../actions'
import { ESTADOS } from '../../estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cliente · REGB ERP' }

interface Cliente {
  id: string
  name: string
  tax_id: string | null
  phone: string | null
  email: string | null
  address: string | null
  payment_terms: number
  credit_limit: string | null
  late_fee_exempt: boolean
  is_active: boolean
  lista: string | null
}

interface Abierta {
  id: string
  number: string
  due_date: string
  total: string
  saldo: string
}

interface Excepcion {
  id: string
  stage: string
  blocks: string[]
  document_total: string
  oldest_overdue_days: number | null
  reason: string
  authorized_at: string
  quien: string | null
  pedido: string | null
}

interface PedidoRow {
  id: string
  number: string
  status: string
  order_date: string
  total: string
}

const inputCls =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fecha = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

const REGLA: Record<string, string> = { limit: 'limite', overdue: 'vencidas' }

/**
 * Ficha del cliente (0130): corregir sus datos -antes no se podia: un RNC
 * mal digitado se quedaba asi- y ver su credito con los mismos numeros
 * con que se decide un pedido. Las excepciones autorizadas se listan aqui:
 * quien firmo, cuando y por que.
 */
export default async function ClienteFichaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  // La ficha la abre quien gestiona clientes (vendedor) y quien lleva la
  // cartera (contador: fija el limite). Antes pedia solo lo primero y el
  // contador -el que decide cuanto se fia- recibia 404.
  const { ctx, shell } = await modulePage(sp, 'sales-orders')
  const puedeGestionar = exigir(ctx, 'sales-orders', 'sales-orders.customers.manage').ok
  const puedeFijarLimite = exigir(ctx, 'ar', 'ar.credit.manage').ok
  if (!puedeGestionar && !puedeFijarLimite) notFound()

  const datos = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [c] = await tx<Cliente[]>`
      select c.id, c.name, c.tax_id, c.phone, c.email, c.address, c.payment_terms,
             c.credit_limit::text, c.late_fee_exempt, c.is_active,
             pl.name as lista
      from public.customers c
      -- Sin el módulo de listas de precio, la RLS la esconde y queda en null.
      left join public.price_lists pl on pl.id = c.price_list_id
      where c.id = ${id} and c.tenant_id = ${ctx.tenantId}`
    if (!c) return null

    const credito = await situacionDeCredito(tx, ctx.tenantId, id, { montoDocumento: 0 })

    // La cartera y las excepciones las esconde la RLS si `ar` esta apagado.
    const abiertas = await tx<Abierta[]>`
      select id, number, due_date::text, total::text, saldo from (
        select id, number, due_date, total, public.invoice_balance(id)::text as saldo
        from public.customer_invoices
        where tenant_id = ${ctx.tenantId} and customer_id = ${id} and status <> 'void'
      ) f
      where saldo::numeric > 0
      order by due_date`

    const excepciones = await tx<Excepcion[]>`
      select o.id, o.stage, o.blocks, o.document_total::text, o.oldest_overdue_days, o.reason,
             o.authorized_at::text, up.display_name as quien, so.number as pedido
      from public.credit_overrides o
      left join public.user_profiles up
        on up.tenant_id = o.tenant_id and up.user_id = o.authorized_by
      left join public.sales_orders so on so.id = o.order_id
      where o.tenant_id = ${ctx.tenantId} and o.customer_id = ${id}
      order by o.authorized_at desc
      limit 20`

    const pedidos = await tx<PedidoRow[]>`
      select id, number, status, order_date::text, total::text
      from public.sales_orders
      where tenant_id = ${ctx.tenantId} and customer_id = ${id}
      order by order_date desc, number desc
      limit 10`

    const almacenes = await tx<{ id: string; name: string }[]>`
      select id, name from public.warehouses
      where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`

    return { c, credito, abiertas, excepciones, pedidos, almacenes }
  })

  if (!datos) notFound()
  const { c, credito, abiertas, excepciones, pedidos, almacenes } = datos

  const puedeVender = exigir(ctx, 'sales-orders', 'sales-orders.create').ok && c.is_active
  const qs = ctx.demoQs
  const rncMalo = c.tax_id !== null && !isValidTaxId(c.tax_id)
  const hoy = new Date()

  return (
    <Shell {...shell} activePath="/pedidos/clientes">
      <div className="space-y-5">
        <PageHeader
          icon="contacts"
          title={c.name}
          description={
            c.payment_terms === 0 ? 'Paga de contado' : `${c.payment_terms} días de crédito`
          }
          crumbs={[
            { label: 'Pedidos', href: `/pedidos${qs}` },
            { label: 'Clientes', href: `/pedidos/clientes${qs}` },
            { label: c.name },
          ]}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={c.is_active ? 'success' : 'neutral'}>
                {c.is_active ? 'Activo' : 'Inactivo'}
              </Badge>
              {c.tax_id && (
                <span className="text-xs text-[var(--color-text-muted)]">
                  RNC/Ced. <Mono>{formatTaxId(c.tax_id)}</Mono>
                </span>
              )}
              {rncMalo && (
                <Badge
                  tone="danger"
                  title="El digito verificador no cuadra: no se le puede emitir B01"
                >
                  RNC invalido
                </Badge>
              )}
              {c.late_fee_exempt && (
                <Badge tone="neutral" dot={false}>
                  Exento de mora
                </Badge>
              )}
              {c.lista && (
                <span className="text-xs text-[var(--color-text-muted)]">
                  Lista de precios: {c.lista}
                </span>
              )}
            </div>
          }
          actions={
            puedeVender && almacenes.length > 0 ? (
              <form action={crearPedidoForm} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <input type="hidden" name="customerId" value={c.id} />
                {almacenes.length > 1 ? (
                  <select
                    name="warehouseId"
                    aria-label="Almacen que despacha"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {almacenes.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="hidden" name="warehouseId" value={almacenes[0]!.id} />
                )}
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add_shopping_cart" size={18} />
                  Nuevo pedido
                </BotonEnvio>
              </form>
            ) : undefined
          }
        />

        <EstadoDeCredito s={credito} titulo={credito.allowed ? 'Crédito' : 'Crédito bloqueado'} />

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{puedeGestionar ? 'Datos del cliente' : 'Limite de crédito'}</CardTitle>
            </CardHeader>
            <CardBody>
              {!puedeGestionar ? (
                <form action={editarClienteForm} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <input type="hidden" name="id" value={c.id} />
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Limite de credito (RD$)
                    <input
                      name="creditLimit"
                      inputMode="decimal"
                      defaultValue={c.credit_limit ?? ''}
                      placeholder="Sin limite"
                      className={inputCls}
                    />
                    <span className="text-[11px]">
                      Vacio = sin limite. Saldo + pedido nuevo no lo puede pasar sin excepcion.
                    </span>
                  </label>
                  <div className="flex items-end">
                    <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                      <Icon name="save" size={18} />
                      Guardar limite
                    </BotonEnvio>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] sm:col-span-2">
                    {c.phone ? `Tel. ${c.phone}` : 'Sin teléfono registrado'}
                    {c.email ? ` · ${c.email}` : ''}. Los demas datos los corrige quien gestiona
                    clientes.
                  </p>
                </form>
              ) : (
                <form action={editarClienteForm} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <input type="hidden" name="id" value={c.id} />
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)] sm:col-span-2">
                    Nombre o razón social
                    <input
                      name="name"
                      required
                      minLength={2}
                      defaultValue={c.name}
                      className={inputCls}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    RNC / Cedula
                    <input
                      name="taxId"
                      defaultValue={c.tax_id ? formatTaxId(c.tax_id) : ''}
                      inputMode="numeric"
                      pattern="[0-9 \-]{9,13}"
                      title="RNC de 9 digitos o cedula de 11. Opcional."
                      aria-invalid={rncMalo || undefined}
                      className={inputCls}
                    />
                    <span className="text-[11px]">
                      {rncMalo
                        ? 'No es valido: corrigelo para poder emitirle crédito fiscal (B01).'
                        : 'Se verifica el digito. Las facturas ya emitidas no cambian.'}
                    </span>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Dias de crédito
                    <input
                      name="terms"
                      inputMode="numeric"
                      defaultValue={String(c.payment_terms)}
                      title="0 = paga de contado"
                      className={inputCls}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Telefono
                    <input name="phone" defaultValue={c.phone ?? ''} className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Correo
                    <input
                      name="email"
                      type="email"
                      defaultValue={c.email ?? ''}
                      className={inputCls}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)] sm:col-span-2">
                    Direccion
                    <input name="address" defaultValue={c.address ?? ''} className={inputCls} />
                  </label>
                  {puedeFijarLimite && (
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Limite de credito (RD$)
                      <input
                        name="creditLimit"
                        inputMode="decimal"
                        defaultValue={c.credit_limit ?? ''}
                        placeholder="Sin limite"
                        className={inputCls}
                      />
                      <span className="text-[11px]">
                        Vacio = sin limite. Saldo + pedido nuevo no lo puede pasar sin excepcion.
                      </span>
                    </label>
                  )}
                  <div className="flex items-end sm:col-span-2">
                    <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                      <Icon name="save" size={18} />
                      Guardar cambios
                    </BotonEnvio>
                  </div>
                </form>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Facturas con saldo</CardTitle>
            </CardHeader>
            <CardBody>
              {abiertas.length === 0 ? (
                <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                  No debe nada facturado.
                </p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Factura</TH>
                      <TH>Vence</TH>
                      <TH numeric>Saldo</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {abiertas.map((f) => {
                      const dias = daysOverdue(new Date(`${f.due_date}T12:00:00`), hoy)
                      return (
                        <TR key={f.id}>
                          <TD>
                            <a
                              href={`/cobrar/${f.id}${qs}`}
                              className="text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                            >
                              <Mono>{f.number}</Mono>
                            </a>
                          </TD>
                          <TD>
                            {fecha(f.due_date)}
                            {dias > 0 && (
                              <span className="block text-[11px] text-[var(--color-semantic-text-danger)]">
                                {dias} dias de atraso
                              </span>
                            )}
                          </TD>
                          <TD numeric>
                            <span className="tabular font-semibold">{money(Number(f.saldo))}</span>
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Excepciones de crédito autorizadas</CardTitle>
          </CardHeader>
          <CardBody>
            {excepciones.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Nunca se le ha vendido por encima de su crédito.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH>Quien</TH>
                    <TH>Pedido</TH>
                    <TH>Se salto</TH>
                    <TH numeric>Monto</TH>
                    <TH>Motivo</TH>
                  </TR>
                </THead>
                <TBody>
                  {excepciones.map((e) => (
                    <TR key={e.id}>
                      <TD>{fecha(e.authorized_at)}</TD>
                      <TD>{e.quien ?? '—'}</TD>
                      <TD>
                        {e.pedido ? <Mono>{e.pedido}</Mono> : '—'}
                        <span className="block text-[11px] text-[var(--color-text-muted)]">
                          {e.stage === 'confirm' ? 'al confirmar' : 'al facturar'}
                        </span>
                      </TD>
                      <TD>
                        {e.blocks.map((b) => REGLA[b] ?? b).join(' y ')}
                        {e.oldest_overdue_days !== null && e.oldest_overdue_days > 0 && (
                          <span className="block text-[11px] text-[var(--color-text-muted)]">
                            {e.oldest_overdue_days} dias de atraso
                          </span>
                        )}
                      </TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(e.document_total))}</span>
                      </TD>
                      <TD>{e.reason}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {pedidos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Últimos pedidos</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="divide-y divide-[var(--color-border)]">
                {pedidos.map((p) => {
                  const e = ESTADOS[p.status] ?? { label: p.status, tone: 'neutral' as const }
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <a
                        href={`/pedidos/${p.id}${qs}`}
                        className="text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        <Mono>{p.number}</Mono>
                      </a>
                      <span className="text-[var(--color-text-muted)]">{fecha(p.order_date)}</span>
                      <Badge tone={e.tone}>{e.label}</Badge>
                      <span className="tabular ml-auto font-semibold text-[var(--color-text-primary)]">
                        RD$ {money(Number(p.total))}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
