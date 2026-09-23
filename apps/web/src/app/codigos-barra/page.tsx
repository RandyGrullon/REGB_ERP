import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
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
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { generarCodigosFaltantesForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Codigos de barra · REGB ERP' }

interface ProductoRow {
  id: string
  sku: string
  name: string
  barcode: string | null
}

/** Codigos de barra & RFID (modulo 52): EAN-13 real, etiquetas, escaneo. */
export default async function CodigosBarraPage({
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
      select id, sku, name, barcode from public.products
      where tenant_id = ${ctx.tenantId} and active
      order by (barcode is null) desc, name`,
  )

  const sinCodigo = productos.filter((p) => !p.barcode).length
  const puedeGenerar = exigir(ctx, 'barcode', 'barcode.generate').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/codigos-barra">
      <div className="space-y-5">
        <PageHeader
          icon="qr_code_scanner"
          title="Codigos de barra"
          description="EAN-13 real -digito verificador calculado, no un numero inventado-, etiquetas para imprimir y escaneo con la camara del celular."
          actions={
            <div className="flex gap-2">
              <a
                href={`/codigos-barra/escaneo${qs}`}
                className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
              >
                <Icon name="qr_code_scanner" size={14} />
                Escanear
              </a>
              <a
                href={`/codigos-barra/etiquetas${qs}`}
                className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
              >
                <Icon name="sell" size={14} />
                Etiquetas
              </a>
            </div>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Productos activos" value={String(productos.length)} />
          <StatCard label="Sin codigo de barras" value={String(sinCodigo)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Catalogo</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {productos.length === 0 ? (
              <EmptyState icon="qr_code_scanner" title="No hay productos activos" description="" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>SKU</TH>
                    <TH>Producto</TH>
                    <TH>Codigo de barras</TH>
                  </TR>
                </THead>
                <TBody>
                  {productos.map((p) => (
                    <TR key={p.id}>
                      <TD>
                        <Mono>{p.sku}</Mono>
                      </TD>
                      <TD className="text-[var(--color-text-primary)]">{p.name}</TD>
                      <TD>
                        {p.barcode ? (
                          <Mono>{p.barcode}</Mono>
                        ) : (
                          <Badge tone="warning">Sin codigo</Badge>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {puedeGenerar && sinCodigo > 0 && (
              <form action={generarCodigosFaltantesForm} className="border-t border-[var(--color-border)] p-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="auto_awesome" size={14} />
                  Generar codigos faltantes ({sinCodigo})
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
