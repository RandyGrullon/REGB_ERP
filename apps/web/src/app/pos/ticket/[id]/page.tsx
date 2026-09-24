import { notFound } from 'next/navigation'
import { formatTaxId } from '@regb/operations'
import { asUser } from '@/lib/db'
import { exigir, modulePage, type DemoParams } from '@/lib/module-page'
import { PrintButton } from '@/components/PrintButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ticket' }

/**
 * Ticket para impresora termica de 80 mm.
 *
 * No necesita Electron ni driver especial: una termica USB se instala como
 * impresora normal y esto es una pagina con ancho de 80 mm. Sale del shell
 * a proposito —sin barra ni menu— porque lo que se manda al papel es
 * exactamente lo que se ve.
 *
 * El NCF va en grande: es lo que la DGII exige que el cliente reciba, y lo
 * primero que busca un contador cuando reclama un comprobante.
 */

interface Head {
  number: string
  ncf: string | null
  ncf_type: string | null
  total: string
  subtotal: string
  discount: string
  tax: string
  created_at: string
  voided: boolean
  customer_name: string | null
  customer_tax_id: string | null
  cashier_name: string | null
  warehouse_name: string
  company_name: string | null
  trade_name: string | null
  company_tax_id: string | null
  company_address: string | null
  company_phone: string | null
  ncf_expires_on: string | null
}

/**
 * La Norma 06-2018 de la DGII pide en el comprobante, ademas del NCF, el
 * nombre del tipo de comprobante y la fecha de vencimiento de la
 * secuencia que lo autorizo. Sin ellos el ticket de un B02 no esta
 * completo aunque el numero sea bueno.
 */
const NOMBRE_COMPROBANTE: Record<string, string> = {
  B01: 'Factura de crédito fiscal',
  B02: 'Factura de consumo',
  B14: 'Comprobante de regimenes especiales',
  B15: 'Comprobante gubernamental',
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  // El cajero que cobro tiene que poder entregar SU ticket: el aviso de
  // "Cobrado" enlaza aqui. Con `pos.report.view` se ve cualquier ticket;
  // con solo `pos.sell`, los que cobro esa persona.
  const { ctx } = await modulePage(sp, 'pos', 'pos.sell')
  const veTodos = exigir(ctx, 'pos', 'pos.report.view').ok

  const [head, lineas, pagos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<Head[]>`
      select s.number, s.ncf, s.ncf_type, s.total::text, s.subtotal::text,
             -- La hora REAL de la venta: en una venta hecha sin conexion,
             -- created_at es cuando llego al servidor, no cuando se cobro.
             s.discount::text, s.tax::text, coalesce(s.sold_at, s.created_at)::text as created_at,
             s.voided,
             c.name as customer_name, c.tax_id as customer_tax_id,
             up.display_name as cashier_name, w.name as warehouse_name,
             co.legal_name as company_name, co.tax_id as company_tax_id,
             co.address as company_address, co.phone as company_phone,
             nullif(trim(ts.trade_name), '') as trade_name,
             sec.expires_on::text as ncf_expires_on
      from public.pos_sales s
      join public.pos_shifts sh on sh.id = s.shift_id
      join public.warehouses w on w.id = sh.warehouse_id
      left join public.companies co on co.tenant_id = s.tenant_id and co.is_default
      left join public.tenant_settings ts on ts.tenant_id = s.tenant_id
      left join public.customers c on c.id = s.customer_id
      left join public.user_profiles up
        on up.tenant_id = s.tenant_id and up.user_id = s.cashier_id
      -- La secuencia que dio este numero: mismo tipo y rango que lo contiene.
      left join lateral (
        select q.expires_on from public.ncf_sequences q
        where q.tenant_id = s.tenant_id and q.ncf_type = s.ncf_type
          and nullif(regexp_replace(s.ncf, '^[A-Z][0-9]{2}', ''), '')::bigint
              between q.range_from and q.range_to
        order by q.created_at desc
        limit 1
      ) sec on s.ncf is not null
      where s.id = ${id} and s.tenant_id = ${ctx.tenantId}
        and (${veTodos} or s.cashier_id = ${ctx.userId})`
    if (!h) return [null, [], []] as const

    const l = await tx<
      { name: string; qty: string; unit_price: string; line_total: string; unit: string }[]
    >`
      select p.name, l.qty::text, l.unit_price::text, l.line_total::text, p.unit
      from public.pos_sale_lines l
      join public.products p on p.id = l.product_id
      where l.sale_id = ${id} and l.tenant_id = ${ctx.tenantId}`

    const pg = await tx<{ method: string; amount: string }[]>`
      select method, amount::text from public.pos_payments
      where sale_id = ${id} and tenant_id = ${ctx.tenantId}`
    return [h, l, pg] as const
  })

  if (!head) notFound()

  const METODO: Record<string, string> = {
    cash: 'Efectivo',
    card: 'Tarjeta',
    transfer: 'Transferencia',
  }

  return (
    <>
      {/* Ancho de 80 mm y sin margenes: lo que se ve es lo que sale del
          papel. `color-adjust` obliga a imprimir los fondos, que si no
          Chrome los quita y el ticket queda sin separadores. */}
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        @media print {
          body { background: #fff !important; }
          .no-imprimir { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="mx-auto w-[80mm] bg-white p-3 font-[family-name:var(--font-mono)] text-[11px] leading-tight text-black">
        <header className="text-center">
          {/* El nombre que el cliente conoce arriba; la razon social, que es
              la que exige la DGII, debajo con su RNC. */}
          <p className="text-[13px] font-bold uppercase">
            {head.trade_name ?? head.company_name ?? 'REGB ERP'}
          </p>
          {head.trade_name && head.company_name && <p>{head.company_name}</p>}
          {head.company_tax_id && <p>RNC {formatTaxId(head.company_tax_id)}</p>}
          {head.company_address && <p>{head.company_address}</p>}
          {head.company_phone && <p>Tel. {head.company_phone}</p>}
          <p>{head.warehouse_name}</p>
        </header>

        <hr className="my-2 border-dashed border-black" />

        {/* Sin NCF el ticket lo DICE. Callarlo es lo peor de los dos
            mundos: el cliente cree que tiene un comprobante fiscal, y se
            entera cuando su contador lo rechaza. Impreso, al menos sale
            del mostrador con la conversacion hecha. */}
        {head.ncf ? (
          <>
            {head.ncf_type && NOMBRE_COMPROBANTE[head.ncf_type] && (
              <p className="text-center font-bold uppercase">{NOMBRE_COMPROBANTE[head.ncf_type]}</p>
            )}
            <p className="text-center text-[12px] font-bold">NCF: {head.ncf}</p>
            {head.ncf_expires_on && (
              <p className="text-center">
                Valido hasta:{' '}
                {new Date(`${head.ncf_expires_on}T12:00:00`).toLocaleDateString('es-DO', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </p>
            )}
          </>
        ) : (
          <p className="border border-black py-1 text-center text-[10px] font-bold uppercase">
            Sin comprobante fiscal
            <span className="block font-normal normal-case">no valido para crédito fiscal</span>
          </p>
        )}
        <p>Ticket: {head.number}</p>
        <p>
          Fecha:{' '}
          {new Date(head.created_at).toLocaleString('es-DO', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
        {head.cashier_name && <p>Cajero: {head.cashier_name}</p>}
        <p>Cliente: {head.customer_name ?? 'Consumidor final'}</p>
        {head.customer_tax_id && <p>RNC/Ced: {formatTaxId(head.customer_tax_id)}</p>}

        {head.voided && (
          <p className="my-2 border border-black py-1 text-center text-[13px] font-bold">
            *** ANULADO ***
          </p>
        )}

        <hr className="my-2 border-dashed border-black" />

        <table className="w-full">
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td colSpan={2} className="pt-1">
                  {l.name}
                  <div className="flex justify-between font-normal">
                    <span>
                      {Number(l.qty)} {l.unit} x {money(Number(l.unit_price))}
                    </span>
                    <span className="font-bold">{money(Number(l.line_total))}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <hr className="my-2 border-dashed border-black" />

        <dl className="space-y-0.5">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{money(Number(head.subtotal))}</dd>
          </div>
          {Number(head.discount) > 0 && (
            <div className="flex justify-between">
              <dt>Descuento</dt>
              <dd>-{money(Number(head.discount))}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>ITBIS</dt>
            <dd>{money(Number(head.tax))}</dd>
          </div>
          <div className="flex justify-between border-t border-black pt-1 text-[14px] font-bold">
            <dt>TOTAL</dt>
            <dd>RD$ {money(Number(head.total))}</dd>
          </div>
        </dl>

        <hr className="my-2 border-dashed border-black" />

        {pagos.map((p, i) => (
          <div key={i} className="flex justify-between">
            <span>{METODO[p.method] ?? p.method}</span>
            <span>{money(Number(p.amount))}</span>
          </div>
        ))}

        <p className="mt-3 text-center">¡Gracias por su compra!</p>
        <p className="text-center text-[9px]">Conserve este comprobante</p>
      </div>

      {/* Solo en pantalla: el boton no va al papel. */}
      <div className="no-imprimir mx-auto mt-4 flex w-[80mm] justify-center gap-2 pb-6">
        {/* El siguiente cliente espera: de vuelta a la caja en un clic, sin
            buscar el "atras" del navegador. */}
        <a
          href={`/pos${ctx.demoQs}`}
          className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          Volver a la caja
        </a>
        <PrintButton />
      </div>
    </>
  )
}
