import { Card, CardBody, EmptyState, PageHeader } from '@regb/ui'
import { patronBarrasEan13 } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { PrintButton } from '@/components/PrintButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Etiquetas · REGB ERP' }

interface ProductoRow {
  id: string
  sku: string
  name: string
  barcode: string
  price: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Dibuja el codigo de barras entero -barras reales, sin ninguna libreria externa-. */
function CodigoBarras({ codigo }: { codigo: string }) {
  const patron = patronBarrasEan13(codigo)
  const anchoModulo = 2
  const alto = 60
  const ancho = patron.length * anchoModulo

  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      width={ancho}
      height={alto}
      role="img"
      aria-label={`Código de barras ${codigo}`}
    >
      <rect x={0} y={0} width={ancho} height={alto} fill="white" />
      {patron
        .split('')
        .map((bit, i) =>
          bit === '1' ? (
            <rect
              key={i}
              x={i * anchoModulo}
              y={0}
              width={anchoModulo}
              height={alto}
              fill="black"
            />
          ) : null,
        )}
    </svg>
  )
}

/** Etiquetas para imprimir (modulo 52): codigo de barras real, no una imagen generica. */
export default async function EtiquetasPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'barcode')

  const productos = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<ProductoRow[]>`
      select id, sku, name, barcode, price::text from public.products
      where tenant_id = ${ctx.tenantId} and active and barcode is not null
      order by name`,
  )

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/codigos-barra">
      <div className="space-y-5 print:space-y-0">
        <div className="print:hidden">
          <PageHeader
            icon="sell"
            title="Etiquetas"
            description="Una etiqueta por producto, lista para imprimir."
            crumbs={[
              { label: 'Codigos de barra', href: `/codigos-barra${qs}` },
              { label: 'Etiquetas' },
            ]}
            actions={<PrintButton label="Imprimir etiquetas" />}
          />
        </div>

        {productos.length === 0 ? (
          <Card>
            <CardBody className="print:hidden">
              <EmptyState
                icon="sell"
                title="Ningun producto tiene codigo de barras todavia"
                description="Generalos primero desde Codigos de barra."
              />
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3">
            {productos.map((p) => (
              <div
                key={p.id}
                className="flex flex-col items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-center print:break-inside-avoid print:border-black"
              >
                <p className="text-xs font-medium text-[var(--color-text-primary)]">{p.name}</p>
                <CodigoBarras codigo={p.barcode} />
                <p className="font-mono text-[10px] tracking-widest text-[var(--color-text-muted)]">
                  {p.barcode}
                </p>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  RD$ {money(Number(p.price))}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}
