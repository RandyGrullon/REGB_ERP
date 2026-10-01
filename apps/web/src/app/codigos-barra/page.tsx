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
export const metadata = { title: 'Códigos de barra · REGB ERP' }

interface ProductoRow {
  id: string
  sku: string
  name: string
  barcode: string | null
  tracks_stock: boolean
}

/** Codigos de barra & RFID (modulo 52): EAN-13 real, etiquetas, escaneo. */
export default async function CodigosBarraPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'barcode')

  const { productos, escaneos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const p = await tx<ProductoRow[]>`
      select id, sku, name, barcode, tracks_stock from public.products
      where tenant_id = ${ctx.tenantId} and active
      order by tracks_stock desc, (barcode is null) desc, name`
    const [e] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.barcode_scans
      where tenant_id = ${ctx.tenantId} and scanned_at > now() - interval '30 days'`
    return { productos: p, escaneos: Number(e?.n ?? 0) }
  })

  // Un servicio (envío, instalación) no se escanea ni lleva etiqueta.
  const sinCodigo = productos.filter((p) => p.tracks_stock && !p.barcode).length
  const puedeGenerar = exigir(ctx, 'barcode', 'barcode.generate').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/codigos-barra">
      <div className="space-y-5">
        <PageHeader
          icon="qr_code_scanner"
          title="Códigos de barra"
          description="Cada producto con su código EAN-13 (con dígito verificador, como lo lee cualquier lector), etiquetas para imprimir y escaneo con la cámara del celular."
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
          <StatCard
            label="Sin código de barras"
            value={String(sinCodigo)}
            hint={sinCodigo > 0 ? 'genéralos abajo' : 'todos listos'}
          />
          <StatCard label="Escaneos" value={String(escaneos)} hint="últimos 30 días" />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Catálogo</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {productos.length === 0 ? (
              <EmptyState
                icon="qr_code_scanner"
                title="No hay productos activos"
                description="Los códigos de barra se asignan a los productos del catálogo. Crea o reactiva uno en Catálogo."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Código</TH>
                    <TH>Producto</TH>
                    <TH>Código de barras</TH>
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
                        ) : p.tracks_stock ? (
                          <Badge tone="warning">Sin código</Badge>
                        ) : (
                          <Badge tone="neutral" dot={false} title="Un servicio no se escanea">
                            Servicio
                          </Badge>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {puedeGenerar && sinCodigo > 0 && (
              <form
                action={generarCodigosFaltantesForm}
                className="border-t border-[var(--color-border)] p-3"
              >
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="auto_awesome" size={14} />
                  Generar códigos faltantes ({sinCodigo})
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
