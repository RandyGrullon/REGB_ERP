import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { SecuenciasNcf } from '@/components/fiscal/SecuenciasNcf'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Comprobantes fiscales · REGB ERP' }

/**
 * Secuencias NCF desde la Caja.
 *
 * Un colmado que solo vende en mostrador emite NCF en cada ticket, y hasta
 * la 0129 no tenia donde cargar su autorizacion de la DGII: la pantalla
 * vivia en Por cobrar, que exige Pedidos, dos modulos de credito que un
 * colmado no usa. El aviso amarillo de la caja enlazaba a un 404.
 *
 * `pos.ncf.manage` y no `pos.sell`: el cajero vende con el NCF, pero
 * cargar, corregir o dar de baja un rango autorizado es del dueño. La base
 * lo exige igual (politica `registrar_pos`).
 */
export default async function ComprobantesCajaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'pos', 'pos.ncf.manage')
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/pos/comprobantes">
      <SecuenciasNcf
        ctx={ctx}
        puedeGestionar
        crumbs={[{ label: 'Caja', href: `/pos${qs}` }, { label: 'Comprobantes' }]}
      />
    </Shell>
  )
}
