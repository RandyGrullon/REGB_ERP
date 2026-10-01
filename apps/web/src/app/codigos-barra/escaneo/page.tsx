import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Mono,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { exigir, modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { EscaneoCodigoBarras } from '@/components/EscaneoCodigoBarras'
import { registrarEscaneoForm } from '../actions'
import { cantidad, pesos } from '@/lib/cantidad'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Escaneo · REGB ERP' }

interface ProductoEncontrado {
  id: string
  sku: string
  name: string
  unit: string
  price: string
}

interface ExistenciaRow {
  warehouse_name: string
  qty_on_hand: string
}

/** Escaneo (modulo 52): camara del celular o entrada manual -mismo resultado-. */
export default async function EscaneoPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { codigo?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'barcode', 'barcode.scan')
  // El precio de venta es de quien tiene `products.price.view` (el
  // almacenista escanea para ubicar, no para cobrar).
  const vePrecio = exigir(ctx, 'products', 'products.price.view').ok
  const codigo = params.codigo ?? ''

  const { producto, existencias } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    if (!codigo) return { producto: null, existencias: [] }

    const [p] = await tx<ProductoEncontrado[]>`
      select id, sku, name, unit, price::text from public.products
      where tenant_id = ${ctx.tenantId} and barcode = ${codigo}`
    if (!p) return { producto: null, existencias: [] }

    const e = await tx<ExistenciaRow[]>`
      select w.name as warehouse_name, s.qty_on_hand::text
      from public.stock_levels s
      join public.warehouses w on w.id = s.warehouse_id
      where s.tenant_id = ${ctx.tenantId} and s.product_id = ${p.id}
      order by w.name`

    return { producto: p, existencias: e }
  })

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/codigos-barra/escaneo">
      <div className="space-y-5">
        <PageHeader
          icon="qr_code_scanner"
          title="Escaneo"
          description="Apunta la cámara del celular al código, o escríbelo. Una pistola lectora también sirve: escribe el código y da Enter sola."
          crumbs={[
            { label: 'Códigos de barra', href: `/codigos-barra${qs}` },
            { label: 'Escaneo' },
          ]}
        />

        <Card>
          <CardBody className="pt-4">
            <EscaneoCodigoBarras
              action={registrarEscaneoForm}
              tenant={qs ? ctx.tenantSlug : ''}
              rol={qs ? ctx.roleName : ''}
            />
          </CardBody>
        </Card>

        {codigo && (
          <Card>
            <CardHeader>
              <CardTitle>Resultado de {codigo}</CardTitle>
            </CardHeader>
            <CardBody>
              {!producto ? (
                <p className="flex items-center gap-2 text-sm text-[var(--color-semantic-text-danger)]">
                  <Badge tone="danger">Sin coincidencia</Badge>
                  Ningún producto tiene ese código de barras.
                </p>
              ) : (
                <div className="space-y-3">
                  <div>
                    <p className="text-lg font-semibold text-[var(--color-text-primary)]">
                      <Mono>{producto.sku}</Mono> {producto.name}
                    </p>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {vePrecio
                        ? `${pesos(producto.price)} por ${producto.unit}`
                        : `Se vende por ${producto.unit}`}
                    </p>
                  </div>
                  {existencias.length === 0 && (
                    <p className="text-sm text-[var(--color-text-muted)]">
                      No hay existencias de este producto en ningún almacén.
                    </p>
                  )}
                  {existencias.length > 0 && (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Almacén</TH>
                          <TH numeric>Existencia</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {existencias.map((e) => (
                          <TR key={e.warehouse_name}>
                            <TD>{e.warehouse_name}</TD>
                            <TD numeric>
                              <span className="tabular">
                                {cantidad(e.qty_on_hand, producto.unit)}
                              </span>
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
