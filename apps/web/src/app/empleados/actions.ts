'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de empleados (modulo 61, F7/S36).
 *
 * Un cambio de salario o de cargo pasa SIEMPRE por
 * crear_contrato_empleado() (0051): nunca se edita el salario de un
 * empleado directamente, para que el historial de contratos sea real y
 * no una tabla que nadie actualiza.
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

/** Da de alta un empleado, con su primer contrato. */
export async function crearEmpleado(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'employees', 'employees.employee.create')
  if (!permiso.ok) return permiso

  const code = String(fd.get('code') ?? '').trim()
  const firstName = String(fd.get('firstName') ?? '').trim()
  const lastName = String(fd.get('lastName') ?? '').trim()
  const position = String(fd.get('position') ?? '').trim()
  const department = String(fd.get('department') ?? '').trim() || null
  const hireDate = String(fd.get('hireDate') ?? '').trim()
  const salary = num(String(fd.get('salary') ?? ''))
  const managerId = String(fd.get('managerId') ?? '') || null
  const nationalId = String(fd.get('nationalId') ?? '').trim() || null

  if (code.length < 1) return { ok: false, error: 'Escribe el codigo del empleado.' }
  if (firstName.length < 2 || lastName.length < 2) return { ok: false, error: 'Escribe el nombre completo.' }
  if (position.length < 2) return { ok: false, error: 'Escribe el cargo.' }
  if (!hireDate) return { ok: false, error: 'Falta la fecha de ingreso.' }
  if (salary === null || salary < 0) return { ok: false, error: 'El salario no es valido.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      const [emp] = await tx<{ id: string }[]>`
        insert into public.employees
          (tenant_id, code, first_name, last_name, national_id, hire_date, position,
           department, manager_id, salary)
        values (${ctx.tenantId}, ${code}, ${firstName}, ${lastName}, ${nationalId}, ${hireDate},
                ${position}, ${department}, ${managerId}, ${salary})
        returning id`

      await tx`
        insert into public.employee_contracts
          (tenant_id, employee_id, contract_type, start_date, salary, position)
        values (${ctx.tenantId}, ${emp!.id}, 'indefinido', ${hireDate}, ${salary}, ${position})`

      await tx`
        select public.emit_event('employees.employee.created',
          ${JSON.stringify({ code, firstName, lastName })}::text::jsonb, 'employees')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    if (msg.includes('duplicate key')) {
      return { ok: false, error: 'Ya existe un empleado con ese codigo o esa cedula.' }
    }
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/empleados')
  return { ok: true }
}

/** Registra un contrato nuevo -promocion o cambio de salario-. */
export async function crearContrato(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'employees', 'employees.contract.create')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const contractType = String(fd.get('contractType') ?? 'indefinido')
  const startDate = String(fd.get('startDate') ?? '').trim() || new Date().toISOString().slice(0, 10)
  const salary = num(String(fd.get('salary') ?? ''))
  const position = String(fd.get('position') ?? '').trim()

  if (!employeeId) return { ok: false, error: 'Falta el empleado.' }
  if (!['indefinido', 'determinado', 'por_obra'].includes(contractType)) {
    return { ok: false, error: 'Tipo de contrato no valido.' }
  }
  if (salary === null || salary < 0) return { ok: false, error: 'El salario no es valido.' }
  if (position.length < 2) return { ok: false, error: 'Escribe el cargo.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) =>
      tx`select public.crear_contrato_empleado(${employeeId}, ${contractType}, ${startDate}, ${salary}, ${position})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/empleados')
  revalidatePath(`/empleados/${employeeId}`)
  return { ok: true }
}

/** Da de baja a un empleado. */
export async function darDeBajaEmpleado(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'employees', 'employees.employee.terminate')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const terminationDate = String(fd.get('terminationDate') ?? '').trim() || new Date().toISOString().slice(0, 10)
  const reason = String(fd.get('reason') ?? '').trim()

  if (!employeeId) return { ok: false, error: 'Falta el empleado.' }
  if (reason.length < 4) return { ok: false, error: 'Escribe el motivo de la baja.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, async (tx) => {
      await tx`
        update public.employees
        set status = 'terminated', termination_date = ${terminationDate}, termination_reason = ${reason}
        where id = ${employeeId} and tenant_id = ${ctx.tenantId} and status <> 'terminated'`

      await tx`
        select public.emit_event('employees.employee.terminated',
          ${JSON.stringify({ employeeId, reason })}::text::jsonb, 'employees')`
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath('/empleados')
  revalidatePath(`/empleados/${employeeId}`)
  return { ok: true }
}

/**
 * Vincula (o desvincula, con `userId` vacio) la cuenta que ve este
 * expediente en el portal. Es la UNICA via: la base no deja que un token
 * escriba `employees.user_id` directo, y la funcion vuelve a comprobar que
 * la cuenta sea del equipo de este cliente y que no este ya en otro
 * expediente (0132). El portal ya no empareja por correo.
 */
export async function vincularUsuario(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'employees', 'employees.employee.link')
  if (!permiso.ok) return permiso

  const employeeId = String(fd.get('employeeId') ?? '')
  const userId = String(fd.get('userId') ?? '').trim() || null
  if (!employeeId) return { ok: false, error: 'Falta el empleado.' }

  try {
    await asUser(ctx.userId, ctx.tenantId, (tx) =>
      tx`select public.vincular_empleado_usuario(${employeeId}, ${userId})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    return { ok: false, error: msg.replace(/^.*ERROR:\s*/, '') }
  }

  revalidatePath(`/empleados/${employeeId}`)
  revalidatePath('/portal')
  return { ok: true }
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function vincularUsuarioForm(fd: FormData): Promise<void> {
  const quita = String(fd.get('userId') ?? '').trim() === ''
  await anotarAviso(
    await vincularUsuario(fd),
    'vincularUsuario',
    quita
      ? 'Listo, quitamos el vinculo: esa cuenta ya no ve este expediente.'
      : 'Listo, la cuenta quedo vinculada: ya ve este expediente en su portal.',
  )
}
export async function crearEmpleadoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearEmpleado(fd), 'crearEmpleado')
}
export async function crearContratoForm(fd: FormData): Promise<void> {
  await anotarAviso(await crearContrato(fd), 'crearContrato')
}
export async function darDeBajaEmpleadoForm(fd: FormData): Promise<void> {
  await anotarAviso(await darDeBajaEmpleado(fd), 'darDeBajaEmpleado')
}
