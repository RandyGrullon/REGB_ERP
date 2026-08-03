import { notFound } from 'next/navigation'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
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
  company_tax_id: string | null
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
  const { ctx } = await modulePage(sp, 'pos', 'pos.report.view')

  const [head, lineas, pagos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<Head[]>`
      select s.number, s.ncf, s.ncf_type, s.total::text, s.subtotal::text,
             s.discount::text, s.tax::text, s.created_at::text, s.voided,
             c.name as customer_name, c.tax_id as customer_tax_id,
             up.display_name as cashier_name, w.name as warehouse_name,
             co.legal_name as company_name, co.tax_id as company_tax_id
      from public.pos_sales s
      join public.pos_shifts sh on sh.id = s.shift_id
      join public.warehouses w on w.id = sh.warehouse_id
      left join public.companies co on co.tenant_id = s.tenant_id and co.is_default
      left join public.customers c on c.id = s.customer_id
      left join public.user_profiles up
        on up.tenant_id = s.tenant_id and up.user_id = s.cashier_id
      where s.id = ${id} and s.tenant_id = ${ctx.tenantId}`
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
          <p className="text-[13px] font-bold uppercase">{head.company_name ?? 'REGB ERP'}</p>
          {head.company_tax_id && <p>RNC {head.company_tax_id}</p>}
          <p>{head.warehouse_name}</p>
        </header>

        <hr className="my-2 border-dashed border-black" />

        {head.ncf && (
          <p className="text-center text-[12px] font-bold">
            NCF: {head.ncf}
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
        {head.customer_tax_id && <p>RNC/Ced: {head.customer_tax_id}</p>}

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
        <PrintButton />
      </div>
    </>
  )
}

