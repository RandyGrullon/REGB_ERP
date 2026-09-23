import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { SecuenciasNcf } from '@/components/fiscal/SecuenciasNcf'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Comprobantes fiscales · REGB ERP' }

/**
 * Secuencias NCF desde Por cobrar.
 *
 * La misma pantalla vive en la Caja (/pos/comprobantes) para quien vende
 * solo en mostrador: los NCF los emiten los dos modulos. El contenido es
 * uno solo -components/fiscal/SecuenciasNcf.tsx- para que no haya dos
 * verdades sobre que secuencia esta en uso.
 */
export default async function NcfPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'ar')
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/cobrar/ncf">
      <SecuenciasNcf
        ctx={ctx}
        puedeGestionar={exigir(ctx, 'ar', 'ar.invoice.create').ok}
        crumbs={[{ label: 'Por cobrar', href: `/cobrar${qs}` }, { label: 'Comprobantes' }]}
      />
    </Shell>
  )
}
