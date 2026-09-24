'use server'

import { revalidatePath } from 'next/cache'
import { calendarioFiscal, creditoArrastrado, liquidarItbis } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Cierre de la liquidacion IT-1 (modulo 24).
 *
 * Cerrar guarda una FOTO: los numeros que se entregaron, no una vista que
 * se recalcula. Si mañana se corrige una factura de enero, la declaracion
 * de enero no cambia -eso se arregla con una rectificativa-. Por eso solo
 * hay insert: no existe "recalcular una declaracion cerrada", y ese es el
 * punto entero de guardarla.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const limpioError = (e: unknown): string =>
  (e instanceof Error ? e.message : 'Error inesperado').replace(/^.*ERROR:\s*/, '')

/** `Date` a `YYYY-MM-DD` por componentes locales: toISOString() se va un dia en UTC-4. */
function isoLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/** `202609` a "septiembre de 2026", para que el error nombre el mes. */
function legible(periodo: string): string {
  return new Date(`${periodo.slice(0, 4)}-${periodo.slice(4, 6)}-01T12:00:00`).toLocaleDateString(
    'es-DO',
    { month: 'long', year: 'numeric' },
  )
}

type Cierre =
  | { estado: 'cerrada' }
  | { estado: 'duplicada' }
  | { estado: 'falta'; periodo: string }
  | { estado: 'escondidas'; modulos: string[]; documentos: number }

/** Como se llama cada modulo para quien declara, no su id. */
const NOMBRE_MODULO: Record<string, string> = {
  ar: 'Cuentas por cobrar',
  pos: 'Punto de venta',
}

/**
 * Cierra el IT-1 de un periodo.
 *
 * Lo que el formulario manda NO se usa para los montos que la base ya
 * sabe: el ITBIS cobrado y el adelantado se vuelven a sumar aqui, bajo
 * RLS, contra dgii_607 y dgii_606. Un formulario es un campo de texto que
 * cualquiera edita, y esto es lo que se le declara a la DGII. Lo unico que
 * viene de afuera es el ITBIS que me retuvieron -ese dato no existe en
 * ninguna tabla del repo- y la nota.
 */
export async function cerrarLiquidacion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'taxes', 'taxes.filing.close')
  if (!permiso.ok) return permiso

  const period = String(fd.get('period') ?? '').trim()
  if (!/^[0-9]{6}$/.test(period)) return { ok: false, error: 'El periodo va como AAAAMM.' }

  // El riesgo mas serio del modulo: las ventas viven bajo la RLS de DOS
  // modulos -la factura a credito (`ar`) y el ticket de caja (`pos`)-. Con
  // uno apagado su mitad suma CERO y el IT-1 sale corto pareciendo
  // correcto. Declarar de menos por un modulo apagado es una multa.
  //
  // Hasta la 0129 esto se evitaba exigiendo `ar`, y un colmado que solo
  // vende en mostrador no podia declarar nunca. La pregunta correcta no es
  // "tienes `ar`" sino "hay ventas de este periodo que no ves", y la
  // responde la base (ventas_fuera_de_vista) justo antes de sumar. Con
  // `ap` apagado si se deja cerrar -faltaria el ITBIS adelantado y se
  // declararia de MAS, que cuesta dinero pero no una sancion-, y la
  // pantalla lo avisa.
  const retenido = Number(String(fd.get('itbisWithheld') ?? '0').replace(/,/g, '') || '0')
  if (!Number.isFinite(retenido) || retenido < 0) {
    return { ok: false, error: 'El ITBIS que te retuvieron no puede ser negativo.' }
  }
  const notes = String(fd.get('notes') ?? '').trim()
  const receipt = String(fd.get('receiptNumber') ?? '').trim()

  const veCompras = exigir(ctx, 'ap', 'ap.view').ok

  const vence =
    calendarioFiscal(period, new Date()).find((o) => o.form === 'IT-1')?.vence ?? new Date()

  try {
    const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx): Promise<Cierre> => {
      const [ya] = await tx<{ id: string }[]>`
        select id from public.tax_filings
        where tenant_id = ${ctx.tenantId} and form = 'IT-1' and period = ${period}`
      if (ya) return { estado: 'duplicada' }

      const ocultas = await tx<{ modulo: string; documentos: string }[]>`
        select modulo, documentos::text from public.ventas_fuera_de_vista(${period})`
      if (ocultas.length > 0) {
        return {
          estado: 'escondidas',
          modulos: ocultas.map((o) => NOMBRE_MODULO[o.modulo] ?? o.modulo),
          documentos: ocultas.reduce((s, o) => s + Number(o.documentos), 0),
        }
      }

      // Las notas de credito (B04) vienen en el 607 con montos POSITIVOS,
      // como los pide el formato; aqui RESTAN: el ITBIS de lo devuelto no
      // se cobro (0130). Sin esto el IT-1 cobraba ITBIS de mercancia que
      // volvio al almacen.
      const [ventas] = await tx<{ t: string }[]>`
        select coalesce(sum(case when origen = 'nota_credito' then -itbis_facturado
                                 else itbis_facturado end), 0)::text as t
        from public.dgii_607
        where tenant_id = ${ctx.tenantId} and periodo = ${period}`

      // El 607 declara COMPROBANTES y el IT-1 declara OPERACIONES: no son
      // la misma suma. La vista filtra `ncf is not null`, y el POS deja
      // vender sin NCF a proposito -un colmado que recien abre vende antes
      // de que la DGII le autorice el primer rango, pos/actions.ts-. Ese
      // ITBIS se le cobro al cliente igual, asi que entra en la
      // declaracion; si no, el primer periodo del colmado se declara de
      // menos en silencio, que es la multa que este modulo dice evitar.
      const [sinNcf] = await tx<{ t: string }[]>`
        select coalesce(sum(t), 0)::text as t
        from (
          select coalesce(sum(i.tax), 0) as t
          from public.customer_invoices i
          where i.tenant_id = ${ctx.tenantId} and i.ncf is null and i.status <> 'void'
            and to_char(i.issue_date, 'YYYYMM') = ${period}
          union all
          -- El dia de la VENTA en RD, igual que el 607 (0129): con
          -- created_at en UTC, la venta del 30 a las 9 p. m. -o una
          -- offline que sincronizo al otro dia- caia en el mes siguiente.
          select coalesce(sum(s.tax), 0)
          from public.pos_sales s
          where s.tenant_id = ${ctx.tenantId} and s.ncf is null and not s.voided
            and to_char(public.fecha_fiscal(s.sold_at), 'YYYYMM') = ${period}
          union all
          -- Una nota de credito sobre una factura SIN NCF no va al 607 (no
          -- hay comprobante que modificar), pero su ITBIS tambien se
          -- devolvio: resta igual que la venta sin NCF suma (0130).
          select -coalesce(sum(n.tax), 0)
          from public.customer_credit_notes n
          where n.tenant_id = ${ctx.tenantId} and n.ncf is null
            and to_char(n.issue_date, 'YYYYMM') = ${period}
        ) q`

      // Del 606 salen DOS numeros, no uno, y tiran para lados
      // contrarios: el ITBIS facturado por el proveedor (que me acredito)
      // y el que yo le retuve de ese mismo ITBIS (que le debo a la DGII).
      //
      // Cobrarse solo el primero es el error que hace que el IT-1 cuadre
      // consigo mismo y aun asi salga corto: me acredito el 100% de un
      // ITBIS que solo pague en parte, y la parte que retuve no aparece
      // en ningun renglon.
      //
      // `itbis_retenido` y NO la retencion total: el ISR que le retuve al
      // proveedor (`retencion_renta`) se paga en el IR-17, no en el IT-1.
      // Hasta la 0129 /pagar guardaba toda la retencion en un solo campo y
      // la vista la leia como ITBIS: honorarios con 800 de ISR retenido
      // hacian que el IT-1 cobrara 800 de un ITBIS que no existia.
      const compras = veCompras
        ? await tx<{ t: string; r: string }[]>`
            select coalesce(sum(itbis_facturado), 0)::text as t,
                   coalesce(sum(itbis_retenido), 0)::text as r
            from public.dgii_606
            where tenant_id = ${ctx.tenantId} and periodo = ${period}`
        : []

      // La ULTIMA declaracion anterior, no "la que toque": con ella
      // creditoArrastrado() decide si es el eslabon inmediato o si hay un
      // hueco en la cadena. Antes se tomaba su credit_forward sin mirar el
      // periodo, y el mismo saldo a favor se consumia dos veces cuando los
      // meses se cerraban salteados.
      const anteriores = await tx<{ period: string; credit_forward: string }[]>`
        select period, credit_forward::text
        from public.tax_filings
        where tenant_id = ${ctx.tenantId} and form = 'IT-1' and period < ${period}
          and status <> 'pending'
        order by period desc limit 1`

      const saldo = creditoArrastrado(
        period,
        anteriores.map((a) => ({ period: a.period, creditForward: Number(a.credit_forward) })),
      )
      if (saldo.faltaCerrar !== null) return { estado: 'falta', periodo: saldo.faltaCerrar }

      const itbisCharged = Number(ventas?.t ?? 0) + Number(sinNcf?.t ?? 0)
      const itbisPaid = Number(compras[0]?.t ?? 0)
      const itbisRetained = Number(compras[0]?.r ?? 0)
      const previousCredit = saldo.previousCredit
      const { amountDue, creditForward } = liquidarItbis({
        itbisCharged,
        itbisPaid,
        itbisWithheld: retenido,
        itbisRetainedFromSuppliers: itbisRetained,
        previousCredit,
      })

      // Por `registrar_declaracion()` y no por un INSERT: desde la 0116 el
      // insert directo sobre tax_filings esta revocado. Cerrar el update y
      // el delete sin cerrar el insert dejaba FABRICAR una declaracion con
      // un saldo a favor inventado —y el trigger de inmutabilidad la
      // congelaba—. La funcion es la unica puerta, y es la que mira el
      // permiso: la politica de RLS solo mira tenant y modulo.
      await tx`
        select public.registrar_declaracion(
          'IT-1', ${period}, ${isoLocal(vence)}::date,
          ${itbisCharged}, ${itbisPaid}, ${retenido}, ${itbisRetained},
          ${previousCredit}, ${amountDue}, ${creditForward},
          ${receipt || null}, ${notes || null})`

      await tx`
        select public.emit_event('taxes.filing.closed',
          ${JSON.stringify({ form: 'IT-1', period, amountDue, creditForward })}::text::jsonb,
          'taxes')`

      return { estado: 'cerrada' }
    })

    if (resultado.estado === 'duplicada') {
      return {
        ok: false,
        error:
          'Ese periodo ya esta cerrado. Una declaracion cerrada no se recalcula: se corrige con una rectificativa.',
      }
    }
    if (resultado.estado === 'escondidas') {
      return {
        ok: false,
        error: `Hay ${resultado.documentos} venta(s) de ${legible(period)} en un modulo que esta apagado (${resultado.modulos.join(', ')}): el IT-1 saldria corto, y declarar de menos es una multa. Enciendelo antes de cerrar.`,
      }
    }
    if (resultado.estado === 'falta') {
      // Misma negativa asimetrica que con `ar` apagado: mejor no cerrar
      // que cerrar con un saldo a favor que ya se consumio en otro mes.
      return {
        ok: false,
        error: `Falta cerrar ${legible(resultado.periodo)}: el saldo a favor se arrastra en cadena, un mes a la vez. Cierra ese periodo primero y despues este.`,
      }
    }
  } catch (e) {
    return { ok: false, error: limpioError(e) }
  }

  revalidatePath('/impuestos/liquidacion')
  revalidatePath('/impuestos/calendario')
  return { ok: true }
}

/** Marca como pagada una declaracion ya presentada. */
export async function marcarPagada(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'taxes', 'taxes.filing.close')
  if (!permiso.ok) return permiso

  const id = String(fd.get('id') ?? '')
  if (!id) return { ok: false, error: 'Falta la declaracion.' }
  const receipt = String(fd.get('receiptNumber') ?? '').trim()

  try {
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx`
        update public.tax_filings
        set status = 'paid',
            receipt_number = coalesce(${receipt || null}, receipt_number)
        where id = ${id} and tenant_id = ${ctx.tenantId} and status = 'filed'`,
    )
  } catch (e) {
    return { ok: false, error: limpioError(e) }
  }

  revalidatePath('/impuestos/liquidacion')
  revalidatePath('/impuestos/calendario')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function cerrarLiquidacionForm(fd: FormData): Promise<void> {
  await anotarAviso(await cerrarLiquidacion(fd), 'cerrarLiquidacion')
}
export async function marcarPagadaForm(fd: FormData): Promise<void> {
  await anotarAviso(await marcarPagada(fd), 'marcarPagada')
}
