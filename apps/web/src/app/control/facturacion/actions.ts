'use server'

import { revalidatePath } from 'next/cache'
import { requireProvider } from '@/lib/provider-guard'
import { generateMonthlyInvoices, recordManualPayment, resumenDeCorrida } from '@/lib/invoicing'
import { anotarAviso } from '@/lib/aviso'
import { db } from '@/lib/db'

/**
 * Acciones de facturacion. Cada una re-verifica que quien llama es el
 * proveedor: una server action es un endpoint HTTP publico y no hereda
 * la barrera de la pagina que la pinta.
 */

export async function generarFacturasDelMes(): Promise<void> {
  await requireProvider()
  const r = await generateMonthlyInvoices()
  revalidatePath('/control/facturacion')
  revalidatePath('/control', 'layout')
  await anotarAviso({ ok: true }, 'generarFacturasDelMes', resumenDeCorrida(r))
}

export async function registrarPago(formData: FormData): Promise<void> {
  await requireProvider()
  const invoiceId = String(formData.get('invoiceId') ?? '')
  if (!invoiceId) {
    await anotarAviso({ ok: false, error: 'Falta la factura.' }, 'registrarPago')
    return
  }
  await recordManualPayment(invoiceId)
  revalidatePath('/control/facturacion')
  revalidatePath('/control', 'layout')
  await anotarAviso(
    { ok: true },
    'registrarPago',
    'Listo, registramos el pago. Si el cliente estaba en mora y ya no debe nada, volvió a activo.',
  )
}

/** El ciclo de cobranza por mora (5/10/15/30/90 dias). Idempotente; jamas borra. */
export async function aplicarDunning(): Promise<void> {
  await requireProvider()
  const cambios = await db()<{ tenant_id: string }[]>`select * from regb.apply_dunning()`
  revalidatePath('/control/facturacion')
  revalidatePath('/control', 'layout')
  await anotarAviso(
    { ok: true },
    'aplicarDunning',
    cambios.length === 0
      ? 'Listo, revisamos la mora: ningún cliente cambió de estado.'
      : `Listo, revisamos la mora: ${cambios.length} cliente${cambios.length === 1 ? '' : 's'} cambió de estado.`,
  )
}
