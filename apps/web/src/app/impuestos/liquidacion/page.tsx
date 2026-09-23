import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  Mono,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Toolbar,
  ToolbarActions,
} from '@regb/ui'
import { calendarioFiscal, creditoArrastrado, liquidarItbis } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { BotonEnvio } from '@/components/BotonEnvio'
import { cerrarLiquidacionForm, marcarPagadaForm } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liquidacion IT-1 · REGB ERP' }

interface FilingRow {
  id: string
  period: string
  status: string
  itbis_charged: string
  itbis_paid: string
  itbis_withheld: string
  /** El que YO le retuve a mis proveedores. SUMA, al reves que los otros. */
  itbis_retained: string
  previous_credit: string
  amount_due: string
  credit_forward: string
  receipt_number: string | null
  filed_at: string | null
  notes: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const legible = (p: string) =>
  new Date(`${p.slice(0, 4)}-${p.slice(4, 6)}-01T12:00:00`).toLocaleDateString('es-DO', {
    month: 'long',
    year: 'numeric',
  })

const claseInput =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

const ESTADO: Record<string, { texto: string; tono: 'neutral' | 'info' | 'success' }> = {
  pending: { texto: 'pendiente', tono: 'neutral' },
  filed: { texto: 'presentada', tono: 'info' },
  paid: { texto: 'pagada', tono: 'success' },
}

/**
 * Liquidacion IT-1 (modulo 24).
 *
 * ITBIS cobrado MAS lo que yo le retuve a mis proveedores, menos el ITBIS
 * adelantado, menos lo que me retuvieron y el saldo a favor del periodo
 * anterior. Si da negativo no se declara en negativo: se arrastra.
 *
 * Los seis terminos se pintan, y no cinco: un renglon que entra en el
 * total sin aparecer en pantalla hace que el contador reste a mano, le
 * sobre un monto sin explicacion y concluya que el sistema esta roto.
 *
 * Las dos mitades de la suma viven bajo la RLS de OTROS modulos -dgii_607
 * es de `ar`, dgii_606 es de `ap`-. Si uno esta apagado, esa mitad vuelve
 * en cero y la declaracion sale mal PARECIENDO correcta. Por eso la
 * pantalla comprueba los dos modulos y lo dice, en vez de sumar cero en
 * silencio.
 */
export default async function LiquidacionPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { periodo?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'taxes')

  // Por defecto el mes ANTERIOR: el corriente todavia se esta armando y lo
  // que se liquida es un periodo que ya cerro.
  const hoy = new Date()
  const mesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
  const periodoDefecto = `${mesPasado.getFullYear()}${String(mesPasado.getMonth() + 1).padStart(2, '0')}`
  const periodo = /^[0-9]{6}$/.test(params.periodo ?? '') ? params.periodo! : periodoDefecto

  const veVentas = exigir(ctx, 'ar', 'ar.view').ok
  const veCompras = exigir(ctx, 'ap', 'ap.view').ok
  const puedeCerrar = exigir(ctx, 'taxes', 'taxes.filing.close').ok

  const [cobrado607, adelantado, retenidoAProveedores, sinNcf, saldo, cerrada, historial] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const v = veVentas
        ? await tx<{ t: string }[]>`
            select coalesce(sum(itbis_facturado), 0)::text as t
            from public.dgii_607
            where tenant_id = ${ctx.tenantId} and periodo = ${periodo}`
        : []
      const c = veCompras
        ? await tx<{ t: string; r: string }[]>`
            select coalesce(sum(itbis_facturado), 0)::text as t,
                   coalesce(sum(itbis_retenido), 0)::text as r
            from public.dgii_606
            where tenant_id = ${ctx.tenantId} and periodo = ${periodo}`
        : []
      // El 607 solo lleva comprobantes (`ncf is not null`) y el IT-1
      // declara operaciones. El ITBIS de las ventas sin NCF -que el POS
      // permite a proposito mientras la DGII no autoriza el primer rango-
      // se cobro igual y entra en la declaracion. Se trae aparte para
      // poder ENSEÑAR por que el IT-1 no cuadra contra el 607.
      const sn = veVentas
        ? await tx<{ t: string }[]>`
            select coalesce(sum(t), 0)::text as t
            from (
              select coalesce(sum(i.tax), 0) as t
              from public.customer_invoices i
              where i.tenant_id = ${ctx.tenantId} and i.ncf is null and i.status <> 'void'
                and to_char(i.issue_date, 'YYYYMM') = ${periodo}
              union all
              select coalesce(sum(s.tax), 0)
              from public.pos_sales s
              where s.tenant_id = ${ctx.tenantId} and s.ncf is null and not s.voided
                and to_char(s.created_at, 'YYYYMM') = ${periodo}
            ) q`
        : []
      // La ultima anterior, no "la que toque": creditoArrastrado() decide
      // si es el eslabon inmediato o si la cadena tiene un hueco.
      const a = await tx<{ period: string; credit_forward: string }[]>`
        select period, credit_forward::text
        from public.tax_filings
        where tenant_id = ${ctx.tenantId} and form = 'IT-1' and period < ${periodo}
          and status <> 'pending'
        order by period desc limit 1`
      const [f] = await tx<FilingRow[]>`
        select id, period, status, itbis_charged::text, itbis_paid::text, itbis_withheld::text,
               itbis_retained::text, previous_credit::text, amount_due::text, credit_forward::text,
               receipt_number, filed_at::text, notes
        from public.tax_filings
        where tenant_id = ${ctx.tenantId} and form = 'IT-1' and period = ${periodo}`
      const h = await tx<FilingRow[]>`
        select id, period, status, itbis_charged::text, itbis_paid::text, itbis_withheld::text,
               itbis_retained::text, previous_credit::text, amount_due::text, credit_forward::text,
               receipt_number, filed_at::text, notes
        from public.tax_filings
        where tenant_id = ${ctx.tenantId} and form = 'IT-1'
        order by period desc limit 12`
      return [
        Number(v[0]?.t ?? 0),
        Number(c[0]?.t ?? 0),
        Number(c[0]?.r ?? 0),
        Number(sn[0]?.t ?? 0),
        creditoArrastrado(
          periodo,
          a.map((x) => ({ period: x.period, creditForward: Number(x.credit_forward) })),
        ),
        f ?? null,
        h,
      ] as const
    },
  )

  // Lo cobrado del IT-1 = lo del 607 MAS las ventas sin NCF. Son dos
  // reportes distintos: el 607 declara comprobantes, el IT-1 operaciones.
  const cobrado = cobrado607 + sinNcf
  const saldoAnterior = saldo.previousCredit

  // El calculo vivo, para verlo antes de cerrar. Lo que me retuvieron a mi
  // no existe en ninguna tabla del repo -las facturas de venta no tienen
  // campo de retencion recibida-, asi que en el calculo vivo va en cero y
  // se escribe a mano al cerrar.
  const vivo = liquidarItbis({
    itbisCharged: cobrado,
    itbisPaid: adelantado,
    itbisWithheld: Number(cerrada?.itbis_withheld ?? 0),
    // El que YO retuve sale del 606 del periodo y SUMA: es plata de la
    // DGII que tengo en la cuenta. Ver el campo en @regb/operations.
    itbisRetainedFromSuppliers: retenidoAProveedores,
    previousCredit: saldoAnterior,
  })

  const vence = calendarioFiscal(periodo, hoy).find((o) => o.form === 'IT-1')
  const qs = ctx.demoQs
  const sep = qs === '' ? '?' : '&'

  return (
    <Shell {...shell} activePath="/impuestos/liquidacion">
      <div className="space-y-5">
        <PageHeader
          icon="calculate"
          title="Liquidacion IT-1"
          description="ITBIS cobrado, mas lo que le retuviste a tus proveedores, menos el ITBIS adelantado, lo que te retuvieron y el saldo a favor del mes pasado. Si da negativo no se declara en negativo: el exceso se arrastra al mes que viene."
          crumbs={[{ label: 'Impuestos', href: `/impuestos${qs}` }, { label: 'Liquidacion IT-1' }]}
        />

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            Periodo
            <input
              name="periodo"
              defaultValue={periodo}
              inputMode="numeric"
              pattern="[0-9]{6}"
              title="Periodo en formato AAAAMM, por ejemplo 202609"
              className={`tabular w-32 text-center ${claseInput}`}
            />
          </label>
          <ToolbarActions
            hasFilters={periodo !== periodoDefecto}
            clearHref={`/impuestos/liquidacion${qs}`}
          />
        </Toolbar>

        {(!veVentas || !veCompras) && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-semantic-danger)] bg-[color-mix(in_srgb,var(--color-semantic-danger)_10%,transparent)] p-3 text-sm"
          >
            <Icon
              name="error"
              size={20}
              filled
              className="shrink-0 text-[var(--color-semantic-text-danger)]"
            />
            <p className="text-[var(--color-text-secondary)]">
              {!veVentas && (
                <>
                  No se ve <strong className="text-[var(--color-text-primary)]">lo que cobraste</strong>:
                  el modulo de Cuentas por cobrar no esta activo o tu rol no lo alcanza, asi que el
                  ITBIS de ventas de arriba es cero y{' '}
                  <strong className="text-[var(--color-text-primary)]">no lo es</strong>. Esta
                  declaracion no se puede cerrar asi: declarar de menos es una multa.{' '}
                </>
              )}
              {!veCompras && (
                <>
                  No se ve <strong className="text-[var(--color-text-primary)]">lo que compraste</strong>:
                  sin Cuentas por pagar falta el ITBIS adelantado, y sin restarlo esta liquidacion
                  te hace pagar de mas.
                </>
              )}
            </p>
          </div>
        )}

        {/* Solo mientras este periodo siga abierto: si ya se cerro, el
            hueco de la cadena es historia y el aviso seria ruido. */}
        {cerrada === null && saldo.faltaCerrar !== null && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)] p-3 text-sm"
          >
            <Icon
              name="warning"
              size={20}
              filled
              className="shrink-0 text-[var(--color-semantic-text-warning)]"
            />
            <p className="text-[var(--color-text-secondary)]">
              Falta cerrar{' '}
              <a
                href={`/impuestos/liquidacion${qs}${sep}periodo=${saldo.faltaCerrar}`}
                className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                {legible(saldo.faltaCerrar)}
              </a>
              . El saldo a favor se arrastra{' '}
              <strong className="text-[var(--color-text-primary)]">en cadena</strong>, un mes a la
              vez: mientras ese periodo este abierto, este arranca en cero y no se puede cerrar.
            </p>
          </div>
        )}

        <section aria-label="Liquidacion del periodo" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="ITBIS cobrado"
            value={`RD$ ${money(cobrado)}`}
            hint={
              !veVentas
                ? 'sin Cuentas por cobrar'
                : sinNcf > 0
                  ? `de tus ventas, con ${money(sinNcf)} sin NCF`
                  : 'de tus ventas (607)'
            }
          />
          <StatCard
            label="ITBIS adelantado"
            value={`RD$ ${money(adelantado)}`}
            hint={veCompras ? 'de tus compras (606)' : 'sin Cuentas por pagar'}
          />
          {/* El unico termino que SUMA. Se calculaba y no se pintaba, asi
              que el total no cuadraba contra los numeros de la pantalla. */}
          <StatCard
            label="ITBIS que retuve a proveedores"
            value={`RD$ ${money(retenidoAProveedores)}`}
            hint={veCompras ? 'SUMA: es plata de la DGII' : 'sin Cuentas por pagar'}
          />
          <StatCard
            label="Saldo a favor anterior"
            value={`RD$ ${money(saldoAnterior)}`}
            hint={saldo.faltaCerrar === null ? 'arrastrado' : 'falta cerrar el mes anterior'}
          />
          <StatCard label="A pagar" value={`RD$ ${money(vivo.amountDue)}`} hint="calculo vivo" />
          <StatCard
            label="Saldo que se arrastra"
            value={`RD$ ${money(vivo.creditForward)}`}
            hint="al mes que viene"
          />
        </section>

        {sinNcf > 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">
            De lo cobrado, <strong className="text-[var(--color-text-secondary)]">RD$ {money(sinNcf)}</strong>{' '}
            viene de ventas <strong className="text-[var(--color-text-secondary)]">sin NCF</strong>,
            que no salen en el 607. El 607 declara comprobantes y el IT-1 declara operaciones: el
            ITBIS de un ticket sin NCF se cobro igual y se declara igual.
          </p>
        )}

        {vence && (
          <p className="text-xs text-[var(--color-text-muted)]">
            El IT-1 de {legible(periodo)} vence el{' '}
            <strong className="text-[var(--color-text-secondary)]">
              {vence.vence.toLocaleDateString('es-DO', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </strong>
            {vence.vencida
              ? ' — ya paso.'
              : ` — faltan ${vence.diasRestantes} dia${vence.diasRestantes === 1 ? '' : 's'}.`}{' '}
            Los formatos 606, 607 y 608 se descargan en{' '}
            <a
              href={`/cobrar/dgii${qs}${sep}periodo=${periodo}`}
              className="text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              Reportes DGII
            </a>
            .
          </p>
        )}

        {cerrada ? (
          <Card>
            <CardHeader>
              <CardTitle>Lo que se declaro de {legible(periodo)}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={ESTADO[cerrada.status]?.tono ?? 'neutral'} dot={false}>
                  {ESTADO[cerrada.status]?.texto ?? cerrada.status}
                </Badge>
                {cerrada.receipt_number && (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    Recibo <Mono>{cerrada.receipt_number}</Mono>
                  </span>
                )}
                {cerrada.filed_at && (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    Cerrada el {cerrada.filed_at.slice(0, 10)}
                  </span>
                )}
              </div>

              <Table>
                <THead>
                  <TR>
                    <TH>Concepto</TH>
                    <TH numeric>Lo declarado</TH>
                    <TH numeric>Hoy daria</TH>
                  </TR>
                </THead>
                <TBody>
                  <TR>
                    <TD>ITBIS cobrado</TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(cerrada.itbis_charged))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-text-muted)]">
                        {money(cobrado)}
                      </span>
                    </TD>
                  </TR>
                  <TR>
                    <TD>ITBIS adelantado</TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(cerrada.itbis_paid))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-text-muted)]">
                        {money(adelantado)}
                      </span>
                    </TD>
                  </TR>
                  <TR>
                    <TD>ITBIS que retuve a mis proveedores</TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(cerrada.itbis_retained))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-text-muted)]">
                        {money(retenidoAProveedores)}
                      </span>
                    </TD>
                  </TR>
                  <TR>
                    <TD>ITBIS que me retuvieron</TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(cerrada.itbis_withheld))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-text-muted)]">—</span>
                    </TD>
                  </TR>
                  <TR>
                    <TD>Saldo a favor anterior</TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(cerrada.previous_credit))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-text-muted)]">
                        {money(saldoAnterior)}
                      </span>
                    </TD>
                  </TR>
                  <TR>
                    <TD>A pagar</TD>
                    <TD numeric>
                      <span className="tabular font-semibold">
                        {money(Number(cerrada.amount_due))}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-text-muted)]">
                        {money(vivo.amountDue)}
                      </span>
                    </TD>
                  </TR>
                  <TR>
                    <TD>Saldo que se arrastra</TD>
                    <TD numeric>
                      <span className="tabular font-semibold">
                        {money(Number(cerrada.credit_forward))}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-text-muted)]">
                        {money(vivo.creditForward)}
                      </span>
                    </TD>
                  </TR>
                </TBody>
              </Table>

              {cerrada.notes && (
                <p className="text-xs text-[var(--color-text-muted)]">{cerrada.notes}</p>
              )}

              <div
                role="note"
                className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 text-sm"
              >
                <Icon name="photo_camera" size={20} className="shrink-0 text-[var(--color-text-muted)]" />
                <p className="text-[var(--color-text-secondary)]">
                  Esto es una <strong className="text-[var(--color-text-primary)]">foto</strong>, no
                  un calculo vivo. Si las dos columnas no coinciden es porque despues de cerrar se
                  corrigio alguna factura del periodo:{' '}
                  <strong className="text-[var(--color-text-primary)]">
                    lo que se entrego sigue siendo lo que se entrego
                  </strong>{' '}
                  y la diferencia se arregla con una rectificativa, no reescribiendo el pasado.
                </p>
              </div>

              {puedeCerrar && cerrada.status === 'filed' && (
                <form action={marcarPagadaForm} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <input type="hidden" name="id" value={cerrada.id} />
                  <label className="flex w-48 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Numero de recibo
                    <input name="receiptNumber" placeholder="Opcional" className={claseInput} />
                  </label>
                  <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                    <Icon name="check" size={18} />
                    Marcar como pagada
                  </BotonEnvio>
                </form>
              )}
            </CardBody>
          </Card>
        ) : (
          puedeCerrar && (
            <Card>
              <CardHeader>
                <CardTitle>Cerrar la declaracion de {legible(periodo)}</CardTitle>
              </CardHeader>
              <CardBody>
                <form action={cerrarLiquidacionForm} className="space-y-3">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <input type="hidden" name="period" value={periodo} />
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex w-48 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      ITBIS que me retuvieron
                      <input
                        name="itbisWithheld"
                        inputMode="decimal"
                        defaultValue="0"
                        title="Se escribe a mano: el sistema no guarda la retencion que te hacen tus clientes"
                        className={`tabular text-right ${claseInput}`}
                      />
                    </label>
                    <label className="flex w-48 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Numero de recibo
                      <input name="receiptNumber" placeholder="Opcional" className={claseInput} />
                    </label>
                    <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Nota
                      <input
                        name="notes"
                        placeholder="Lo que quieras recordar de esta declaracion"
                        className={claseInput}
                      />
                    </label>
                  </div>
                  <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                    <Icon name="lock" size={18} />
                    Cerrar y guardar la foto
                  </BotonEnvio>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Los montos NO salen de esta pantalla: al cerrar se vuelven a sumar contra tus
                    facturas del periodo. Una vez cerrada no se recalcula.
                  </p>
                </form>
              </CardBody>
            </Card>
          )
        )}

        {historial.length > 0 && (
          <section aria-labelledby="historial" className="space-y-2">
            <h2 id="historial" className="text-sm font-semibold text-[var(--color-text-primary)]">
              Declaraciones anteriores
            </h2>
            <Table>
              <THead>
                <TR>
                  <TH>Periodo</TH>
                  <TH>Estado</TH>
                  <TH numeric>Cobrado</TH>
                  <TH numeric>Adelantado</TH>
                  <TH numeric>A pagar</TH>
                  <TH numeric>Arrastra</TH>
                </TR>
              </THead>
              <TBody>
                {historial.map((f) => (
                  <TR key={f.id}>
                    <TD>
                      <a
                        href={`/impuestos/liquidacion${qs}${sep}periodo=${f.period}`}
                        className="text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        {legible(f.period)}
                      </a>
                    </TD>
                    <TD>
                      <Badge tone={ESTADO[f.status]?.tono ?? 'neutral'} dot={false}>
                        {ESTADO[f.status]?.texto ?? f.status}
                      </Badge>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(f.itbis_charged))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(f.itbis_paid))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{money(Number(f.amount_due))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(f.credit_forward))}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>
        )}
      </div>
    </Shell>
  )
}
