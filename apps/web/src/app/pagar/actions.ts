'use server'

import { revalidatePath } from 'next/cache'
import {
  TIPOS_RETENCION_ISR_606,
  balanceAfter,
  deriveInvoiceStatus,
  dueDateFrom,
  esTipoGasto606,
  fechaFiscal,
  overpayment,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de cuentas por pagar (modulo 18, F6/S30).
 *
 * El contraparte de ar/actions.ts, con la flecha al reves: el proveedor
 * nos factura a NOSOTROS. Reusa la logica pura de @regb/operations que ya
 * era generica -deriveInvoiceStatus, balanceAfter, overpayment,
 * dueDateFrom- sin duplicar una linea: la formula de "saldo tras pagos" es
 * la misma independientemente de quien le debe a quien.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const num = (raw: string): number | null => {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Lo que la DGII pide de una compra y que no se puede adivinar despues.
 *
 * Hasta la 0129 el formulario no lo pedia: la factura entraba sin tipo de
 * gasto (el TXT del 606 respondia 409 y no habia donde clasificarla), con
 * la fecha de HOY aunque el proveedor la emitiera el mes pasado, y con la
 * retencion en UN campo que la vista leia entera como ITBIS -el ISR que se
 * le retiene a un profesional terminaba sumado al IT-1-.
 */
interface DatosFiscales {
  expenseType: string | null
  services: number
  isrRetained: number
  isrType: string | null
  modifiedNcf: string | null
}

/** NCF de proveedor: serie B con 8 digitos o e-CF con 10. B11 y B13 incluidos. */
const NCF_PROVEEDOR = /^(B\d{2}\d{8}|E\d{2}\d{10})$/

function leerDatosFiscales(fd: FormData): DatosFiscales | { error: string } {
  const expenseType = String(fd.get('expenseType') ?? '').trim() || null
  const services = num(String(fd.get('servicesAmount') ?? '0')) ?? 0
  const isrRetained = num(String(fd.get('isrRetention') ?? '0')) ?? 0
  const isrType = String(fd.get('isrRetentionType') ?? '').trim() || null
  const modifiedNcf =
    String(fd.get('modifiedNcf') ?? '')
      .trim()
      .toUpperCase() || null

  if (expenseType !== null && !esTipoGasto606(expenseType)) {
    return { error: 'El tipo de gasto va del 01 al 11 (clasificacion del 606).' }
  }
  if (services < 0) return { error: 'La parte de servicios no puede ser negativa.' }
  if (isrRetained < 0) return { error: 'El ISR retenido no puede ser negativo.' }
  if (isrRetained > 0 && (isrType === null || !TIPOS_RETENCION_ISR_606[isrType])) {
    return {
      error: 'Di de que tipo es la retencion de ISR (01-09): sin eso el 606 no la puede declarar.',
    }
  }
  if (modifiedNcf !== null && !NCF_PROVEEDOR.test(modifiedNcf)) {
    return { error: 'El NCF modificado no tiene forma de NCF.' }
  }
  return {
    expenseType,
    services,
    isrRetained,
    isrType: isrRetained > 0 ? isrType : null,
    modifiedNcf,
  }
}

/** Registra la factura que el proveedor ya nos entrego. */
export async function registrarFactura(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ap', 'ap.invoice.create')
  if (!permiso.ok) return permiso

  const supplierId = String(fd.get('supplierId') ?? '')
  const supplierInvoiceNumber = String(fd.get('supplierInvoiceNumber') ?? '').trim()
  const supplierNcf =
    String(fd.get('supplierNcf') ?? '')
      .trim()
      .toUpperCase() || null
  const subtotal = num(String(fd.get('subtotal') ?? ''))
  const tax = num(String(fd.get('tax') ?? '0')) ?? 0
  // ITBIS e ISR retenidos van SEPARADOS: se declaran en columnas distintas
  // del 606 y solo el ITBIS entra al IT-1 (el ISR va al IR-17). El campo
  // viejo `retention` se sigue aceptando como ITBIS para no romper a quien
  // mande el formulario anterior -era lo que la vista suponia-.
  const itbisRetenido = num(String(fd.get('itbisRetention') ?? fd.get('retention') ?? '0')) ?? 0
  // La fecha que trae la factura, no la de hoy: una factura de agosto
  // registrada el 3 de septiembre es del 606 de agosto. Sin fecha, hoy EN
  // RD -no el dia de UTC-.
  const fechaEmision = String(fd.get('issueDate') ?? '').trim() || fechaFiscal(new Date())
  const fiscales = leerDatosFiscales(fd)

  if (!supplierId) return { ok: false, error: 'Elige el proveedor.' }
  if (supplierInvoiceNumber.length < 1) {
    return { ok: false, error: 'Escribe el numero de la factura del proveedor.' }
  }
  if (supplierNcf !== null && !NCF_PROVEEDOR.test(supplierNcf)) {
    return { ok: false, error: 'El NCF del proveedor no tiene forma de NCF (ej. B0100001234).' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaEmision)) {
    return { ok: false, error: 'La fecha de emision no es valida.' }
  }
  if (fechaEmision > fechaFiscal(new Date())) {
    return { ok: false, error: 'La factura no puede ser de una fecha que todavia no llega.' }
  }
  if (subtotal === null || subtotal < 0) return { ok: false, error: 'El subtotal no es valido.' }
  if (tax < 0) return { ok: false, error: 'El ITBIS no puede ser negativo.' }
  if (itbisRetenido < 0) return { ok: false, error: 'El ITBIS retenido no puede ser negativo.' }
  if ('error' in fiscales) return { ok: false, error: fiscales.error }
  if (supplierNcf !== null && fiscales.expenseType === null) {
    return {
      ok: false,
      error:
        'Elige el tipo de gasto: con NCF, la compra va al 606 y la DGII pide su clasificacion.',
    }
  }
  if (itbisRetenido > tax) {
    return { ok: false, error: 'No se puede retener mas ITBIS del que trae la factura.' }
  }
  if (fiscales.isrRetained > subtotal) {
    return { ok: false, error: 'El ISR retenido no puede pasar del subtotal.' }
  }
  if (fiscales.services > subtotal) {
    return { ok: false, error: 'La parte de servicios no puede pasar del subtotal.' }
  }

  const total = subtotal + tax
  const retencion = itbisRetenido + fiscales.isrRetained
  if (retencion > total) {
    return { ok: false, error: 'La retencion no puede ser mayor que el total de la factura.' }
  }

  try {
    const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [supplier] = await tx<{ payment_terms: number }[]>`
        select payment_terms from public.suppliers
        where id = ${supplierId} and tenant_id = ${ctx.tenantId}`
      if (!supplier) return 'sin-proveedor'

      const emision = new Date(`${fechaEmision}T12:00:00Z`)
      const vence = dueDateFrom(emision, supplier.payment_terms)

      await tx`
        insert into public.supplier_invoices
          (tenant_id, supplier_id, supplier_invoice_number, supplier_ncf, issue_date, due_date,
           subtotal, tax, retention_amount, total, created_by,
           expense_type, services_amount, isr_retained, isr_retention_type, modified_ncf)
        values (${ctx.tenantId}, ${supplierId}, ${supplierInvoiceNumber}, ${supplierNcf},
                ${fechaEmision}, ${vence.toISOString().slice(0, 10)},
                ${subtotal}, ${tax}, ${retencion}, ${total}, ${ctx.userId},
                ${fiscales.expenseType}, ${fiscales.services}, ${fiscales.isrRetained},
                ${fiscales.isrType}, ${fiscales.modifiedNcf})`

      await tx`
        select public.emit_event('ap.invoice.recorded',
          ${JSON.stringify({ supplierId, supplierInvoiceNumber, total })}::text::jsonb, 'ap')`

      return 'ok'
    })

    if (res === 'sin-proveedor') return { ok: false, error: 'Ese proveedor no existe.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key')) {
      return { ok: false, error: 'Ya registraste una factura con ese numero para ese proveedor.' }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/pagar')
  return { ok: true }
}

/**
 * Completa los datos del 606 de una factura ya registrada.
 *
 * Existe por las facturas que entraron antes de que /pagar los pidiera: el
 * TXT del 606 se niega a salir con una sola compra sin clasificar, y no
 * habia pantalla para clasificarla. No toca montos ni el total retenido
 * -ya cuentan en el saldo y en los pagos-: solo dice que parte de esa
 * retencion fue ISR y el resto queda como ITBIS.
 */
export async function clasificarFactura(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ap', 'ap.invoice.create')
  if (!permiso.ok) return permiso

  const invoiceId = String(fd.get('invoiceId') ?? '')
  const fiscales = leerDatosFiscales(fd)
  if (!invoiceId) return { ok: false, error: 'Faltan datos.' }
  if ('error' in fiscales) return { ok: false, error: fiscales.error }
  if (fiscales.expenseType === null) {
    return { ok: false, error: 'Elige el tipo de gasto (01-11).' }
  }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [inv] = await tx<{ subtotal: string; retencion: string; status: string }[]>`
      select subtotal::text, retention_amount::text as retencion, status
      from public.supplier_invoices
      where id = ${invoiceId} and tenant_id = ${ctx.tenantId} for update`
    if (!inv) return 'no-existe'
    if (inv.status === 'void') return 'anulada'
    if (fiscales.services > Number(inv.subtotal)) return 'servicios'
    if (fiscales.isrRetained > Number(inv.retencion)) return 'isr'

    await tx`
      update public.supplier_invoices
      set expense_type       = ${fiscales.expenseType},
          services_amount    = ${fiscales.services},
          isr_retained       = ${fiscales.isrRetained},
          isr_retention_type = ${fiscales.isrType},
          modified_ncf       = ${fiscales.modifiedNcf}
      where id = ${invoiceId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (res === 'no-existe') return { ok: false, error: 'Esa factura no existe.' }
  if (res === 'anulada') return { ok: false, error: 'Esa factura esta anulada: no va al 606.' }
  if (res === 'servicios') {
    return { ok: false, error: 'La parte de servicios no puede pasar del subtotal.' }
  }
  if (res === 'isr') {
    return {
      ok: false,
      error: 'El ISR retenido no puede pasar de lo retenido en total: el resto es ITBIS retenido.',
    }
  }

  revalidatePath('/pagar')
  revalidatePath(`/pagar/${invoiceId}`)
  return { ok: true }
}

/** Registra un pago. Rechaza pagar de mas: un sobrepago silencioso deja la cuenta cuadrando con dinero que no existe. */
export async function registrarPago(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ap', 'ap.payment.record')
  if (!permiso.ok) return permiso

  const invoiceId = String(fd.get('invoiceId') ?? '')
  const monto = num(String(fd.get('amount') ?? ''))
  const metodo = String(fd.get('method') ?? 'transfer')
  const referencia = String(fd.get('reference') ?? '').trim() || null

  if (!invoiceId) return { ok: false, error: 'Faltan datos.' }
  if (monto === null || monto <= 0) return { ok: false, error: 'El monto debe ser positivo.' }
  if (!['cash', 'card', 'transfer', 'check'].includes(metodo)) {
    return { ok: false, error: 'Forma de pago no valida.' }
  }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [inv] = await tx<
      { total: string; retencion: string; status: string; due_date: string }[]
    >`
      select total::text, retention_amount::text as retencion, status, due_date::text
      from public.supplier_invoices
      where id = ${invoiceId} and tenant_id = ${ctx.tenantId} for update`
    if (!inv) return 'no-existe'
    if (inv.status === 'void') return 'anulada'

    const pagos = await tx<{ amount: string }[]>`
      select amount::text from public.supplier_payments
      where invoice_id = ${invoiceId} and tenant_id = ${ctx.tenantId}`
    const previos = pagos.map((p) => Number(p.amount))
    // La retencion ya reduce lo que hay que pagar, se trata como un pago
    // mas para efectos del limite de sobrepago.
    const totalAPagar = Number(inv.total) - Number(inv.retencion)

    const sobra = overpayment(totalAPagar, [...previos, monto])
    if (sobra > 0) {
      const saldo = balanceAfter(totalAPagar, previos)
      return `Solo quedan ${saldo.toFixed(2)} por pagar; se intento pagar ${monto.toFixed(2)}.`
    }

    await tx`
      insert into public.supplier_payments
        (tenant_id, invoice_id, amount, method, reference, paid_by)
      values (${ctx.tenantId}, ${invoiceId}, ${monto}, ${metodo}, ${referencia}, ${ctx.userId})`

    const pagadoTotal = [...previos, monto].reduce((a, n) => a + n, 0)
    const estado = deriveInvoiceStatus(
      totalAPagar,
      pagadoTotal,
      new Date(`${inv.due_date}T12:00:00`),
      new Date(),
    )

    await tx`
      update public.supplier_invoices set status = ${estado}
      where id = ${invoiceId} and tenant_id = ${ctx.tenantId}`

    if (estado === 'paid') {
      await tx`
        select public.emit_event('ap.invoice.paid',
          ${JSON.stringify({ invoiceId })}::text::jsonb, 'ap')`
    }

    return 'ok'
  })

  if (res === 'no-existe') return { ok: false, error: 'Esa factura no existe.' }
  if (res === 'anulada') return { ok: false, error: 'Esa factura esta anulada.' }
  if (res !== 'ok') return { ok: false, error: res }

  revalidatePath('/pagar')
  revalidatePath(`/pagar/${invoiceId}`)
  return { ok: true }
}

/** Anula la factura. Solo si no tiene pagos: si ya se le pago algo, no se anula -se corrige con un ajuste-. */
export async function anularFactura(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ap', 'ap.invoice.void')
  if (!permiso.ok) return permiso

  const invoiceId = String(fd.get('invoiceId') ?? '')
  const motivo = String(fd.get('reason') ?? '').trim()
  if (!invoiceId) return { ok: false, error: 'Faltan datos.' }
  if (motivo.length < 4) return { ok: false, error: 'Escribe el motivo de la anulacion.' }

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [pagado] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.supplier_payments
      where invoice_id = ${invoiceId} and tenant_id = ${ctx.tenantId}`
    if (Number(pagado!.n) > 0) return 'con-pagos'

    await tx`
      update public.supplier_invoices
      set status = 'void', void_reason = ${motivo}
      where id = ${invoiceId} and tenant_id = ${ctx.tenantId} and status <> 'void'`
    return 'ok'
  })

  if (res === 'con-pagos') {
    return {
      ok: false,
      error: 'Esta factura ya tiene pagos registrados. No se anula: corrige con un ajuste aparte.',
    }
  }

  revalidatePath('/pagar')
  return { ok: true }
}

/** Marca vencidas las que pasaron su fecha. Idempotente. */
export async function marcarVencidas(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'ap', 'ap.view')
  if (!permiso.ok) return permiso

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`select public.mark_overdue_supplier_invoices(${ctx.tenantId})`,
  )

  revalidatePath('/pagar')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function registrarFacturaForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarFactura(fd), 'registrarFactura')
}
export async function clasificarFacturaForm(fd: FormData): Promise<void> {
  await anotarAviso(
    await clasificarFactura(fd),
    'clasificarFactura',
    'Listo, la factura ya tiene sus datos del 606.',
  )
}
export async function registrarPagoForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarPago(fd), 'registrarPago', 'Listo, registramos el pago.')
}
export async function anularFacturaForm(fd: FormData): Promise<void> {
  await anotarAviso(await anularFactura(fd), 'anularFactura')
}
export async function marcarVencidasForm(fd: FormData): Promise<void> {
  await anotarAviso(await marcarVencidas(fd), 'marcarVencidas')
}
