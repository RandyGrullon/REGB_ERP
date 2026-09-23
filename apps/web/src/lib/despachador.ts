import 'server-only'

import { db } from './db'
import { HANDLERS_CONTABLES } from './contabilidad-automatica'

/**
 * Despachador del bus de eventos (§4).
 *
 * El outbox estaba construido y **desenchufado**: `emit_event` escribia,
 * `claim_events` y `settle_event` existian, y nadie los llamaba. Los
 * eventos se acumulaban sin procesarse, asi que ningun modulo reaccionaba
 * nunca a otro por esta via.
 *
 * ── Por que un outbox y no una llamada directa ────────────────────────
 *
 * Porque el evento se escribe en la MISMA transaccion que el dato. Si la
 * venta se guarda, su evento existe; si la transaccion falla, tampoco hay
 * evento. Llamar al otro modulo directamente rompe eso: la venta se
 * guarda, la llamada falla, y nadie se entera de nada.
 *
 * A cambio, la entrega es *at-least-once*: un evento puede procesarse dos
 * veces si el proceso muere despues de actuar y antes de marcar. Por eso
 * **todo handler tiene que ser idempotente**, y por eso nada que la venta
 * NECESITE para cerrarse cuelga de aqui — la reserva de stock es sincrona
 * a proposito (§S20).
 *
 * La contabilidad SI cuelga de aqui (ADR 0001): el asiento no le hace
 * falta a la venta para cerrarse, y un asiento que falla no puede tumbar
 * la caja. Lo que la hace confiable es la clave unica por origen (un
 * reintento no duplica) y los reintentos con espera de este despachador
 * (un mapa roto no pierde el asiento: sale cuando se corrige).
 *
 * ── Por que un mapa por TEMA y no por modulo ──────────────────────────
 *
 * El core no conoce ids de modulo (§2.2). Este archivo mapea TEMAS a
 * handlers, igual que los widgets mapean claves. Un tema sin handler no
 * es un error: se marca procesado y se sigue. Lo contrario —reintentar
 * para siempre un evento que nadie escucha— llena el outbox de basura que
 * parece un fallo.
 */

export interface EventoPendiente {
  id: string
  tenant_id: string
  type: string
  payload: Record<string, unknown>
  attempts: number
}

export interface ResultadoDespacho {
  reclamados: number
  procesados: number
  fallidos: number
  sinHandler: number
  errores: { tema: string; error: string }[]
}

/** Cuando se agota, el evento se descarta a la cola muerta. */
const MAX_INTENTOS = 5

/** Espera creciente entre reintentos: 1 min, 4, 9, 16, 25. */
const esperaSegundos = (intentos: number) => Math.min(intentos * intentos * 60, 3600)

type Handler = (e: EventoPendiente, sql: ReturnType<typeof db>) => Promise<void>

/** Avisa dentro del ERP. Idempotente por (tenant, titulo, enlace). */
async function notificar(
  sql: ReturnType<typeof db>,
  tenantId: string,
  moduleId: string,
  titulo: string,
  cuerpo: string,
  enlace: string,
): Promise<void> {
  // Sin `on conflict` porque no hay clave unica: se comprueba antes. Un
  // aviso repetido no rompe nada, pero una bandeja con el mismo mensaje
  // cinco veces hace que el cliente deje de mirarla.
  const [ya] = await sql<{ id: string }[]>`
    select id from public.notifications
    where tenant_id = ${tenantId} and title = ${titulo} and link = ${enlace}
      and created_at > now() - interval '1 day'`
  if (ya) return

  await sql`
    insert into public.notifications (tenant_id, module_id, title, body, link)
    values (${tenantId}, ${moduleId}, ${titulo}, ${cuerpo}, ${enlace})`
}

/**
 * Tema → aviso.
 *
 * Solo hay handlers para lo que de verdad aporta hoy. Inventarse
 * reacciones para los 20 temas declarados seria construir para nadie.
 */
const AVISOS: Record<string, Handler> = {
  /**
   * Entregado ≠ facturado. El evento NO crea la factura —hacerlo
   * duplicaria facturas el dia que un evento se reintente— sino que
   * enciende el aviso de que hay algo pendiente de facturar. Crear la
   * factura sigue siendo una accion explicita (§S22).
   */
  'sales-orders.order.delivered': async (e, sql) => {
    const numero = String(e.payload.number ?? e.payload.orderId ?? '')
    await notificar(
      sql,
      e.tenant_id,
      'ar',
      'Hay un pedido entregado sin facturar',
      `El pedido ${numero} ya se entrego. Emitele la factura para que entre a la cartera y al 607.`,
      '/cobrar',
    )
  },

  /**
   * Un descuadre de caja se mira el mismo dia o no se mira. Solo avisa
   * si hay diferencia: un arqueo que cuadra no merece una notificacion.
   */
  'pos.shift.closed': async (e, sql) => {
    const diferencia = Number(e.payload.variance ?? 0)
    if (Math.abs(diferencia) < 0.01) return
    const falta = diferencia < 0
    await notificar(
      sql,
      e.tenant_id,
      'pos',
      falta ? 'Falto efectivo en el cierre de caja' : 'Sobro efectivo en el cierre de caja',
      `La diferencia fue de ${Math.abs(diferencia).toFixed(2)}. Casi nunca es robo: suele ser vuelto mal dado o un precio desactualizado.`,
      '/pos/shifts',
    )
  },

  /**
   * Una venta baja existencias. Si algun producto quedo bajo su punto de
   * reorden, hay que reponer antes de quedarse sin nada que vender.
   */
  'pos.sale.completed': async (e, sql) => {
    const [bajo] = await sql<{ n: string }[]>`
      select count(*)::text as n
      from public.stock_levels s
      join public.products p on p.id = s.product_id
      where s.tenant_id = ${e.tenant_id}
        and p.reorder_point > 0 and s.qty_on_hand <= p.reorder_point`
    if (Number(bajo?.n ?? 0) === 0) return

    await notificar(
      sql,
      e.tenant_id,
      'inventory',
      `${bajo!.n} producto(s) bajo el punto de reorden`,
      'Se vendio y quedaron por debajo del minimo que fijaste. Repon antes de quedarte sin que vender.',
      '/inventory',
    )
  },

  /**
   * Confirmar aparta stock. Si algo quedo en backorder, el vendedor
   * prometio lo que no hay y alguien tiene que comprarlo.
   */
  'sales-orders.order.confirmed': async (e, sql) => {
    const [b] = await sql<{ n: string }[]>`
      select count(*)::text as n from public.sales_order_lines
      where tenant_id = ${e.tenant_id} and qty_reserved < qty_ordered - qty_delivered`
    if (Number(b?.n ?? 0) === 0) return

    await notificar(
      sql,
      e.tenant_id,
      'sales-orders',
      'Hay lineas prometidas sin existencia',
      `${b!.n} linea(s) en backorder. Es tu lista de compras hecha por los clientes.`,
      '/pedidos',
    )
  },
}

/**
 * Tema → TODOS sus handlers: el aviso y el asiento contable
 * (`contabilidad-automatica.ts`, ADR 0001). Un tema puede tener los dos
 * -una venta de caja avisa del bajo stock Y se contabiliza-.
 *
 * Se corren en orden y si uno falla el evento entero se reintenta, asi
 * que el que ya actuo vuelve a correr: por eso cada uno es idempotente
 * por su cuenta (el aviso mira si ya existe; el asiento tiene clave
 * unica por origen).
 */
const HANDLERS: Record<string, Handler[]> = {}
for (const fuente of [AVISOS, HANDLERS_CONTABLES]) {
  for (const [tema, h] of Object.entries(fuente)) (HANDLERS[tema] ??= []).push(h)
}

/** Los temas que este despachador sabe atender. Para diagnostico. */
export const TEMAS_ATENDIDOS = Object.keys(HANDLERS)

/**
 * Procesa un lote.
 *
 * Cada evento va en su propio intento: uno que falla NO arrastra a los
 * demas del lote. Un lote entero perdido por un dato raro en una fila
 * seria justo el fallo que hace desconfiar del bus.
 */
export async function despachar(limite = 50): Promise<ResultadoDespacho> {
  const sql = db()
  const eventos = await sql<EventoPendiente[]>`
    select id::text, tenant_id::text, type, payload, attempts
    from public.claim_events(${limite})`

  const r: ResultadoDespacho = {
    reclamados: eventos.length,
    procesados: 0,
    fallidos: 0,
    sinHandler: 0,
    errores: [],
  }

  for (const e of eventos) {
    const handlers = HANDLERS[e.type]

    if (!handlers) {
      // Nadie lo escucha. Se cierra en vez de reintentar para siempre:
      // un outbox lleno de eventos que nadie quiere parece una averia.
      await sql`select public.settle_event(${e.id}::bigint, true, null, null)`
      r.sinHandler++
      continue
    }

    try {
      for (const handler of handlers) await handler(e, sql)
      await sql`select public.settle_event(${e.id}::bigint, true, null, null)`
      r.procesados++
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'Error inesperado'
      // Sin delay = se agotaron los intentos y va a la cola muerta, que
      // es lo que ensena /control/salud.
      const delay = e.attempts >= MAX_INTENTOS ? null : esperaSegundos(e.attempts)
      await sql`select public.settle_event(${e.id}::bigint, false, ${mensaje}, ${delay})`
      r.fallidos++
      r.errores.push({ tema: e.type, error: mensaje.slice(0, 200) })
    }
  }

  return r
}
