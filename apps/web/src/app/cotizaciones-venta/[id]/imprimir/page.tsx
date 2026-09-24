import { notFound } from 'next/navigation'
import { formatTaxId, lineTotals } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { PrintButton } from '@/components/PrintButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cotizacion' }

/**
 * La cotizacion lista para imprimir (o guardar en PDF y mandarla por
 * WhatsApp). Antes no habia forma de entregarsela al cliente: "Enviar"
 * solo cambiaba el estado.
 *
 * Sale del shell, como la factura: lo que se ve es lo que va al papel,
 * blanco en los dos temas. No es un comprobante fiscal: no lleva NCF.
 */

interface Head {
  quote_number: string
  version: number
  status: string
  valid_until: string | null
  terms: string | null
  created_at: string
  subtotal: string
  discount: string
  tax: string
  total: string
  customer_name: string | null
  customer_tax_id: string | null
  customer_address: string | null
  customer_phone: string | null
  company_name: string | null
  company_tax_id: string | null
  company_address: string | null
  company_phone: string | null
}

interface Linea {
  descripcion: string
  unit: string | null
  quantity: string
  unit_price: string
  discount_pct: string
  tax_rate: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fecha = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

export default async function CotizacionImprimirPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx } = await modulePage(sp, 'quotes')

  const datos = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<Head[]>`
      select q.quote_number, q.version, q.status, q.valid_until::text, q.terms,
             q.created_at::text, q.subtotal::text, q.discount::text, q.tax::text, q.total::text,
             c.name as customer_name, c.tax_id as customer_tax_id,
             c.address as customer_address, c.phone as customer_phone,
             co.legal_name as company_name, co.tax_id as company_tax_id,
             co.address as company_address, co.phone as company_phone
      from public.quotes q
      left join public.customers c on c.id = q.customer_id
      left join public.companies co
        on co.tenant_id = q.tenant_id and co.is_default and co.deleted_at is null
      where q.id = ${id} and q.tenant_id = ${ctx.tenantId}`
    if (!h) return null

    const lineas = await tx<Linea[]>`
      select coalesce(ql.description, p.name) as descripcion, p.unit,
             ql.quantity::text, ql.unit_price::text, ql.discount_pct::text, ql.tax_rate::text
      from public.quote_lines ql
      join public.products p on p.id = ql.product_id
      where ql.quote_id = ${id} and ql.tenant_id = ${ctx.tenantId}
      order by p.name`
    return { h, lineas }
  })

  if (!datos) notFound()
  const { h, lineas } = datos
  const noVigente = ['rejected', 'expired', 'superseded'].includes(h.status)

  return (
    <>
      <style>{`
        @page { size: letter; margin: 14mm; }
        @media print {
          body { background: #fff !important; }
          .no-imprimir { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-imprimir mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4 py-4">
        <a
          href={`/cotizaciones-venta/${id}${ctx.demoQs}`}
          className="text-sm text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          Volver a la cotizacion
        </a>
        <PrintButton label="Imprimir cotizacion" />
      </div>

      <article className="mx-auto max-w-[210mm] bg-white p-8 text-[12px] leading-snug text-black">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-black pb-4">
          <div>
            <p className="text-[16px] font-bold uppercase">{h.company_name ?? ctx.tenantName}</p>
            {h.company_tax_id && <p>RNC {formatTaxId(h.company_tax_id)}</p>}
            {h.company_address && <p>{h.company_address}</p>}
            {h.company_phone && <p>Tel. {h.company_phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-[15px] font-bold uppercase">Cotizacion</p>
            <p className="font-bold">
              {h.quote_number}
              {h.version > 1 ? ` (version ${h.version})` : ''}
            </p>
            <p>Fecha: {fecha(h.created_at)}</p>
            {h.valid_until && <p>Valida hasta: {fecha(h.valid_until)}</p>}
          </div>
        </header>

        {noVigente && (
          <p className="my-3 border border-black py-1 text-center text-[14px] font-bold">
            *** SIN VIGENCIA ***
          </p>
        )}

        <section className="grid grid-cols-2 gap-6 border-b border-black py-3">
          <div>
            <p className="font-bold">Cliente</p>
            <p>{h.customer_name ?? '—'}</p>
            {h.customer_tax_id && <p>RNC/Cedula: {formatTaxId(h.customer_tax_id)}</p>}
            {h.customer_address && <p>{h.customer_address}</p>}
            {h.customer_phone && <p>Tel. {h.customer_phone}</p>}
          </div>
          {h.terms && (
            <div className="text-right">
              <p className="font-bold">Condiciones</p>
              <p>{h.terms}</p>
            </div>
          )}
        </section>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2 font-bold">Descripción</th>
              <th className="py-1 pr-2 text-right font-bold">Cant.</th>
              <th className="py-1 pr-2 text-right font-bold">Precio</th>
              <th className="py-1 pr-2 text-right font-bold">ITBIS</th>
              <th className="py-1 text-right font-bold">Valor</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => {
              // Los mismos totales que usan pedidos y facturas.
              const t = lineTotals({
                quantity: Number(l.quantity),
                unitPrice: Number(l.unit_price),
                discountPct: Number(l.discount_pct),
                taxRate: Number(l.tax_rate),
              })
              return (
                <tr key={i} className="border-b border-dashed border-black">
                  <td className="py-1 pr-2">
                    {l.descripcion}
                    {Number(l.discount_pct) > 0 && ` (desc. ${Number(l.discount_pct)}%)`}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {Number(l.quantity).toLocaleString('es-DO', { maximumFractionDigits: 4 })}{' '}
                    {l.unit ?? ''}
                  </td>
                  <td className="py-1 pr-2 text-right">{money(Number(l.unit_price))}</td>
                  <td className="py-1 pr-2 text-right">{money(t.tax)}</td>
                  <td className="py-1 text-right">{money(t.total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <dl className="ml-auto mt-4 w-64 space-y-0.5">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{money(Number(h.subtotal))}</dd>
          </div>
          {Number(h.discount) > 0 && (
            <div className="flex justify-between">
              <dt>Descuento aplicado</dt>
              <dd>{money(Number(h.discount))}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>ITBIS</dt>
            <dd>{money(Number(h.tax))}</dd>
          </div>
          <div className="flex justify-between border-t border-black pt-1 text-[14px] font-bold">
            <dt>TOTAL</dt>
            <dd>RD$ {money(Number(h.total))}</dd>
          </div>
        </dl>

        <p className="mt-8 text-[11px]">
          Precios en pesos dominicanos. Esta cotizacion no es un comprobante fiscal: la factura con
          su NCF se emite al entregar la mercancía.
        </p>
      </article>
    </>
  )
}
