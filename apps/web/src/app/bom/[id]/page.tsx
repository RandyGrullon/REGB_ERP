import { Fragment } from 'react'
import { notFound } from 'next/navigation'
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
} from '@regb/ui'
import type postgres from 'postgres'
import { costoUnitarioMultinivel, type NodoBom } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { activarBomForm, agregarLineaForm, quitarLineaForm } from '../actions'
import { ESTADO_BOM } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface BomHead {
  id: string
  product_id: string
  sku: string
  product_name: string
  version: number
  status: string
  output_qty: string
}

interface LineaRow {
  id: string
  component_product_id: string
  sku: string
  name: string
  cost: string
  quantity_per_unit: string
  is_substitute_for: string | null
}

interface ProductoOption {
  id: string
  sku: string
  name: string
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/**
 * Resuelve recursivamente el nodo de un componente: si tiene su
 * propia receta ACTIVA, se expande con ELLA (multinivel real); si no,
 * su costo es el directo del producto. Tope de profundidad como red
 * de seguridad -el trigger solo bloquea el ciclo directo (un producto
 * como componente de si mismo), no uno mas profundo entre varios-.
 */
async function resolverNodo(
  tx: postgres.TransactionSql,
  tenantId: string,
  productId: string,
  cantidadPorUnidad: number,
  profundidad: number,
): Promise<NodoBom> {
  const [producto] = await tx<{ cost: string }[]>`
    select cost::text from public.products where id = ${productId} and tenant_id = ${tenantId}`
  const costoDirecto = Number(producto?.cost ?? 0)

  if (profundidad >= 10) return { productId, cantidadPorUnidad, costoDirecto }

  const [subBom] = await tx<{ id: string; output_qty: string }[]>`
    select id, output_qty::text from public.bill_of_materials
    where tenant_id = ${tenantId} and product_id = ${productId} and status = 'active'`
  if (!subBom) return { productId, cantidadPorUnidad, costoDirecto }

  const lineas = await tx<{ component_product_id: string; quantity_per_unit: string }[]>`
    select component_product_id, quantity_per_unit::text from public.bom_lines
    where bom_id = ${subBom.id} and tenant_id = ${tenantId} and is_substitute_for is null`

  const subComponentes = await Promise.all(
    lineas.map((l) =>
      resolverNodo(
        tx,
        tenantId,
        l.component_product_id,
        Number(l.quantity_per_unit) / Number(subBom.output_qty),
        profundidad + 1,
      ),
    ),
  )
  return { productId, cantidadPorUnidad, costoDirecto: 0, subComponentes }
}

/** Detalle de un BOM (modulo 55): componentes, sustitutos, costeo multinivel, activar version. */
export default async function BomDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'bom')

  const { head, lineas, productos, costoUnitario } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<BomHead[]>`
      select bm.id, bm.product_id, p.sku, p.name as product_name, bm.version, bm.status, bm.output_qty::text
      from public.bill_of_materials bm
      join public.products p on p.id = bm.product_id
      where bm.id = ${id} and bm.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, lineas: [], productos: [], costoUnitario: 0 }

    const l = await tx<LineaRow[]>`
      select bl.id, bl.component_product_id, p.sku, p.name, p.cost::text,
             bl.quantity_per_unit::text, bl.is_substitute_for
      from public.bom_lines bl
      join public.products p on p.id = bl.component_product_id
      where bl.bom_id = ${id} and bl.tenant_id = ${ctx.tenantId}
      order by bl.is_substitute_for nulls first`

    const prod =
      h.status === 'draft'
        ? await tx<ProductoOption[]>`
            select id, sku, name from public.products
            where tenant_id = ${ctx.tenantId} and active order by name limit 300`
        : []

    const principales = l.filter((x) => x.is_substitute_for === null)
    const subComponentes = await Promise.all(
      principales.map((p) =>
        resolverNodo(
          tx,
          ctx.tenantId,
          p.component_product_id,
          Number(p.quantity_per_unit) / Number(h.output_qty),
          0,
        ),
      ),
    )
    const raiz: NodoBom = { productId: h.product_id, cantidadPorUnidad: 1, costoDirecto: 0, subComponentes }
    const costo = principales.length > 0 ? costoUnitarioMultinivel(raiz) : 0

    return { head: h, lineas: l, productos: prod, costoUnitario: costo }
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'bom', 'bom.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="bomId" value={head.id} />
    </>
  )
  const enBorrador = head.status === 'draft'
  const principales = lineas.filter((l) => !l.is_substitute_for)
  const sustitutosDe = (lineaId: string) => lineas.filter((l) => l.is_substitute_for === lineaId)

  return (
    <Shell {...shell} activePath="/bom">
      <div className="space-y-5">
        <PageHeader
          icon="account_tree"
          title={`${head.sku} · ${head.product_name} (v${head.version})`}
          crumbs={[{ label: 'Lista de materiales', href: `/bom${qs}` }, { label: `v${head.version}` }]}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone={head.status === 'active' ? 'success' : head.status === 'draft' ? 'warning' : 'neutral'}>
                {ESTADO_BOM[head.status] ?? head.status}
              </Badge>
              {enBorrador && puedeGestionar && lineas.length > 0 && (
                <form action={activarBomForm}>
                  {campos}
                  <BotonEnvio  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="check_circle" size={14} />
                    Activar
                  </BotonEnvio>
                </form>
              )}
            </div>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Produce" value={head.output_qty} />
          <StatCard label="Costo unitario (multinivel)" value={`RD$ ${money(costoUnitario)}`} />
        </section>

        <Table>
          <THead>
            <TR>
              <TH>Componente</TH>
              <TH numeric>Cantidad</TH>
              <TH numeric>Costo directo</TH>
              {enBorrador && puedeGestionar && (
                <TH>
                  <span className="sr-only">Accion</span>
                </TH>
              )}
            </TR>
          </THead>
          <TBody>
            {principales.map((l) => (
              <Fragment key={l.id}>
                <TR>
                  <TD className="text-[var(--color-text-primary)]">
                    <Mono>{l.sku}</Mono> {l.name}
                  </TD>
                  <TD numeric>
                    <span className="tabular">{l.quantity_per_unit}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">RD$ {money(Number(l.cost))}</span>
                  </TD>
                  {enBorrador && puedeGestionar && (
                    <TD>
                      <form action={quitarLineaForm}>
                        {campos}
                        <input type="hidden" name="lineId" value={l.id} />
                        <BotonEnvio
                          
                          aria-label={`Quitar ${l.name}`}
                          className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-semantic-text-danger)]">
                          <Icon name="delete" size={16} />
                        </BotonEnvio>
                      </form>
                    </TD>
                  )}
                </TR>
                {sustitutosDe(l.id).map((s) => (
                  <TR key={s.id}>
                    <TD className="pl-6 text-[var(--color-text-muted)]">
                      <Badge tone="neutral">Sustituto</Badge> <Mono>{s.sku}</Mono> {s.name}
                    </TD>
                    <TD numeric>
                      <span className="tabular">{s.quantity_per_unit}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">RD$ {money(Number(s.cost))}</span>
                    </TD>
                    {enBorrador && puedeGestionar && (
                      <TD>
                        <form action={quitarLineaForm}>
                          {campos}
                          <input type="hidden" name="lineId" value={s.id} />
                          <BotonEnvio
                            
                            aria-label={`Quitar sustituto ${s.name}`}
                            className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-semantic-text-danger)]">
                            <Icon name="delete" size={16} />
                          </BotonEnvio>
                        </form>
                      </TD>
                    )}
                  </TR>
                ))}
              </Fragment>
            ))}
          </TBody>
        </Table>

        {enBorrador && puedeGestionar && productos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Agregar componente</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={agregarLineaForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Componente
                  <select name="componentProductId" required className={claseInput}>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cantidad
                  <input name="quantityPerUnit" required inputMode="decimal" className={`tabular ${claseInput}`} />
                </label>
                <label className="flex min-w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Sustituto de
                  <select name="isSubstituteFor" className={claseInput}>
                    <option value="">Linea principal</option>
                    {principales.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Agregar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
