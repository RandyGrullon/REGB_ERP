import Link from 'next/link'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/provider-guard'
import { authConfigured } from '@/lib/supabase'
import { AltaClienteForm } from '../AltaClienteForm'
import type { ModuloOfrecido } from '../alta'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nuevo cliente · REGB Control' }

/**
 * Alta de un cliente real (0133). Antes era un `insert` a mano
 * (PRIMER-CLIENTE.md §3) y el cliente nacia sin empresa principal, sin
 * almacen y sin dueño.
 *
 * El catalogo se lee con `db()` -dueño de las tablas- porque es zona del
 * proveedor: la barrera es `requireProvider()` aqui y `is_provider` en la
 * funcion de la base (§7).
 */
export default async function NuevoClientePage() {
  await requireProvider()

  // Sin precios a proposito: /control factura con la matriz de @regb/billing
  // y el marketplace ya enseño otro numero una vez (analisis, hallazgo 9).
  // La mensualidad se mira en la ficha del cliente, que usa el mismo motor.
  const modulos = await db()<ModuloOfrecido[]>`
    select mc.id, mc.name, mc.category, mc.requires, mc.recommends
    from regb.module_catalog mc
    where mc.is_published
    order by mc.name`

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <nav aria-label="Miga de pan" className="text-sm text-[var(--color-text-muted)]">
        <Link href="/control" className="text-[var(--color-text-link)] hover:underline">
          Clientes
        </Link>{' '}
        ›{' '}
        <Link href="/control/onboarding" className="text-[var(--color-text-link)] hover:underline">
          Onboarding
        </Link>{' '}
        › Nuevo cliente
      </nav>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
          Dar de alta un cliente
        </h1>
        <p className="max-w-prose text-sm text-[var(--color-text-secondary)]">
          En un solo paso queda listo para que su dueño entre y venda: su RNC validado, lo que
          compro con sus dependencias, la empresa que sale en cada comprobante, una sucursal, el
          almacén de la caja, sus roles y la invitación al dueño. Si algo falla no se guarda nada, y
          repetirlo no duplica nada.
        </p>
      </header>

      <AltaClienteForm modulos={modulos} modoDemo={!authConfigured} />
    </div>
  )
}
