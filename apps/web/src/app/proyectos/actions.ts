'use server'

import { revalidatePath } from 'next/cache'
import {
  puedeAvanzarPorDependencias,
  transicionValidaProyecto,
  transicionValidaTarea,
  type EstadoProyecto,
  type EstadoTarea,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de Proyectos & Tareas (modulo 71, F10/S67).
 *
 * `transicionarTarea()` comprueba `puedeAvanzarPorDependencias()`
 * ANTES de intentar el update -la misma regla que ya aplica el
 * trigger `no_avance_con_dependencias_abiertas` a nivel de base de
 * datos-. Precomprobar aqui evita que un error de Postgres deje la
 * transaccion abortada a mitad de camino; el trigger sigue siendo la
 * garantia real, esto solo evita disparar la excepcion en el flujo
 * normal.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

export async function crearProyecto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'projects', 'projects.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const description = String(fd.get('description') ?? '').trim() || null
  const startDate = String(fd.get('startDate') ?? '') || null
  const endDate = String(fd.get('endDate') ?? '') || null

  if (!name) return { ok: false, error: 'Falta el nombre del proyecto.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.projects (tenant_id, name, description, start_date, end_date, created_by)
    values (${ctx.tenantId}, ${name}, ${description}, ${startDate}, ${endDate}, ${ctx.userId})`,
  )

  revalidatePath('/proyectos')
  return { ok: true }
}

export async function transicionarProyecto(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'projects', 'projects.manage')
  if (!permiso.ok) return permiso

  const projectId = String(fd.get('projectId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoProyecto

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [p] = await tx<{ status: EstadoProyecto }[]>`
      select status from public.projects where id = ${projectId} and tenant_id = ${ctx.tenantId} for update`
    if (!p) return 'no-existe'
    if (!transicionValidaProyecto(p.status, siguiente)) return 'Esa transicion no esta permitida.'

    await tx`update public.projects set status = ${siguiente}, updated_at = now() where id = ${projectId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Ese proyecto no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/proyectos/${projectId}`)
  revalidatePath('/proyectos')
  return { ok: true }
}

export async function crearTarea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'projects', 'projects.manage')
  if (!permiso.ok) return permiso

  const projectId = String(fd.get('projectId') ?? '')
  const name = String(fd.get('name') ?? '').trim()
  const dueDate = String(fd.get('dueDate') ?? '') || null

  if (!name) return { ok: false, error: 'Falta el nombre de la tarea.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.project_tasks (tenant_id, project_id, name, due_date)
    values (${ctx.tenantId}, ${projectId}, ${name}, ${dueDate})`,
  )

  revalidatePath(`/proyectos/${projectId}`)
  return { ok: true }
}

/** Puede fallar de verdad si la tarea tiene dependencias sin terminar -el trigger lo impide, no solo esta accion-. */
export async function transicionarTarea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'projects', 'projects.manage')
  if (!permiso.ok) return permiso

  const taskId = String(fd.get('taskId') ?? '')
  const projectId = String(fd.get('projectId') ?? '')
  const siguiente = String(fd.get('siguiente') ?? '') as EstadoTarea

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [t] = await tx<{ status: EstadoTarea }[]>`
      select status from public.project_tasks where id = ${taskId} and tenant_id = ${ctx.tenantId} for update`
    if (!t) return 'no-existe'
    if (!transicionValidaTarea(t.status, siguiente)) return 'Esa transicion no esta permitida.'

    const dependencias = await tx<{ status: EstadoTarea }[]>`
      select pt.status from public.task_dependencies td
      join public.project_tasks pt on pt.id = td.depends_on_task_id
      where td.task_id = ${taskId}`
    if (
      !puedeAvanzarPorDependencias(
        dependencias.map((d) => d.status),
        siguiente,
      )
    ) {
      return 'Esa tarea tiene una o mas dependencias sin terminar.'
    }

    await tx`update public.project_tasks set status = ${siguiente}, updated_at = now() where id = ${taskId} and tenant_id = ${ctx.tenantId}`
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa tarea no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/proyectos/${projectId}`)
  return { ok: true }
}

export async function agregarDependencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'projects', 'projects.manage')
  if (!permiso.ok) return permiso

  const taskId = String(fd.get('taskId') ?? '')
  const dependsOnTaskId = String(fd.get('dependsOnTaskId') ?? '')
  const projectId = String(fd.get('projectId') ?? '')

  if (!dependsOnTaskId) return { ok: false, error: 'Elige de que tarea depende.' }
  if (taskId === dependsOnTaskId)
    return { ok: false, error: 'Una tarea no puede depender de si misma.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.task_dependencies (tenant_id, task_id, depends_on_task_id)
    values (${ctx.tenantId}, ${taskId}, ${dependsOnTaskId})
    on conflict do nothing`,
  )

  revalidatePath(`/proyectos/${projectId}`)
  return { ok: true }
}

export async function crearHito(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'projects', 'projects.manage')
  if (!permiso.ok) return permiso

  const projectId = String(fd.get('projectId') ?? '')
  const name = String(fd.get('name') ?? '').trim()
  const dueDate = String(fd.get('dueDate') ?? '')

  if (!name) return { ok: false, error: 'Falta el nombre del hito.' }
  if (!dueDate) return { ok: false, error: 'Falta la fecha del hito.' }

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    insert into public.project_milestones (tenant_id, project_id, name, due_date)
    values (${ctx.tenantId}, ${projectId}, ${name}, ${dueDate})`,
  )

  revalidatePath(`/proyectos/${projectId}`)
  return { ok: true }
}

export async function completarHito(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'projects', 'projects.manage')
  if (!permiso.ok) return permiso

  const milestoneId = String(fd.get('milestoneId') ?? '')
  const projectId = String(fd.get('projectId') ?? '')

  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
    update public.project_milestones set completed_at = now()
    where id = ${milestoneId} and tenant_id = ${ctx.tenantId} and completed_at is null`,
  )

  revalidatePath(`/proyectos/${projectId}`)
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearProyectoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearProyecto(fd), 'crearProyecto')
}
export async function transicionarProyectoForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarProyecto(fd), 'transicionarProyecto')
}
export async function crearTareaForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearTarea(fd), 'crearTarea')
}
export async function transicionarTareaForm(fd: FormData): Promise<void> {
  await anotarAviso(await transicionarTarea(fd), 'transicionarTarea')
}
export async function agregarDependenciaForm(fd: FormData): Promise<void> {
  await anotarAviso(await agregarDependencia(fd), 'agregarDependencia')
}
export async function crearHitoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearHito(fd), 'crearHito')
}
export async function completarHitoForm(fd: FormData): Promise<void> {
  await anotarAviso(await completarHito(fd), 'completarHito')
}
