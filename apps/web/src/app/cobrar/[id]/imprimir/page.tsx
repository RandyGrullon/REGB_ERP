import { notFound } from 'next/navigation'
import { formatTaxId } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { PrintButton } from '@/components/PrintButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Factura' }

/**
 * La factura de credito, lista para imprimir en carta.
 *
 * Hasta la 0130 no existia: la factura solo tenia encabezado y el cliente
 * de credito se iba sin comprobante en papel (analisis de flujo, hallazgo
 * 16). Sale del shell a proposito, como el ticket de la caja: lo que se ve
 * es lo que va al papel. El papel es blanco en los dos temas.
 *
 * La Norma 06-2018 de la DGII pide, ademas del NCF: el nombre del tipo de
 * comprobante, la fecha hasta la que es valida la secuencia que lo
 * autorizo, el RNC del emisor y -en credito fiscal- el nombre y RNC del
 * comprador, y el detalle con su ITBIS. Todo eso esta aqui.
 */

interface Head {
  number: string
  issue_date: string
  due_date: string
  status: string
  void_reason: string | null
  ncf: string | null
  ncf_type: string | null
  buyer_tax_id: string | null
  subtotal: string
  discount: string
  tax: string
  total: string
  customer_name: string
  customer_tax_id: string | null
  customer_address: string | null
  payment_terms: number
  company_name: string | null
  company_tax_id: string | null
  company_address: string | null
  company_phone: string | null
  ncf_expires_on: string | null
  order_number: string | null
}

interface Linea {
  description: string
  unit: string | null
  qty: string
  unit_price: string
  discount_pct: string
  tax: string
  line_total: string
}

const NOMBRE_COMPROBANTE: Record<string, string> = {
  B01: 'Factura de credito fiscal',
  B02: 'Factura de consumo',
  B14: 'Comprobante de regimenes especiales',
  B15: 'Comprobante gubernamental',
  E31: 'Factura de credito fiscal electronica',
  E32: 'Factura de consumo electronica',
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fecha = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

export default async function FacturaImprimirPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx } = await modulePage(sp, 'ar')

  const datos = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<Head[]>`
      select i.number, i.issue_date::text, i.due_date::text, i.status, i.void_reason,
             i.ncf, i.ncf_type, i.buyer_tax_id,
             i.subtotal::text, i.discount::text, i.tax::text, i.total::text,
             c.name as customer_name, c.tax_id as customer_tax_id,
             c.address as customer_address, c.payment_terms,
             co.legal_name as company_name, co.tax_id as company_tax_id,
             co.address as company_address, co.phone as company_phone,
             sec.expires_on::text as ncf_expires_on,
             so.number as order_number
      from public.customer_invoices i
      join public.customers c on c.id = i.customer_id
      left join public.companies co
        on co.tenant_id = i.tenant_id and co.is_default and co.deleted_at is null
      left join public.sales_orders so
        on i.source_type = 'sales_order' and so.id = i.source_id
      -- La secuencia que dio este numero: mismo tipo y rango que lo
      -- contiene (igual que el ticket de la caja).
      left join lateral (
        select q.expires_on from public.ncf_sequences q
        where q.tenant_id = i.tenant_id and q.ncf_type = i.ncf_type
          and nullif(regexp_replace(i.ncf, '^[A-Z][0-9]{2}', ''), '')::bigint
              between q.range_from and q.range_to
        order by q.created_at desc
        limit 1
      ) sec on i.ncf is not null
      where i.id = ${id} and i.tenant_id = ${ctx.tenantId}`
    if (!h) return null

    const lineas = await tx<Linea[]>`
      select description, unit, qty::text, unit_price::text, discount_pct::text,
             tax::text, line_total::text
      from public.customer_invoice_lines
      where invoice_id = ${id} and tenant_id = ${ctx.tenantId}
      order by description`
    return { h, lineas }
  })

  if (!datos) notFound()
  const { h, lineas } = datos
  // El RNC que viaja al 607 es el congelado al emitir; si no hay, el del cliente.
  const rncComprador = h.buyer_tax_id ?? h.customer_tax_id
  const tipo = h.ncf_type ? NOMBRE_COMPROBANTE[h.ncf_type] : null

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
          href={`/cobrar/${id}${ctx.demoQs}`}
          className="text-sm text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          Volver a la factura
        </a>
        <PrintButton label="Imprimir factura" />
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
            {h.ncf ? (
              <>
                {tipo && <p className="text-[13px] font-bold uppercase">{tipo}</p>}
                <p className="text-[15px] font-bold">NCF: {h.ncf}</p>
                {h.ncf_expires_on && <p>Valida hasta: {fecha(h.ncf_expires_on)}</p>}
              </>
            ) : (
              <p className="border border-black px-2 py-1 text-[11px] font-bold uppercase">
                Sin comprobante fiscal
                <span className="block font-normal normal-case">no valida para credito fiscal</span>
              </p>
            )}
            <p className="mt-1">Factura {h.number}</p>
            <p>Fecha: {fecha(h.issue_date)}</p>
          </div>
        </header>

        {h.status === 'void' && (
          <p className="my-3 border border-black py-1 text-center text-[14px] font-bold">
            *** ANULADA{h.void_reason ? `: ${h.void_reason}` : ''} ***
          </p>
        )}

        <section className="grid grid-cols-2 gap-6 border-b border-black py-3">
          <div>
            <p className="font-bold">Cliente</p>
            <p>{h.customer_name}</p>
            {rncComprador && <p>RNC/Cedula: {formatTaxId(rncComprador)}</p>}
            {h.customer_address && <p>{h.customer_address}</p>}
          </div>
          <div className="text-right">
            <p className="font-bold">Condiciones</p>
            <p>{h.payment_terms === 0 ? 'Contado' : `Credito a ${h.payment_terms} dias`}</p>
            <p>Vence: {fecha(h.due_date)}</p>
            {h.order_number && <p>Pedido: {h.order_number}</p>}
          </div>
        </section>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2 font-bold">Descripcion</th>
              <th className="py-1 pr-2 text-right font-bold">Cant.</th>
              <th className="py-1 pr-2 text-right font-bold">Precio</th>
              <th className="py-1 pr-2 text-right font-bold">ITBIS</th>
              <th className="py-1 text-right font-bold">Valor</th>
            </tr>
          </thead>
          <tbody>
            {lineas.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-2">
                  Venta segun pedido {h.order_number ?? ''} (factura anterior al detalle por linea).
                </td>
              </tr>
            ) : (
              lineas.map((l, i) => (
                <tr key={i} className="border-b border-dashed border-black">
                  <td className="py-1 pr-2">
                    {l.description}
                    {Number(l.discount_pct) > 0 && ` (desc. ${Number(l.discount_pct)}%)`}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {Number(l.qty)} {l.unit ?? ''}
                  </td>
                  <td className="py-1 pr-2 text-right">{money(Number(l.unit_price))}</td>
                  <td className="py-1 pr-2 text-right">{money(Number(l.tax))}</td>
                  <td className="py-1 text-right">{money(Number(l.line_total))}</td>
                </tr>
              ))
            )}
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

        <footer className="mt-10 grid grid-cols-2 gap-10 text-center text-[11px]">
          <p className="border-t border-black pt-1">Despachado por</p>
          <p className="border-t border-black pt-1">Recibido conforme</p>
        </footer>
      </article>
    </>
  )
}
