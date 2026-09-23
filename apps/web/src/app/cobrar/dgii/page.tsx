import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ReportesDgii } from '@/components/fiscal/ReportesDgii'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reportes DGII · REGB ERP' }

/**
 * Reportes 606, 607 y 608 desde Por cobrar.
 *
 * La misma pantalla vive en la Caja (/pos/dgii) para el negocio que solo
 * vende en mostrador. El contenido es uno: components/fiscal/ReportesDgii.
 */
export default async function DgiiPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { periodo?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'ar', 'ar.export')
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/cobrar/dgii">
      <ReportesDgii
        ctx={ctx}
        periodoPedido={params.periodo}
        veCompras={exigir(ctx, 'ap', 'ap.export').ok}
        rutaBase="/cobrar/dgii"
        crumbs={[{ label: 'Por cobrar', href: `/cobrar${qs}` }, { label: 'Reportes DGII' }]}
      />
    </Shell>
  )
}
