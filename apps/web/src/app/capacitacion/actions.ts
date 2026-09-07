'use server'

import { revalidatePath } from 'next/cache'
import { aproboEvaluacion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de capacitacion (modulo 67, F7/S42).
 *
 * Si una nota aprueba se calcula aqui, con aproboEvaluacion()
 * (@regb/operations) contra el minimo REAL de ese curso -nunca un 70%
 * fijo para todos, y nunca decidido en SQL-.
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

/** Crea un curso nuevo. */
export async function crearCurso(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'training', 'training.manage-courses')
  if (!permiso.ok) return permiso

  const title = String(fd.get('title') ?? '').trim()
  const description = String(fd.get('description') ?? '').trim() || null
  const durationHours = num(String(fd.get('durationHours') ?? ''))
  const passingScore = Number.parseInt(String(fd.get('passingScore') ?? '70'), 10)

  if (!title) return { ok: false, error: 'Escribe el titulo del curso.' }
  if (!Number.isInteger(passingScore) || passingScore < 0 || passingScore > 100) {
    return { ok: false, error: 'El minimo para aprobar debe estar entre 0 y 100.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.training_courses (tenant_id, title, description, duration_hours, passing_score)
      values (${ctx.tenantId}, ${title}, ${description}, ${durationHours}, ${passingScore})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/capacitacion')
  return { ok: true }
}

/** Inscribe a un empleado en un curso. */
export async function inscribirEmpleado(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'training', 'training.manage-enrollments')
  if (!permiso.ok) return permiso

  const courseId = String(fd.get('courseId') ?? '')
  const employeeId = String(fd.get('employeeId') ?? '')
  if (!courseId) return { ok: false, error: 'Falta el curso.' }
  if (!employeeId) return { ok: false, error: 'Elige el empleado.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.training_enrollments (tenant_id, course_id, employee_id)
      values (${ctx.tenantId}, ${courseId}, ${employeeId})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/capacitacion')
  return { ok: true }
}

/** Registra la nota final de una inscripcion -aprueba o no, contra el minimo real del curso-. */
export async function registrarNota(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'training', 'training.manage-enrollments')
  if (!permiso.ok) return permiso

  const enrollmentId = String(fd.get('enrollmentId') ?? '')
  const score = num(String(fd.get('score') ?? ''))
  if (!enrollmentId) return { ok: false, error: 'Falta la inscripcion.' }
  if (score === null || score < 0 || score > 100) return { ok: false, error: 'La nota debe estar entre 0 y 100.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [row] = await tx<{ status: string; passing_score: number }[]>`
        select e.status, c.passing_score
        from public.training_enrollments e
        join public.training_courses c on c.id = e.course_id
        where e.id = ${enrollmentId} and e.tenant_id = ${ctx.tenantId}`
      if (!row) throw new Error('Esa inscripcion no existe.')
      if (row.status !== 'enrolled') throw new Error('Esa inscripcion ya fue resuelta.')

      const status = aproboEvaluacion(score, row.passing_score) ? 'completed' : 'failed'
      await tx`
        update public.training_enrollments
        set status = ${status}, score = ${score}, completed_at = now(), updated_at = now()
        where id = ${enrollmentId} and tenant_id = ${ctx.tenantId}`

      if (status === 'completed') {
        await tx`
          select public.emit_event('training.enrollment.completed',
            ${JSON.stringify({ enrollmentId, score })}::text::jsonb, 'training')`
      }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/capacitacion')
  return { ok: true }
}

/** Emite un certificado para una inscripcion ya completada -queda fijo desde que se emite-. */
export async function emitirCertificado(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'training', 'training.manage-enrollments')
  if (!permiso.ok) return permiso

  const enrollmentId = String(fd.get('enrollmentId') ?? '')
  const expiresAtRaw = String(fd.get('expiresAt') ?? '') || null
  if (!enrollmentId) return { ok: false, error: 'Falta la inscripcion.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [row] = await tx<{ status: string }[]>`
        select status from public.training_enrollments where id = ${enrollmentId} and tenant_id = ${ctx.tenantId}`
      if (!row) throw new Error('Esa inscripcion no existe.')
      if (row.status !== 'completed') throw new Error('Solo se emite certificado a una inscripcion completada.')

      await tx`
        insert into public.training_certificates (tenant_id, enrollment_id, expires_at)
        values (${ctx.tenantId}, ${enrollmentId}, ${expiresAtRaw})`

      await tx`
        select public.emit_event('training.certificate.issued',
          ${JSON.stringify({ enrollmentId })}::text::jsonb, 'training')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/capacitacion')
  return { ok: true }
}

/** Crea una competencia nueva -para la matriz-. */
export async function crearCompetencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'training', 'training.manage-competencies')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const description = String(fd.get('description') ?? '').trim() || null
  if (!name) return { ok: false, error: 'Escribe el nombre de la competencia.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.training_competencies (tenant_id, name, description)
      values (${ctx.tenantId}, ${name}, ${description})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/capacitacion')
  return { ok: true }
}

/** Asigna -o actualiza- el nivel de un empleado en una competencia. */
export async function asignarNivelCompetencia(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'training', 'training.manage-competencies')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const competencyId = String(fd.get('competencyId') ?? '')
  const level = Number.parseInt(String(fd.get('level') ?? ''), 10)

  if (!employeeId) return { ok: false, error: 'Elige el empleado.' }
  if (!competencyId) return { ok: false, error: 'Elige la competencia.' }
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return { ok: false, error: 'El nivel debe ser un numero de 1 a 5.' }
  }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) => tx`
      insert into public.training_employee_competencies (tenant_id, employee_id, competency_id, level)
      values (${ctx.tenantId}, ${employeeId}, ${competencyId}, ${level})
      on conflict (tenant_id, employee_id, competency_id)
      do update set level = excluded.level, assessed_at = now()`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/capacitacion')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function crearCursoForm(fd: FormData): Promise<void> {
  await crearCurso(fd)
}
export async function inscribirEmpleadoForm(fd: FormData): Promise<void> {
  await inscribirEmpleado(fd)
}
export async function registrarNotaForm(fd: FormData): Promise<void> {
  await registrarNota(fd)
}
export async function emitirCertificadoForm(fd: FormData): Promise<void> {
  await emitirCertificado(fd)
}
export async function crearCompetenciaForm(fd: FormData): Promise<void> {
  await crearCompetencia(fd)
}
export async function asignarNivelCompetenciaForm(fd: FormData): Promise<void> {
  await asignarNivelCompetencia(fd)
}
