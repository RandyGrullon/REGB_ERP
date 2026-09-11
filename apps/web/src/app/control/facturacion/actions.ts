'use server'

import { revalidatePath } from 'next/cache'
import { requireProvider } from '@/lib/provider-guard'
import { generateMonthlyInvoices, recordManualPayment } from '@/lib/invoicing'
import { anotarAviso } from '@/lib/aviso'

/**
 * Acciones de facturacion. Cada una re-verifica que quien llama es el
 * proveedor: una server action es un endpoint HTTP publico y no hereda
 * la barrera de la pagina que la pinta.
 */

export async function generarFacturasDelMes(): Promise<void> {
  await requireProvider()
  const n = await generateMonthlyInvoices()
  revalidatePath('/control/facturacion')
  await anotarAviso(
    { ok: true },
    'generarFacturasDelMes',
    typeof n === 'number' ? `Listo, generamos ${n} factura(s).` : 'Listo, generamos las facturas del mes.',
  )
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
  await anotarAviso({ ok: true }, 'registrarPago', 'Listo, registramos el pago.')
}

export async function aplicarDunning(): Promise<void> {
  await requireProvider()
  const { db } = await import('@/lib/db')
  await db()`select * from regb.apply_dunning()`
  revalidatePath('/control/facturacion')
  revalidatePath('/control')
  await anotarAviso({ ok: true }, 'aplicarDunning', 'Listo, aplicamos el ciclo de cobranza.')
}
