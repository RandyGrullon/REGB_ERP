import { NextResponse } from 'next/server'
import { cobrarVenta } from '@/app/pos/actions'

export const dynamic = 'force-dynamic'

/**
 * Sincronizacion de ventas hechas sin conexion (F5).
 *
 * Existe porque la app de escritorio necesita algo contra lo que
 * REINTENTAR, y una Server Action no lo es: se invoca desde el navegador
 * con un protocolo interno de Next, no desde un proceso Node que despierta
 * media hora despues con seis ventas en la cola.
 *
 * No duplica logica: arma el mismo FormData que manda el terminal y llama
 * a `cobrarVenta`. Precios, impuestos, permisos, stock y NCF se calculan
 * en un solo sitio, y ese sitio ya estaba escrito. Dos caminos con dos
 * copias de las reglas es como el ticket offline acaba cobrando distinto
 * que el online.
 *
 * La idempotencia la garantiza `client_ref`: si la venta ya entro,
 * `cobrarVenta` la reconoce y responde ok sin crear otra ni quemar un NCF.
 * Por eso el reintento es seguro por diseno y no por cuidado del que llama.
 */

interface VentaEncolada {
  clientRef: string
  soldAt: string
  shiftId: string
  customerId?: string | null
  cart: unknown
  payments: unknown
  tenant?: string
  rol?: string
}

export async function POST(req: Request) {
  let cuerpo: { ventas?: VentaEncolada[] }
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo no valido.' }, { status: 400 })
  }

  const ventas = Array.isArray(cuerpo.ventas) ? cuerpo.ventas : []
  if (ventas.length === 0) {
    return NextResponse.json({ ok: false, error: 'Nada que sincronizar.' }, { status: 400 })
  }
  // Tope por lote: una caja que estuvo un dia entero sin linea no puede
  // tumbar el servidor con un solo envio. La app manda el resto despues.
  if (ventas.length > 100) {
    return NextResponse.json(
      { ok: false, error: 'Manda como maximo 100 por lote.' },
      { status: 413 },
    )
  }

  const resultados: { clientRef: string; ok: boolean; error?: string }[] = []

  // En serie a proposito: cada venta consume numero y NCF de secuencias
  // con candado. En paralelo solo se pelearian por el mismo bloqueo y
  // llegarian igual de rapido, con los errores mas dificiles de leer.
  for (const v of ventas) {
    if (!v?.clientRef || !v?.shiftId) {
      resultados.push({ clientRef: v?.clientRef ?? '?', ok: false, error: 'Venta incompleta.' })
      continue
    }

    const fd = new FormData()
    fd.set('clientRef', v.clientRef)
    fd.set('soldAt', v.soldAt ?? '')
    fd.set('shiftId', v.shiftId)
    fd.set('customerId', v.customerId ?? '')
    fd.set('cart', JSON.stringify(v.cart ?? []))
    fd.set('payments', JSON.stringify(v.payments ?? []))
    if (v.tenant) fd.set('tenant', v.tenant)
    if (v.rol) fd.set('rol', v.rol)

    try {
      const r = await cobrarVenta(fd)
      resultados.push(
        r.ok
          ? { clientRef: v.clientRef, ok: true }
          : { clientRef: v.clientRef, ok: false, error: r.error },
      )
    } catch (e) {
      // Un fallo de red o de base NO se traga: la venta se queda en la
      // cola de la caja y se reintenta. Responder ok aqui la borraria.
      resultados.push({
        clientRef: v.clientRef,
        ok: false,
        error: e instanceof Error ? e.message : 'Error inesperado.',
      })
    }
  }

  const aceptadas = resultados.filter((r) => r.ok).length
  return NextResponse.json({
    ok: true,
    aceptadas,
    rechazadas: resultados.length - aceptadas,
    resultados,
  })
}
