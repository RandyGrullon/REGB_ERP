import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ReportesDgii } from '@/components/fiscal/ReportesDgii'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reportes DGII · REGB ERP' }

/**
 * Reportes 607 y 608 desde la Caja.
 *
 * Un colmado que solo vende en mostrador declara su 607 igual que una
 * distribuidora: cada ticket con NCF va ahi. Hasta la 0129 la pantalla
 * colgaba de Por cobrar y el colmado recibia un 404. `pos.export` es el
 * gemelo de `ar.export`: bajar lo que se le declara a la DGII.
 */
export default async function DgiiCajaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { periodo?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'pos', 'pos.export')
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/pos/dgii">
      <ReportesDgii
        ctx={ctx}
        periodoPedido={params.periodo}
        veCompras={exigir(ctx, 'ap', 'ap.export').ok}
        rutaBase="/pos/dgii"
        crumbs={[{ label: 'Caja', href: `/pos${qs}` }, { label: 'Reportes DGII' }]}
      />
    </Shell>
  )
}
