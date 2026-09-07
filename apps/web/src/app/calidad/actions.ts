'use server'

import { revalidatePath } from 'next/cache'
import {
  resultadoInspeccion,
  transicionValidaCapa,
  transicionValidaNoConformidad,
  type EstadoCapa,
  type EstadoNoConformidad,
  type ResultadoCriterio,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de control de calidad (modulo 58, F8.5/S53).
 *
 * `resultadoInspeccion()` decide el resultado real: un criterio
 * critico reprobado reprueba la inspeccion entera; uno menor la deja
 * "condicional". Las dos maquinas de estados (no conformidad y CAPA)
 * se validan aqui con `transicionValidaNoConformidad()`/
 * `transicionValidaCapa()` antes de escribir -la base solo congela
 * cada fila una vez llega a un estado terminal-.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function crearPlan(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quality', 'quality.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const scope = String(fd.get('scope') ?? '')
  const productId = String(fd.get('productId') ?? '') || null

  if (!name) return { ok: false, error: 'Ponle un nombre al plan.' }
  if (!['receiving', 'production', 'final', 'other'].includes(scope)) {
    return { ok: false, error: 'Elige un alcance valido.' }
  }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.inspection_plans (tenant_id, name, scope, product_id)
    values (${ctx.tenantId}, ${name}, ${scope}, ${productId})`)

  revalidatePath('/calidad/planes')
  return { ok: true }
}

export async function agregarCriterio(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quality', 'quality.manage')
  if (!permiso.ok) return permiso

  const planId = String(fd.get('planId') ?? '')
  const criterion = String(fd.get('criterion') ?? '').trim()
  const isCritical = fd.get('isCritical') === 'on'

  if (!planId || !criterion) return { ok: false, error: 'Escribe el criterio.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    insert into public.inspection_plan_criteria (plan_id, tenant_id, criterion, is_critical)
    values (${planId}, ${ctx.tenantId}, ${criterion}, ${isCritical})`)

  revalidatePath(`/calidad/planes/${planId}`)
  return { ok: true }
}

export async function quitarCriterio(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quality', 'quality.manage')
  if (!permiso.ok) return permiso

  const planId = String(fd.get('planId') ?? '')
  const criterionId = String(fd.get('criterionId') ?? '')

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    delete from public.inspection_plan_criteria
    where id = ${criterionId} and tenant_id = ${ctx.tenantId}`)

  revalidatePath(`/calidad/planes/${planId}`)
  return { ok: true }
}

export async function alternarPlanActivo(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quality', 'quality.manage')
  if (!permiso.ok) return permiso

  const planId = String(fd.get('planId') ?? '')
  const activo = fd.get('activo') === 'true'

  await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
    update public.inspection_plans set active = ${!activo}, updated_at = now()
    where id = ${planId} and tenant_id = ${ctx.tenantId}`)

  revalidatePath(`/calidad/planes/${planId}`)
  revalidatePath('/calidad/planes')
  return { ok: true }
}

/** Registra una inspeccion real: un pase/falla por cada criterio del plan. */
export async function registrarInspeccion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quality', 'quality.inspect')
  if (!permiso.ok) return permiso

  const planId = String(fd.get('planId') ?? '')
  const productId = String(fd.get('productId') ?? '') || null
  const notes = String(fd.get('notes') ?? '').trim() || null
  if (!planId) return { ok: false, error: 'Elige el plan de inspeccion.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const criterios = await tx<{ id: string; criterion: string; is_critical: boolean }[]>`
      select id, criterion, is_critical from public.inspection_plan_criteria
      where plan_id = ${planId} and tenant_id = ${ctx.tenantId} order by sort_order, criterion`

    const resultados: (ResultadoCriterio & { criterion: string })[] = criterios.map((c) => ({
      criterion: c.criterion,
      esCritico: c.is_critical,
      aprobado: fd.get(`criterio_${c.id}`) === 'pass',
    }))

    const resultado = resultadoInspeccion(resultados)

    const [inspeccion] = await tx<{ id: string }[]>`
      insert into public.inspections (tenant_id, plan_id, product_id, performed_by, result, notes)
      values (${ctx.tenantId}, ${planId}, ${productId}, ${ctx.userId}, ${resultado}, ${notes})
      returning id`

    for (const r of resultados) {
      await tx`
        insert into public.inspection_results (inspection_id, tenant_id, criterion, is_critical, passed)
        values (${inspeccion!.id}, ${ctx.tenantId}, ${r.criterion}, ${r.esCritico}, ${r.aprobado})`
    }

    await tx`
      select public.emit_event('quality.inspection.completed',
        ${JSON.stringify({ inspectionId: inspeccion!.id, result: resultado })}::text::jsonb, 'quality')`

    return inspeccion!.id
  })

  revalidatePath('/calidad')
  return { ok: true }
}

/** Abre una no conformidad, opcionalmente ligada a una inspeccion que la origino. */
export async function abrirNoConformidad(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quality', 'quality.inspect')
  if (!permiso.ok) return permiso

  const description = String(fd.get('description') ?? '').trim()
  const severity = String(fd.get('severity') ?? '')
  const inspectionId = String(fd.get('inspectionId') ?? '') || null

  if (!description) return { ok: false, error: 'Describe la no conformidad.' }
  if (!['minor', 'major', 'critical'].includes(severity)) {
    return { ok: false, error: 'Elige una severidad valida.' }
  }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [nc] = await tx<{ id: string }[]>`
      insert into public.non_conformances (tenant_id, description, severity, inspection_id, detected_by)
      values (${ctx.tenantId}, ${description}, ${severity}, ${inspectionId}, ${ctx.userId})
      returning id`
    await tx`
      select public.emit_event('quality.nonconformance.opened',
        ${JSON.stringify({ nonConformanceId: nc!.id, severity })}::text::jsonb, 'quality')`
  })

  revalidatePath('/calidad/no-conformidades')
  if (inspectionId) revalidatePath(`/calidad/inspecciones/${inspectionId}`)
  return { ok: true }
}

/** Avanza el estado de una no conformidad -open/investigating/dismissed-. */
export async function transicionarNoConformidad(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quality', 'quality.inspect')
  if (!permiso.ok) return permiso

  const ncId = String(fd.get('ncId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoNoConformidad

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [nc] = await tx<{ status: EstadoNoConformidad }[]>`
      select status from public.non_conformances where id = ${ncId} and tenant_id = ${ctx.tenantId} for update`
    if (!nc) return 'no-existe'
    if (!transicionValidaNoConformidad(nc.status, siguiente)) {
      return 'Esa transicion no esta permitida.'
    }
    await tx`
      update public.non_conformances set status = ${siguiente}, updated_at = now()
      where id = ${ncId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa no conformidad no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/calidad/no-conformidades/${ncId}`)
  revalidatePath('/calidad/no-conformidades')
  return { ok: true }
}

/** Crea el CAPA de una no conformidad -la mueve a `capa_created` en el mismo paso-. */
export async function crearCapa(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quality', 'quality.inspect')
  if (!permiso.ok) return permiso

  const ncId = String(fd.get('ncId') ?? '')
  const rootCause = String(fd.get('rootCause') ?? '').trim()
  const correctiveAction = String(fd.get('correctiveAction') ?? '').trim()
  const preventiveAction = String(fd.get('preventiveAction') ?? '').trim() || null
  const dueDate = String(fd.get('dueDate') ?? '') || null

  if (!rootCause || !correctiveAction) {
    return { ok: false, error: 'La causa raiz y la accion correctiva son obligatorias.' }
  }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [nc] = await tx<{ status: EstadoNoConformidad }[]>`
      select status from public.non_conformances where id = ${ncId} and tenant_id = ${ctx.tenantId} for update`
    if (!nc) return 'no-existe'
    if (!transicionValidaNoConformidad(nc.status, 'capa_created')) {
      return 'Esa no conformidad no esta lista para un CAPA -tiene que estar en investigacion-.'
    }

    await tx`
      insert into public.capas (tenant_id, non_conformance_id, root_cause, corrective_action, preventive_action, assigned_to, due_date)
      values (${ctx.tenantId}, ${ncId}, ${rootCause}, ${correctiveAction}, ${preventiveAction}, ${ctx.userId}, ${dueDate})`

    await tx`
      update public.non_conformances set status = 'capa_created', updated_at = now()
      where id = ${ncId} and tenant_id = ${ctx.tenantId}`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa no conformidad no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/calidad/no-conformidades/${ncId}`)
  return { ok: true }
}

/** Avanza el estado de un CAPA -al cerrarlo, cierra tambien su no conformidad-. */
export async function transicionarCapa(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'quality', 'quality.inspect')
  if (!permiso.ok) return permiso

  const capaId = String(fd.get('capaId') ?? '')
  const ncId = String(fd.get('ncId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoCapa

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [capa] = await tx<{ status: EstadoCapa }[]>`
      select status from public.capas where id = ${capaId} and tenant_id = ${ctx.tenantId} for update`
    if (!capa) return 'no-existe'
    if (!transicionValidaCapa(capa.status, siguiente)) {
      return 'Esa transicion no esta permitida.'
    }

    const verificando = siguiente === 'verified'
    await tx`
      update public.capas
      set status = ${siguiente}, updated_at = now(),
          verified_by = case when ${verificando} then ${ctx.userId} else verified_by end,
          verified_at = case when ${verificando} then now() else verified_at end
      where id = ${capaId} and tenant_id = ${ctx.tenantId}`

    if (siguiente === 'closed') {
      await tx`
        update public.non_conformances set status = 'closed', updated_at = now()
        where id = ${ncId} and tenant_id = ${ctx.tenantId}`
      await tx`
        select public.emit_event('quality.capa.closed',
          ${JSON.stringify({ capaId })}::text::jsonb, 'quality')`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese CAPA no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/calidad/no-conformidades/${ncId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearPlanForm(fd: FormData): Promise<void> {
  await crearPlan(fd)
}
export async function agregarCriterioForm(fd: FormData): Promise<void> {
  await agregarCriterio(fd)
}
export async function quitarCriterioForm(fd: FormData): Promise<void> {
  await quitarCriterio(fd)
}
export async function alternarPlanActivoForm(fd: FormData): Promise<void> {
  await alternarPlanActivo(fd)
}
export async function registrarInspeccionForm(fd: FormData): Promise<void> {
  await registrarInspeccion(fd)
}
export async function abrirNoConformidadForm(fd: FormData): Promise<void> {
  await abrirNoConformidad(fd)
}
export async function transicionarNoConformidadForm(fd: FormData): Promise<void> {
  await transicionarNoConformidad(fd)
}
export async function crearCapaForm(fd: FormData): Promise<void> {
  await crearCapa(fd)
}
export async function transicionarCapaForm(fd: FormData): Promise<void> {
  await transicionarCapa(fd)
}
