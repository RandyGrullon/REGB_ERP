import {
  Badge,
  EmptyState,
  Mono,
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
import { modulePage, type DemoParams } from '@/lib/module-page'
import { fechaCorta } from '@/lib/fechas-rd'
import { Shell } from '@/components/Shell'
import { ESTADO_COMISION } from '../estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis comisiones · REGB ERP' }

interface MiComision {
  id: string
  order_number: string
  order_date: string
  customer_name: string
  plan_name: string
  base_amount: string
  commission_amount: string
  status: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const tono = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'paid') return 'success'
  if (s === 'rejected') return 'danger'
  if (s === 'pending') return 'warning'
  return 'neutral'
}

/**
 * Mis comisiones: lo que le toca a quien vende.
 *
 * El Vendedor de fábrica trae `commissions.view.own` desde 0006, pero
 * ninguna pantalla lo usaba: /comisiones pide `commissions.view` (ver las
 * de todos) y al vendedor le salía "No encontramos esta pantalla". Aquí
 * solo se leen las suyas; aprobar y pagar sigue siendo del encargado.
 */
export default async function MisComisionesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'commissions', 'commissions.view.own')

  const comisiones = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<MiComision[]>`
      select ce.id, so.number as order_number, so.order_date::text, cu.name as customer_name,
             cp.name as plan_name, ce.base_amount::text, ce.commission_amount::text, ce.status
      from public.commission_entries ce
      join public.sales_orders so on so.id = ce.sales_order_id
      join public.customers cu on cu.id = so.customer_id
      join public.commission_plans cp on cp.id = ce.plan_id
      where ce.tenant_id = ${ctx.tenantId} and ce.salesperson_id = ${ctx.userId}
      order by so.order_date desc, ce.created_at desc`,
  )

  const suma = (estado: string) =>
    comisiones
      .filter((c) => c.status === estado)
      .reduce((t, c) => t + Number(c.commission_amount), 0)

  return (
    <Shell {...shell} activePath="/comisiones/mias">
      <div className="space-y-5">
        <PageHeader
          icon="percent"
          title="Mis comisiones"
          description="Lo que te toca por cada pedido que vendiste. El encargado la aprueba y después se paga; si una sale rechazada, pregúntale por qué."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Por aprobar" value={`RD$ ${money(suma('pending'))}`} />
          <StatCard label="Aprobadas, por cobrar" value={`RD$ ${money(suma('approved'))}`} />
          <StatCard label="Ya cobradas" value={`RD$ ${money(suma('paid'))}`} />
        </section>

        {comisiones.length === 0 ? (
          <EmptyState
            icon="percent"
            title="Todavía no tienes comisiones"
            description="Aparecen aquí cuando el encargado registra la comisión de un pedido tuyo. Mientras tanto, tus pedidos están en Pedidos."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Pedido</TH>
                <TH>Fecha</TH>
                <TH>Cliente</TH>
                <TH>Plan</TH>
                <TH numeric>Vendido sin ITBIS</TH>
                <TH numeric>Comisión</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {comisiones.map((c) => (
                <TR key={c.id}>
                  <TD className="whitespace-nowrap">
                    <Mono>{c.order_number}</Mono>
                  </TD>
                  <TD className="whitespace-nowrap">{fechaCorta(c.order_date, true)}</TD>
                  <TD className="text-[var(--color-text-primary)]">{c.customer_name}</TD>
                  <TD className="text-[var(--color-text-muted)]">{c.plan_name}</TD>
                  <TD numeric>
                    <span className="tabular">RD$ {money(Number(c.base_amount))}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular font-semibold">
                      RD$ {money(Number(c.commission_amount))}
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={tono(c.status)}>{ESTADO_COMISION[c.status] ?? c.status}</Badge>
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
