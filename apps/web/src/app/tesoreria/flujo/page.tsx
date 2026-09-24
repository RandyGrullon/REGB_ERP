import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { buildCashFlowProjection, firstShortfallWeek } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Flujo de caja · REGB ERP' }

const SEMANAS = 8

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Flujo de caja proyectado (modulo 19).
 *
 * Junta tres fuentes: el saldo real de las cuentas bancarias, lo que `ar`
 * espera cobrar y lo que `ap` tiene que pagar. Si el tenant no tiene ar o
 * ap activos, esas consultas devuelven cero filas por su PROPIA RLS -no
 * hace falta preguntarlo aqui-, y la proyeccion queda con el saldo plano.
 */
export default async function FlujoDeCajaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'treasury')

  const [saldoRow, porCobrar, porPagar] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [s] = await tx<{ efectivo: string }[]>`
      select coalesce(sum(public.bank_account_balance(id)), 0)::text as efectivo
      from public.bank_accounts
      where tenant_id = ${ctx.tenantId} and is_active`

    const cobrar = await tx<{ due_date: string; saldo: string }[]>`
      select due_date::text, public.invoice_balance(id)::text as saldo
      from public.customer_invoices
      where tenant_id = ${ctx.tenantId}
        and status in ('open', 'partially_paid', 'overdue')`

    const pagar = await tx<{ due_date: string; saldo: string }[]>`
      select due_date::text, public.ap_invoice_balance(id)::text as saldo
      from public.supplier_invoices
      where tenant_id = ${ctx.tenantId}
        and status in ('open', 'partially_paid', 'overdue')`

    return [s, cobrar, pagar] as const
  })

  const efectivoHoy = Number(saldoRow?.efectivo ?? 0)
  const aFecha = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`)

  const entradas = porCobrar
    .map((r) => ({ dueDate: aFecha(r.due_date), amount: Number(r.saldo) }))
    .filter((r) => r.amount > 0)
  const salidas = porPagar
    .map((r) => ({ dueDate: aFecha(r.due_date), amount: Number(r.saldo) }))
    .filter((r) => r.amount > 0)

  const proyeccion = buildCashFlowProjection(efectivoHoy, entradas, salidas, new Date(), SEMANAS)
  const enRojo = firstShortfallWeek(proyeccion)
  const finalProyectado = proyeccion[proyeccion.length - 1]?.runningBalance ?? efectivoHoy
  const totalEntra = proyeccion.reduce((a, s) => a + s.projectedIn, 0)
  const totalSale = proyeccion.reduce((a, s) => a + s.projectedOut, 0)

  const rango = (inicio: Date, fin: Date) =>
    `${inicio.getUTCDate()} ${inicio.toLocaleDateString('es-DO', { month: 'short', timeZone: 'UTC' })} – ${fin.getUTCDate()} ${fin.toLocaleDateString('es-DO', { month: 'short', timeZone: 'UTC' })}`

  return (
    <Shell {...shell} activePath="/tesoreria/flujo">
      <div className="space-y-5">
        <PageHeader
          icon="ssid_chart"
          title="Flujo de caja proyectado"
          description={`Ocho semanas hacia adelante: el efectivo de hoy, más lo que esperas cobrar, menos lo que tienes que pagar. Lo vencido cuenta en la semana 1 -ya debería haber entrado o salido-.`}
          crumbs={[
            { label: 'Tesoreria', href: `/tesoreria${ctx.demoQs}` },
            { label: 'Flujo de caja' },
          ]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Efectivo hoy"
            value={`RD$ ${money(efectivoHoy)}`}
            hint="en cuentas activas"
          />
          <StatCard
            label="Entra"
            value={`RD$ ${money(totalEntra)}`}
            hint={`${entradas.length} facturas por cobrar`}
          />
          <StatCard
            label="Sale"
            value={`RD$ ${money(totalSale)}`}
            hint={`${salidas.length} facturas por pagar`}
          />
          <StatCard
            label="Efectivo en 8 semanas"
            value={`RD$ ${money(finalProyectado)}`}
            hint={enRojo === null ? 'sin sobresaltos' : `en rojo la semana ${enRojo + 1}`}
          />
        </section>

        {enRojo !== null && (
          <Card>
            <CardBody className="flex items-start gap-3 pt-4 text-sm">
              <span
                aria-hidden="true"
                className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--color-semantic-bg-danger)] text-[var(--color-semantic-text-danger)]"
              >
                !
              </span>
              <p className="text-[var(--color-text-secondary)]">
                <strong className="text-[var(--color-semantic-text-danger)]">
                  El efectivo se pone en rojo en la semana {enRojo + 1}
                </strong>{' '}
                ({rango(proyeccion[enRojo]!.weekStart, proyeccion[enRojo]!.weekEnd)}). Con lo que
                hay hoy y lo que esta programado, no alcanza. Adelanta cobros o corre pagos antes de
                que llegue.
              </p>
            </CardBody>
          </Card>
        )}

        {efectivoHoy === 0 && entradas.length === 0 && salidas.length === 0 ? (
          <EmptyState
            icon="ssid_chart"
            title="Todavia no hay nada que proyectar"
            description="Registra una cuenta bancaria con su saldo. Si ademas tienes cuentas por cobrar o por pagar activas, sus facturas abiertas aparecen aqui solas."
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Semana por semana</CardTitle>
            </CardHeader>
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>Semana</TH>
                    <TH>Del</TH>
                    <TH numeric>Entra</TH>
                    <TH numeric>Sale</TH>
                    <TH numeric>Neto</TH>
                    <TH numeric>Efectivo al cierre</TH>
                  </TR>
                </THead>
                <TBody>
                  {proyeccion.map((s, i) => (
                    <TR key={i}>
                      <TD className="font-medium text-[var(--color-text-primary)]">{i + 1}</TD>
                      <TD>{rango(s.weekStart, s.weekEnd)}</TD>
                      <TD numeric>
                        <span className="tabular text-[var(--color-semantic-text-success)]">
                          {s.projectedIn === 0 ? '—' : money(s.projectedIn)}
                        </span>
                      </TD>
                      <TD numeric>
                        <span className="tabular text-[var(--color-semantic-text-warning)]">
                          {s.projectedOut === 0 ? '—' : money(s.projectedOut)}
                        </span>
                      </TD>
                      <TD numeric>
                        <span className="tabular">{money(s.net)}</span>
                      </TD>
                      <TD numeric>
                        <span
                          className={`tabular font-semibold ${
                            s.runningBalance < 0 ? 'text-[var(--color-semantic-text-danger)]' : ''
                          }`}
                        >
                          {money(s.runningBalance)}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                Esto es una proyeccion, no una promesa: cuenta lo que esta facturado y con fecha, no
                lo que se espera vender. Sin cuentas por cobrar o por pagar activos, sus columnas
                quedan vacias y el efectivo se muestra plano.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
