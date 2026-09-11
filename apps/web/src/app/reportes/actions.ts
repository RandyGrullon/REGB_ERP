'use server'

import { revalidatePath } from 'next/cache'
import { fuenteValida, proximaEjecucion, type FrecuenciaExportacion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de BI & Reportes (modulo 87, F9/S61-62).
 *
 * `fuenteValida()` es la unica puerta de entrada: si el `source_key`
 * no esta en el catalogo fijo, la accion se rechaza antes de tocar la
 * base -la tabla ademas lo respalda con su propio `check`-.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function crearReporte(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bi', 'bi.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const sourceKey = String(fd.get('sourceKey') ?? '')
  const chartType = String(fd.get('chartType') ?? 'table')
  const days = String(fd.get('days') ?? '').trim()
  const limit = String(fd.get('limit') ?? '').trim()

  if (!name) return { ok: false, error: 'Falta el nombre del reporte.' }
  if (!fuenteValida(sourceKey)) return { ok: false, error: 'Elige una fuente valida.' }
  if (!['table', 'bar', 'line'].includes(chartType)) return { ok: false, error: 'Elige un tipo de grafico valido.' }

  const params: Record<string, number> = {}
  if (days) params.days = Number(days)
  if (limit) params.limit = Number(limit)

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.report_definitions (tenant_id, name, source_key, params, chart_type, created_by)
    values (${ctx.tenantId}, ${name}, ${sourceKey}, ${JSON.stringify(params)}::text::jsonb, ${chartType}, ${ctx.userId})`)

  revalidatePath('/reportes')
  return { ok: true }
}

export async function crearDashboard(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bi', 'bi.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  if (!name) return { ok: false, error: 'Falta el nombre del dashboard.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.dashboards (tenant_id, name, created_by) values (${ctx.tenantId}, ${name}, ${ctx.userId})`)

  revalidatePath('/reportes')
  return { ok: true }
}

export async function agregarItemDashboard(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bi', 'bi.manage')
  if (!permiso.ok) return permiso

  const dashboardId = String(fd.get('dashboardId') ?? '')
  const reportId = String(fd.get('reportId') ?? '')
  if (!dashboardId) return { ok: false, error: 'Elige el dashboard.' }
  if (!reportId) return { ok: false, error: 'Elige el reporte.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [n] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.dashboard_items where dashboard_id = ${dashboardId}`
    await tx`
      insert into public.dashboard_items (tenant_id, dashboard_id, report_id, position)
      values (${ctx.tenantId}, ${dashboardId}, ${reportId}, ${Number(n!.n)})`
  })

  revalidatePath('/reportes')
  return { ok: true }
}

export async function crearExport(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bi', 'bi.manage')
  if (!permiso.ok) return permiso

  const reportId = String(fd.get('reportId') ?? '')
  const frequency = String(fd.get('frequency') ?? '') as FrecuenciaExportacion
  const recipients = String(fd.get('recipients') ?? '').trim()

  if (!reportId) return { ok: false, error: 'Elige el reporte.' }
  if (!['daily', 'weekly', 'monthly'].includes(frequency)) return { ok: false, error: 'Elige una frecuencia valida.' }
  if (!recipients) return { ok: false, error: 'Falta al menos un destinatario.' }

  const proxima = proximaEjecucion(new Date(), frequency)

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.scheduled_exports (tenant_id, report_id, frequency, recipients, next_run_at)
    values (${ctx.tenantId}, ${reportId}, ${frequency}, ${recipients}, ${proxima.toISOString()})`)

  revalidatePath('/reportes')
  return { ok: true }
}

/** Simula la ejecucion -registra la fecha y calcula la proxima-, no manda el correo de verdad. */
export async function ejecutarExportAhora(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bi', 'bi.manage')
  if (!permiso.ok) return permiso

  const exportId = String(fd.get('exportId') ?? '')

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [e] = await tx<{ frequency: FrecuenciaExportacion }[]>`
      select frequency from public.scheduled_exports where id = ${exportId} and tenant_id = ${ctx.tenantId} for update`
    if (!e) return 'no-existe'

    const ahora = new Date()
    const proxima = proximaEjecucion(ahora, e.frequency)

    await tx`
      update public.scheduled_exports
      set last_run_at = ${ahora.toISOString()}, next_run_at = ${proxima.toISOString()}
      where id = ${exportId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('bi.export.executed',
        ${JSON.stringify({ exportId })}::text::jsonb, 'bi')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese export no existe.' }

  revalidatePath('/reportes')
  return { ok: true }
}

export async function alternarExport(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'bi', 'bi.manage')
  if (!permiso.ok) return permiso

  const exportId = String(fd.get('exportId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '')
  if (!['active', 'paused'].includes(siguiente)) return { ok: false, error: 'Estado invalido.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    update public.scheduled_exports set status = ${siguiente} where id = ${exportId} and tenant_id = ${ctx.tenantId}`)

  revalidatePath('/reportes')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearReporteForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearReporte(fd), 'crearReporte')
}
export async function crearDashboardForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearDashboard(fd), 'crearDashboard')
}
export async function agregarItemDashboardForm(fd: FormData): Promise<void> {
  await anotarAviso(await agregarItemDashboard(fd), 'agregarItemDashboard')
}
export async function crearExportForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearExport(fd), 'crearExport')
}
export async function ejecutarExportAhoraForm(fd: FormData): Promise<void> {
  await anotarAviso(await ejecutarExportAhora(fd), 'ejecutarExportAhora')
}
export async function alternarExportForm(fd: FormData): Promise<void> {
  await anotarAviso(await alternarExport(fd), 'alternarExport')
}
